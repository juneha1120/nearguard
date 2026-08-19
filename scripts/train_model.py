from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"

NUMERIC_FEATURES = [
    "speed",
    "speed_limit",
    "zone_historical_risk",
    "speed_over_limit",
    "recent_harsh_brake_count_10m",
    "recent_sharp_turn_count_10m",
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
]
TARGET = "safety_incident_risk_score"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


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


def confidence_and_reason(features: dict[str, object], missing_context: bool) -> tuple[str, str | None]:
    if missing_context:
        return "low", "missing zone context"
    if features["gps_freshness"] == "stale":
        return "low", "stale GPS signal"
    if features["gps_freshness"] == "delayed":
        return "medium", "delayed GPS signal"
    if features["recent_harsh_brake_count_10m"] == 0 and features["recent_sharp_turn_count_10m"] == 0:
        return "medium", "sparse recent vehicle history"
    return "high", None


def reasons(features: dict[str, object], confidence: str, uncertainty: str | None) -> list[str]:
    output: list[str] = []
    speed_over = int(features["speed_over_limit"])
    if speed_over > 0:
        output.append(f"Speed is {speed_over} km/h above the zone limit.")
    if int(features["recent_harsh_brake_count_10m"]) > 0:
        output.append(
            f"{features['recent_harsh_brake_count_10m']} harsh-braking event(s) occurred within 10 minutes."
        )
    if int(features["recent_sharp_turn_count_10m"]) > 0:
        output.append(
            f"{features['recent_sharp_turn_count_10m']} sharp-turn event(s) occurred within 10 minutes."
        )
    if features["traffic_level"] == "high":
        output.append("Vehicle is operating in a high-traffic zone.")
    if features["restriction_level"] in {"caution", "restricted", "wharf"}:
        output.append(f"Zone restriction level is {features['restriction_level']}.")
    if features["pedestrian_exposure"] == "high":
        output.append("Pedestrian exposure is high in this operating area.")
    if features["slow_down_zone_active"]:
        output.append("Slow-down-zone speed context is active.")
    if confidence == "low" and uncertainty:
        output.append(f"Confidence is reduced because of {uncertainty}.")
    if not output:
        output.append("Current telemetry remains within expected operating range.")
    return output[:4]


def scenario_features() -> list[dict[str, object]]:
    scenarios = load_json(DATA_DIR / "scenarios.json")
    zones = {zone["zone_id"]: zone for zone in load_json(DATA_DIR / "zones.json")}
    outputs: list[dict[str, object]] = []

    for scenario in scenarios:
        history: list[tuple[datetime, str]] = []
        previous_risk = 0.12
        previous_action_taken = False
        for event in scenario["events"]:
            event_time = datetime.fromisoformat(event["timestamp"])
            missing_context = scenario["scenario_id"] == "telemetry-uncertainty" and event["event_id"] in {
                "uncertain-001",
                "uncertain-002",
            }
            zone = zones[event["zone_id"]]
            recent = [item for item in history if event_time - item[0] <= timedelta(minutes=10)]
            harsh_count = sum(1 for _, kind in recent if kind == "harsh_brake")
            sharp_count = sum(1 for _, kind in recent if kind == "sharp_turn")
            if event["event_type"] == "harsh_brake":
                harsh_count += 1
            if event["event_type"] == "sharp_turn":
                sharp_count += 1
            speed_over = max(0, int(event["speed"]) - int(event["speed_limit"]))
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
                "recent_harsh_brake_count_10m": harsh_count,
                "recent_sharp_turn_count_10m": sharp_count,
                "previous_risk": round(previous_risk, 3),
                "risk_trend": "decreasing" if event["event_type"] == "speed_normalized" else "increasing",
                "_scenario_id": scenario["scenario_id"],
                "_event_id": event["event_id"],
                "_missing_context": missing_context,
                "_previous_action_taken": previous_action_taken,
            }
            outputs.append(feature)
            history.append((event_time, event["event_type"]))
            previous_action_taken = previous_action_taken or event["event_type"] in {
                "harsh_brake",
                "speeding",
                "sharp_turn",
            }
            previous_risk = max(previous_risk, 0.58 if event["event_type"] != "speed_normalized" else 0.22)
    return outputs


def ensure_training_data() -> None:
    if not (DATA_DIR / "synthetic_training_data.csv").exists():
        subprocess.check_call([sys.executable, str(ROOT / "scripts" / "generate_synthetic_training_data.py")])


def main() -> None:
    ensure_training_data()
    frame = pd.read_csv(DATA_DIR / "synthetic_training_data.csv")
    x = frame[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = frame[TARGET]
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=42)

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", "passthrough", NUMERIC_FEATURES),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ]
    )
    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("regressor", HistGradientBoostingRegressor(random_state=42, max_iter=180)),
        ]
    )
    model.fit(x_train, y_train)
    predictions = model.predict(x_test).clip(0, 1)
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, predictions)), 4),
        "r2": round(float(r2_score(y_test, predictions)), 4),
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metrics": metrics}, MODEL_DIR / "nearguard-risk-model.joblib")

    scenario_outputs = []
    for feature in scenario_features():
        model_input = pd.DataFrame([{key: feature[key] for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES}])
        score = float(model.predict(model_input).clip(0, 1)[0])
        confidence, uncertainty = confidence_and_reason(feature, bool(feature["_missing_context"]))
        band = risk_band(score, confidence, bool(feature["_previous_action_taken"]))
        scenario_outputs.append(
            {
                "scenario_id": feature["_scenario_id"],
                "event_id": feature["_event_id"],
                "features": {key: feature[key] for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES},
                "assessment": {
                    "safety_incident_risk_score": round(score, 2),
                    "risk_band": band,
                    "confidence": confidence,
                    "uncertainty_reason": uncertainty,
                    "top_risk_reasons": reasons(feature, confidence, uncertainty),
                },
            }
        )

    with (MODEL_DIR / "scenario_predictions.json").open("w", encoding="utf-8") as handle:
        json.dump({"metrics": metrics, "predictions": scenario_outputs}, handle, indent=2)

    print(json.dumps({"metrics": metrics, "outputs": len(scenario_outputs)}, indent=2))


if __name__ == "__main__":
    main()
