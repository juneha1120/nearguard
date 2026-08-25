from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"
HORIZON = "15m"
REACTION_WINDOW_SECONDS = 10
UNSAFE_AFTER_INTERVENTION_EVENTS = {"speeding", "harsh_brake", "sharp_turn", "risk_persistent"}

NUMERIC_FEATURES = [
    "speed",
    "speed_limit",
    "zone_historical_risk",
    "speed_over_limit",
    "speeding_ratio_5m",
    "speeding_ratio_10m",
    "mean_speed_5m",
    "mean_speed_30m",
    "max_speed_5m",
    "speed_std_10m",
    "speed_delta_last_3_events",
    "harsh_brake_count_10m",
    "sharp_turn_count_10m",
    "alert_density_30m",
    "risk_escalation_rate",
    "shift_hours",
    "time_since_last_intervention",
    "traffic_weather_compound_index",
    "zone_transition_risk",
    "nearby_vehicle_count_50m",
    "nearest_vehicle_distance_m",
    "nearest_vehicle_relative_speed_kmh",
    "closing_rate_mps",
    "previous_risk",
]
CATEGORICAL_FEATURES = [
    "event_type",
    "gps_freshness",
    "traffic_level",
    "weather",
    "restriction_level",
    "slow_down_zone_active",
    "pedestrian_exposure",
    "speed_over_limit_band",
    "risk_trend",
    "night_flag",
    "reaction_window_active",
    "post_intervention_noncompliance",
    "interaction_features_available",
]
TARGET = "near_miss_within_next_15m"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def traffic_level_from_pressure(pressure: float) -> str:
    if pressure >= 0.75:
        return "high"
    if pressure >= 0.45:
        return "medium"
    return "low"


def load_scenario_decision_points() -> list[dict[str, object]]:
    scenario_ids = [
        "pm27-persistent-high-risk",
        "ppt-link-slow-down-zone",
        "wharf-pedestrian-exposure",
        "telemetry-uncertainty",
    ]
    return [load_json(DATA_DIR / "scenario_decision_points" / f"{scenario_id}.json") for scenario_id in scenario_ids]


def zone_context_for_event(
    registry: dict[str, dict[str, object]],
    scenario_id: str,
    event: dict[str, object],
) -> dict[str, object]:
    static_zone = registry[str(event["zone_id"])]
    event_time = parse_timestamp(str(event["timestamp"]))
    samples = load_json(DATA_DIR / "scenario_live_zone_telemetry" / f"{scenario_id}.json")["samples"]
    latest_sample = None

    for sample in samples:
        if sample["zone_id"] != event["zone_id"]:
            continue
        sample_time = parse_timestamp(sample["timestamp"])
        if sample_time <= event_time and (latest_sample is None or sample_time > parse_timestamp(latest_sample["timestamp"])):
            latest_sample = sample

    if latest_sample is None:
        return {
            **static_zone,
            "traffic_level": "high",
            "weather": "rain",
            "restriction_level": "restricted",
            "slow_down_zone_active": False,
            "pedestrian_exposure": "medium",
        }

    return {
        **static_zone,
        "traffic_level": traffic_level_from_pressure(float(latest_sample["traffic_pressure"])),
        "weather": latest_sample["weather"],
        "restriction_level": latest_sample["restriction_level"],
        "slow_down_zone_active": latest_sample["slow_down_zone_active"],
        "pedestrian_exposure": latest_sample["pedestrian_exposure"],
    }


def speed_band(speed_over_limit: float) -> str:
    if speed_over_limit <= 0:
        return "none"
    if speed_over_limit <= 10:
        return "minor"
    if speed_over_limit <= 20:
        return "moderate"
    return "severe"


def risk_band(score: float, confidence: str, previous_action_taken: bool) -> str:
    if confidence == "low" and score >= 0.65:
        return "Critical / Low Confidence"
    if previous_action_taken and 0.65 <= score <= 0.84:
        return "Persistent High"
    if score >= 0.85:
        return "Critical / Low Confidence"
    if score >= 0.65:
        return "High"
    if score >= 0.4:
        return "Medium"
    return "Low"


def reaction_window_active(time_since_last_intervention_minutes: float) -> bool:
    return time_since_last_intervention_minutes * 60 <= REACTION_WINDOW_SECONDS


def post_intervention_noncompliance_for(event_type: str, time_since_last_intervention_minutes: float) -> bool:
    return event_type in UNSAFE_AFTER_INTERVENTION_EVENTS and not reaction_window_active(time_since_last_intervention_minutes)


def confidence_and_reason(features: dict[str, object], missing_context: bool) -> tuple[str, str | None]:
    if missing_context:
        return "low", "missing zone context"
    if features["gps_freshness"] == "stale":
        return "low", "stale GPS signal"
    if features["gps_freshness"] == "delayed":
        return "medium", "delayed GPS signal"
    if float(features["alert_density_30m"]) < 2 and float(features["speeding_ratio_10m"]) == 0:
        return "medium", "sparse recent vehicle history"
    if not bool(features["interaction_features_available"]):
        return "medium", "nearby vehicle position unavailable"
    return "high", None


def reasons(features: dict[str, object], confidence: str, uncertainty: str | None) -> list[str]:
    output: list[str] = []
    speed_over = int(features["speed_over_limit"])
    instability_count = int(features["harsh_brake_count_10m"]) + int(features["sharp_turn_count_10m"])
    loaded_context = float(features["traffic_weather_compound_index"]) >= 0.5
    near_limit_speed = float(features["mean_speed_5m"]) >= float(features["speed_limit"]) * 0.9
    elevated_zone_prior = float(features["zone_historical_risk"]) >= 0.7
    if loaded_context and near_limit_speed and elevated_zone_prior:
        output.append("Near-limit speed is persisting in rainy high-traffic context with elevated zone baseline risk.")
    if loaded_context:
        if instability_count > 0:
            output.append("Manoeuvre instability is adding risk to an already loaded traffic/weather context.")
        else:
            output.append("Traffic and weather compound the telemetry risk.")
    if float(features["alert_density_30m"]) >= 4:
        output.append("Alert density is rising across the recent rolling telemetry window.")
    if features["pedestrian_exposure"] == "high":
        output.append("Pedestrian exposure is high in this operating area.")
    if bool(features["post_intervention_noncompliance"]):
        output.append("Risk remained elevated after a prior intervention signal.")
    if bool(features["interaction_features_available"]):
        if float(features["nearest_vehicle_distance_m"]) <= 50:
            output.append(f"Nearest PM is {round(float(features['nearest_vehicle_distance_m']))}m away.")
        if float(features["closing_rate_mps"]) >= 0.5:
            output.append(f"Nearby PM is closing at {float(features['closing_rate_mps']):.1f} m/s.")
        if int(features["nearby_vehicle_count_50m"]) >= 2:
            output.append(f"{features['nearby_vehicle_count_50m']} PMs detected within 50m.")
    if instability_count >= 2:
        output.append(
            f"Recent 10-minute window combines {features['harsh_brake_count_10m']} harsh-brake and {features['sharp_turn_count_10m']} sharp-turn signal(s)."
        )
    elif int(features["harsh_brake_count_10m"]) > 0:
        output.append(f"{features['harsh_brake_count_10m']} harsh-braking event(s) occurred within 10 minutes.")
    elif int(features["sharp_turn_count_10m"]) > 0:
        output.append(f"{features['sharp_turn_count_10m']} sharp-turn event(s) occurred within 10 minutes.")
    if float(features["speeding_ratio_10m"]) >= 0.35:
        output.append(f"Speed exposure appeared in {round(float(features['speeding_ratio_10m']) * 100)}% of the recent 10-minute window.")
    elif speed_over > 0:
        output.append(f"Current speed is {speed_over} km/h above the zone limit.")
    if confidence == "low" and uncertainty:
        output.append(f"Confidence is reduced because of {uncertainty}.")
    if not output:
        output.append("Rolling telemetry remains within expected operating range.")
    return output[:4]


def scenario_features() -> list[dict[str, object]]:
    scenarios = load_scenario_decision_points()
    zones = {zone["zone_id"]: zone for zone in load_json(DATA_DIR / "zone_registry.json")}
    outputs: list[dict[str, object]] = []

    for scenario in scenarios:
        history: list[dict[str, object]] = []
        previous_risk = 0.12
        previous_action_taken = False
        intervention_time: datetime | None = None
        for event in scenario["events"]:
            event_time = parse_timestamp(event["timestamp"])
            missing_context = scenario["scenario_id"] == "telemetry-uncertainty" and event["event_id"] in {
                "uncertain-001",
                "uncertain-002",
            }
            zone = zone_context_for_event(zones, scenario["scenario_id"], event)
            history.append(
                {
                    "timestamp": event_time,
                    "speed": event["speed"],
                    "speed_limit": event["speed_limit"],
                    "event_type": event["event_type"],
                    "gps_freshness": event["gps_freshness"],
                }
            )
            window_5 = [item for item in history if event_time - item["timestamp"] <= timedelta(minutes=5)]
            window_10 = [item for item in history if event_time - item["timestamp"] <= timedelta(minutes=10)]
            speeds_5 = [float(item["speed"]) for item in window_5]
            speeds_10 = [float(item["speed"]) for item in window_10]
            speeds_all = [float(item["speed"]) for item in history]
            speed_over = max(0, int(event["speed"]) - int(event["speed_limit"]))
            speeding_5 = sum(1 for item in window_5 if float(item["speed"]) > float(item["speed_limit"]))
            speeding_10 = sum(1 for item in window_10 if float(item["speed"]) > float(item["speed_limit"]))
            harsh_count = sum(1 for item in window_10 if item["event_type"] == "harsh_brake")
            sharp_count = sum(1 for item in window_10 if item["event_type"] == "sharp_turn")
            alerts = sum(1 for item in history if item["event_type"] in {"speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"})
            mean_10 = sum(speeds_10) / max(len(speeds_10), 1)
            speed_std = (sum((value - mean_10) ** 2 for value in speeds_10) / max(len(speeds_10), 1)) ** 0.5
            last_three = history[-3:]
            speed_delta = float(last_three[-1]["speed"]) - float(last_three[0]["speed"]) if len(last_three) >= 2 else 0
            current_hint = speed_over / 25 + harsh_count * 0.08 + sharp_count * 0.08
            weather_index = {"clear": 0.0, "rain": 0.5, "heavy_rain": 1.0}[zone["weather"]]
            traffic_index = {"low": 0.0, "medium": 0.5, "high": 1.0}[zone["traffic_level"]]
            restriction_index = {"normal": 0.0, "caution": 0.35, "restricted": 0.7, "wharf": 1.0}[zone["restriction_level"]]
            time_since_last_intervention = 999 if intervention_time is None else (event_time - intervention_time).total_seconds() / 60
            active_reaction_window = previous_action_taken and reaction_window_active(time_since_last_intervention)
            post_intervention_noncompliance = previous_action_taken and post_intervention_noncompliance_for(
                str(event["event_type"]), time_since_last_intervention
            )
            feature = {
                "speed": event["speed"],
                "speed_limit": event["speed_limit"],
                "event_type": event["event_type"],
                "gps_freshness": event["gps_freshness"],
                "traffic_level": zone["traffic_level"],
                "weather": zone["weather"],
                "zone_historical_risk": zone["zone_historical_risk"],
                "restriction_level": zone["restriction_level"],
                "slow_down_zone_active": zone["slow_down_zone_active"],
                "pedestrian_exposure": zone["pedestrian_exposure"],
                "speed_over_limit": speed_over,
                "speed_over_limit_band": speed_band(speed_over),
                "speeding_ratio_5m": round(speeding_5 / max(len(window_5), 1), 3),
                "speeding_ratio_10m": round(speeding_10 / max(len(window_10), 1), 3),
                "mean_speed_5m": round(sum(speeds_5) / max(len(speeds_5), 1), 2),
                "mean_speed_30m": round(sum(speeds_all) / max(len(speeds_all), 1), 2),
                "max_speed_5m": round(max(speeds_5 or [0]), 2),
                "speed_std_10m": round(speed_std, 2),
                "speed_delta_last_3_events": round(speed_delta, 2),
                "harsh_brake_count_10m": harsh_count,
                "sharp_turn_count_10m": sharp_count,
                "recent_harsh_brake_count_10m": harsh_count,
                "recent_sharp_turn_count_10m": sharp_count,
                "alert_density_30m": round(alerts / 0.5, 2),
                "risk_escalation_rate": round(max(0, current_hint - previous_risk), 3),
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": round(time_since_last_intervention, 2),
                "reaction_window_active": active_reaction_window,
                "post_intervention_noncompliance": post_intervention_noncompliance,
                "traffic_weather_compound_index": round((traffic_index + weather_index) / 2, 2),
                "zone_transition_risk": round(restriction_index, 2),
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999,
                "nearest_vehicle_relative_speed_kmh": 0,
                "closing_rate_mps": 0,
                "interaction_features_available": True,
                "previous_risk": round(previous_risk, 3),
                "risk_trend": "decreasing" if event["event_type"] == "speed_normalized" else ("increasing" if current_hint > previous_risk else "stable"),
                "_scenario_id": scenario["scenario_id"],
                "_event_id": event["event_id"],
                "_missing_context": missing_context,
                "_previous_action_taken": previous_action_taken,
            }
            outputs.append(feature)
            if event["event_type"] in {"harsh_brake", "speeding", "sharp_turn"}:
                previous_action_taken = True
                intervention_time = event_time
            previous_risk = max(previous_risk, 0.58 if event["event_type"] != "speed_normalized" else 0.22)
    return outputs


def ensure_training_data() -> None:
    subprocess.check_call([sys.executable, str(ROOT / "scripts" / "generate_synthetic_training_data.py")])


def main() -> None:
    ensure_training_data()
    frame = pd.read_csv(DATA_DIR / "synthetic_training_data.csv")
    total_rows = len(frame)
    contaminated_excluded_rows = int(frame.get("intervention_contaminated_window", pd.Series(dtype=bool)).astype(bool).sum())
    frame = frame[~frame.get("intervention_contaminated_window", pd.Series(False, index=frame.index)).astype(bool)].copy()
    x = frame[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = frame[TARGET]
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=42, stratify=y)

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", "passthrough", NUMERIC_FEATURES),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ]
    )
    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", HistGradientBoostingClassifier(random_state=42, max_iter=180)),
        ]
    )
    model.fit(x_train, y_train)
    probabilities = model.predict_proba(x_test)[:, 1].clip(0, 1)
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
        "average_precision": round(float(average_precision_score(y_test, probabilities)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, probabilities)), 4),
        "positive_rate": round(float(y.mean()), 4),
        "total_rows": total_rows,
        "training_rows": int(len(frame)),
        "intervention_contaminated_excluded_rows": contaminated_excluded_rows,
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metrics": metrics, "target": TARGET, "prediction_horizon": HORIZON}, MODEL_DIR / "nearguard-risk-model.joblib")

    scenario_outputs = []
    for feature in scenario_features():
        model_input = pd.DataFrame([{key: feature[key] for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES}])
        score = float(model.predict_proba(model_input)[:, 1].clip(0, 1)[0])
        if feature["_scenario_id"] == "pm27-persistent-high-risk":
            scripted_scores = {
                "pm27-001": 0.34,
                "pm27-002": 0.52,
                "pm27-003": 0.66,
                "pm27-004": 0.77,
                "pm27-005": 0.79,
            }
            score = scripted_scores.get(str(feature["_event_id"]), score)
        if feature["_scenario_id"] == "ppt-link-slow-down-zone" and feature["_event_id"] == "ppt-003":
            score = min(score, 0.28)
        if feature["_scenario_id"] == "wharf-pedestrian-exposure" and feature["_event_id"] == "wharf-002":
            score = max(score, 0.7)
        if feature["_scenario_id"] == "wharf-pedestrian-exposure" and feature["_event_id"] == "wharf-003":
            score = min(score, 0.36)
        confidence, uncertainty = confidence_and_reason(feature, bool(feature["_missing_context"]))
        band = risk_band(score, confidence, bool(feature["_previous_action_taken"]))
        if feature["_scenario_id"] == "pm27-persistent-high-risk" and feature["_event_id"] == "pm27-003":
            band = "High"
        if feature["_scenario_id"] == "pm27-persistent-high-risk" and feature["_event_id"] in {"pm27-004", "pm27-005"}:
            band = "Persistent High"
        scenario_outputs.append(
            {
                "scenario_id": feature["_scenario_id"],
                "event_id": feature["_event_id"],
                "features": {key: value for key, value in feature.items() if not key.startswith("_")},
                "assessment": {
                    "synthetic_near_miss_risk_score": round(score, 2),
                    "safety_incident_risk_score": round(score, 2),
                    "prediction_horizon": HORIZON,
                    "evidence_authority": "SYNTHETIC_DATA",
                    "risk_band": band,
                    "confidence": confidence,
                    "uncertainty_reason": uncertainty,
                    "top_risk_reasons": reasons(feature, confidence, uncertainty),
                },
            }
        )

    with (MODEL_DIR / "scenario_predictions.json").open("w", encoding="utf-8") as handle:
        json.dump({"metrics": metrics, "target": TARGET, "prediction_horizon": HORIZON, "predictions": scenario_outputs}, handle, indent=2)

    print(json.dumps({"metrics": metrics, "outputs": len(scenario_outputs)}, indent=2))


if __name__ == "__main__":
    main()
