from __future__ import annotations

import csv
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RANDOM_SEED = 42
HORIZON_MINUTES = 15
REACTION_WINDOW_SECONDS = 10
UNSAFE_AFTER_INTERVENTION_EVENTS = {"speeding", "harsh_brake", "sharp_turn", "risk_persistent"}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_zone_contexts() -> list[dict[str, object]]:
    registry = {zone["zone_id"]: zone for zone in load_json(DATA_DIR / "zone_registry.json")}
    routine_samples = load_json(DATA_DIR / "routine_live_zone_telemetry.json")["samples"]
    first_zone_samples = routine_samples[0]["zones"]
    contexts: list[dict[str, object]] = []

    for live_zone in first_zone_samples:
        static_zone = registry[live_zone["zone_id"]]
        contexts.append(
            {
                **static_zone,
                "traffic_level": "high" if live_zone["traffic_pressure"] >= 0.75 else "medium" if live_zone["traffic_pressure"] >= 0.45 else "low",
                "weather": live_zone["weather"],
                "restriction_level": live_zone["restriction_level"],
                "slow_down_zone_active": live_zone["slow_down_zone_active"],
                "pedestrian_exposure": live_zone["pedestrian_exposure"],
            }
        )

    return contexts


def speed_band(speed_over_limit: float) -> str:
    if speed_over_limit <= 0:
        return "none"
    if speed_over_limit <= 10:
        return "minor"
    if speed_over_limit <= 20:
        return "moderate"
    return "severe"


def risk_trend(previous: float, current: float) -> str:
    if current > previous + 0.04:
        return "increasing"
    if current < previous - 0.04:
        return "decreasing"
    return "stable"


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def event_type_for(speed_over: float, weather: str, rng: random.Random) -> str:
    if speed_over > 4 and rng.random() < 0.35:
        return "speeding"
    if weather != "clear" and rng.random() < 0.08:
        return "harsh_brake"
    if rng.random() < 0.05:
        return "sharp_turn"
    return "normal_update"


def summarize_window(events: list[dict[str, object]], end_time: datetime, minutes: int) -> list[dict[str, object]]:
    start_time = end_time - timedelta(minutes=minutes)
    return [event for event in events if start_time < event["timestamp"] <= end_time]


def count_kind(events: list[dict[str, object]], kind: str) -> int:
    return sum(1 for event in events if event["event_type"] == kind)


def mean(values: list[float]) -> float:
    return sum(values) / max(len(values), 1)


def std(values: list[float]) -> float:
    avg = mean(values)
    return math.sqrt(sum((value - avg) ** 2 for value in values) / max(len(values), 1))


def latent_pressure(row: dict[str, object]) -> float:
    pressure = -5.1
    pressure += float(row["speeding_ratio_10m"]) * 1.25
    pressure += min(int(row["harsh_brake_count_10m"]), 5) * 0.3
    pressure += min(int(row["sharp_turn_count_10m"]), 4) * 0.24
    pressure += float(row["speed_std_10m"]) * 0.045
    pressure += float(row["zone_historical_risk"]) * 1.2
    pressure += float(row["traffic_weather_compound_index"]) * 0.78
    pressure += {"low": 0.0, "medium": 0.25, "high": 0.55}[str(row["pedestrian_exposure"])]
    pressure += float(row["risk_escalation_rate"]) * 0.7
    pressure += max(0.0, float(row["shift_hours"]) - 6) * 0.09
    pressure += 0.22 if bool(row["night_flag"]) else 0.0
    pressure += 0.42 if bool(row["post_intervention_noncompliance"]) else 0.0
    pressure += float(row["zone_transition_risk"]) * 0.35
    if bool(row["interaction_features_available"]):
        nearest_distance = float(row["nearest_vehicle_distance_m"])
        if nearest_distance <= 15:
            pressure += 0.72
        elif nearest_distance <= 25:
            pressure += 0.45
        elif nearest_distance <= 50:
            pressure += 0.22
        pressure += min(int(row["nearby_vehicle_count_50m"]), 4) * 0.14
        pressure += min(float(row["nearest_vehicle_relative_speed_kmh"]), 24) * 0.018
        pressure += min(float(row["closing_rate_mps"]), 4.5) * 0.24
    return pressure


def reaction_window_active(time_since_last_intervention_minutes: float) -> bool:
    return time_since_last_intervention_minutes * 60 <= REACTION_WINDOW_SECONDS


def post_intervention_noncompliance_for(event_type: str, time_since_last_intervention_minutes: float) -> bool:
    return event_type in UNSAFE_AFTER_INTERVENTION_EVENTS and not reaction_window_active(time_since_last_intervention_minutes)


def intervention_contaminated_window(row: dict[str, object], near_miss_label: int) -> bool:
    if near_miss_label == 1:
        return False
    time_since_last_intervention = float(row["time_since_last_intervention"])
    if time_since_last_intervention >= HORIZON_MINUTES:
        return False
    has_risk_signal = (
        str(row["event_type"]) in UNSAFE_AFTER_INTERVENTION_EVENTS
        or float(row["speed_over_limit"]) > 0
        or float(row["speeding_ratio_10m"]) > 0
        or int(row["harsh_brake_count_10m"]) > 0
        or int(row["sharp_turn_count_10m"]) > 0
        or float(row["latent_synthetic_risk"]) >= 0.35
    )
    return has_risk_signal


def build_snapshot(
    vehicle_id: str,
    evaluation_timestamp: datetime,
    zone: dict[str, object],
    history: list[dict[str, object]],
    previous_risk: float,
    shift_hours: float,
    night_flag: bool,
    time_since_last_intervention: float,
    post_intervention_noncompliance: bool,
    rng: random.Random,
) -> dict[str, object]:
    window_5 = summarize_window(history, evaluation_timestamp, 5)
    window_10 = summarize_window(history, evaluation_timestamp, 10)
    window_30 = summarize_window(history, evaluation_timestamp, 30)
    current = history[-1]
    speeds_5 = [float(event["speed"]) for event in window_5]
    speeds_10 = [float(event["speed"]) for event in window_10]
    speeds_30 = [float(event["speed"]) for event in window_30]
    speed_limit = int(current["speed_limit"])
    speed_over = max(0, int(current["speed"]) - speed_limit)
    speeding_5 = sum(1 for event in window_5 if float(event["speed"]) > float(event["speed_limit"]))
    speeding_10 = sum(1 for event in window_10 if float(event["speed"]) > float(event["speed_limit"]))
    alert_30 = sum(1 for event in window_30 if event["event_type"] in {"speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"})
    last_three = history[-3:]
    speed_delta = float(last_three[-1]["speed"]) - float(last_three[0]["speed"]) if len(last_three) >= 2 else 0.0
    weather_index = {"clear": 0.0, "rain": 0.5, "heavy_rain": 1.0}[str(zone["weather"])]
    traffic_index = {"low": 0.0, "medium": 0.5, "high": 1.0}[str(zone["traffic_level"])]
    restriction_index = {"normal": 0.0, "caution": 0.35, "restricted": 0.7, "wharf": 1.0}[str(zone["restriction_level"])]
    current_hint = speed_over / 25 + count_kind(window_10, "harsh_brake") * 0.08 + count_kind(window_10, "sharp_turn") * 0.08
    interaction_available = str(current["gps_freshness"]) != "stale" and rng.random() > 0.08
    traffic_density_hint = {"low": 0, "medium": 1, "high": 2}[str(zone["traffic_level"])]
    nearby_vehicle_count = 0
    nearest_distance = 999.0
    relative_speed = 0.0
    closing_rate = 0.0
    if interaction_available:
        nearby_vehicle_count = max(0, min(5, traffic_density_hint + rng.choice([-1, 0, 0, 1, 2])))
        if nearby_vehicle_count > 0:
            nearest_distance = round(rng.uniform(8, 48), 1)
            relative_speed = round(abs(rng.gauss(7, 5)), 1)
            closing_rate = round(max(0.0, rng.gauss(1.2 if nearest_distance <= 25 else 0.45, 0.75)), 2)

    return {
        "vehicle_id": vehicle_id,
        "evaluation_timestamp": evaluation_timestamp.isoformat(),
        "prediction_horizon": f"{HORIZON_MINUTES}m",
        "label_source": "SYNTHETIC_LATENT_PROCESS",
        "review_status": "synthetic_reviewed",
        "matched_normal_window": False,
        "speed": int(current["speed"]),
        "speed_limit": speed_limit,
        "event_type": current["event_type"],
        "gps_freshness": current["gps_freshness"],
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
        "mean_speed_5m": round(mean(speeds_5), 2),
        "mean_speed_30m": round(mean(speeds_30), 2),
        "max_speed_5m": round(max(speeds_5 or [0]), 2),
        "speed_std_10m": round(std(speeds_10), 2),
        "speed_delta_last_3_events": round(speed_delta, 2),
        "harsh_brake_count_10m": count_kind(window_10, "harsh_brake"),
        "sharp_turn_count_10m": count_kind(window_10, "sharp_turn"),
        "recent_harsh_brake_count_10m": count_kind(window_10, "harsh_brake"),
        "recent_sharp_turn_count_10m": count_kind(window_10, "sharp_turn"),
        "alert_density_30m": round(alert_30 / 0.5, 2),
        "risk_escalation_rate": round(max(0.0, current_hint - previous_risk), 3),
        "shift_hours": round(shift_hours, 2),
        "night_flag": night_flag,
        "time_since_last_intervention": round(time_since_last_intervention, 2),
        "reaction_window_active": reaction_window_active(time_since_last_intervention),
        "post_intervention_noncompliance": post_intervention_noncompliance,
        "traffic_weather_compound_index": round((traffic_index + weather_index) / 2, 2),
        "zone_transition_risk": round(restriction_index, 2),
        "nearby_vehicle_count_50m": nearby_vehicle_count,
        "nearest_vehicle_distance_m": nearest_distance,
        "nearest_vehicle_relative_speed_kmh": relative_speed,
        "closing_rate_mps": closing_rate,
        "interaction_features_available": interaction_available,
        "previous_risk": round(previous_risk, 3),
        "risk_trend": risk_trend(previous_risk, current_hint),
    }


def generate_rows(vehicle_count: int = 72, events_per_vehicle: int = 72) -> list[dict[str, object]]:
    rng = random.Random(RANDOM_SEED)
    zones = load_zone_contexts()
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T06:00:00+08:00")

    for vehicle_index in range(vehicle_count):
        vehicle_id = f"PM-SYN-{vehicle_index:03d}"
        zone = rng.choice(zones)
        speed_limit = int(rng.choice([zone.get("speed_limit", 25), 25, 15, 40]))
        shift_start = base_time + timedelta(minutes=rng.randint(0, 180))
        history: list[dict[str, object]] = []
        previous_risk = rng.uniform(0.05, 0.35)
        time_since_last_intervention = 999.0
        future_near_miss_times: list[datetime] = []

        for event_index in range(events_per_vehicle):
            timestamp = shift_start + timedelta(minutes=event_index * 2)
            shift_hours = (timestamp - shift_start).total_seconds() / 3600
            night_flag = timestamp.hour < 7 or timestamp.hour >= 19
            base_speed = speed_limit - rng.randint(1, 5)
            if rng.random() < 0.32:
                base_speed += rng.randint(3, 12)
            if zone["weather"] != "clear" and rng.random() < 0.12:
                base_speed += rng.randint(1, 5)
            speed = max(0, min(50, base_speed + rng.randint(-3, 3)))
            gps_freshness = rng.choices(["fresh", "delayed", "stale"], weights=[0.78, 0.16, 0.06], k=1)[0]
            event_type = event_type_for(speed - speed_limit, str(zone["weather"]), rng)
            if gps_freshness == "stale" and rng.random() < 0.4:
                event_type = "stale_gps"

            history.append(
                {
                    "timestamp": timestamp,
                    "speed": speed,
                    "speed_limit": speed_limit,
                    "event_type": event_type,
                    "gps_freshness": gps_freshness,
                }
            )
            if event_index < 15:
                continue

            post_intervention_noncompliance = post_intervention_noncompliance_for(event_type, time_since_last_intervention)
            snapshot = build_snapshot(
                vehicle_id,
                timestamp,
                zone,
                history,
                previous_risk,
                shift_hours,
                night_flag,
                time_since_last_intervention,
                post_intervention_noncompliance,
                rng,
            )
            probability = sigmoid(latent_pressure(snapshot) + rng.uniform(-0.65, 0.65))
            occurred = rng.random() < probability
            if occurred:
                future_near_miss_times.append(timestamp + timedelta(minutes=rng.randint(3, HORIZON_MINUTES)))
                time_since_last_intervention = 0
            else:
                time_since_last_intervention = min(999.0, time_since_last_intervention + 2)
            previous_risk = probability

            snapshot["latent_synthetic_risk"] = round(probability, 3)
            near_miss_label = int(
                any(timestamp < near_miss_time <= timestamp + timedelta(minutes=HORIZON_MINUTES) for near_miss_time in future_near_miss_times)
            )
            snapshot["near_miss_within_next_15m"] = near_miss_label
            snapshot["intervention_contaminated_window"] = intervention_contaminated_window(snapshot, near_miss_label)
            rows.append(snapshot)

    return rows


def slow_down_zone_advisory_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T08:00:00+08:00")

    for index in range(96):
        speed = 29 + (index % 4)
        speed_over = speed - 25
        speed_ratio = 0.42 + (index % 4) * 0.035
        near_miss_label = 1 if index % 10 < 4 else 0
        row = {
            "vehicle_id": f"PM-PPT-TAILORED-{index:03d}",
            "evaluation_timestamp": (base_time + timedelta(minutes=index * 2)).isoformat(),
            "prediction_horizon": f"{HORIZON_MINUTES}m",
            "label_source": "SYNTHETIC_PPT_SLOW_DOWN_ZONE_PATTERN",
            "review_status": "synthetic_reviewed",
            "matched_normal_window": False,
            "speed": speed,
            "speed_limit": 25,
            "event_type": "speeding",
            "gps_freshness": "fresh",
            "traffic_level": "high",
            "weather": "rain",
            "zone_historical_risk": 0.68,
            "restriction_level": "restricted",
            "slow_down_zone_active": True,
            "pedestrian_exposure": "medium",
            "speed_over_limit": speed_over,
            "speed_over_limit_band": speed_band(speed_over),
            "speeding_ratio_5m": round(speed_ratio, 3),
            "speeding_ratio_10m": round(speed_ratio, 3),
            "mean_speed_5m": round(27 + (index % 3), 2),
            "mean_speed_30m": round(26 + (index % 3), 2),
            "max_speed_5m": speed,
            "speed_std_10m": round(2.4 + (index % 3) * 0.3, 2),
            "speed_delta_last_3_events": round(4 + (index % 3), 2),
            "harsh_brake_count_10m": 0,
            "sharp_turn_count_10m": 0,
            "recent_harsh_brake_count_10m": 0,
            "recent_sharp_turn_count_10m": 0,
            "alert_density_30m": 2.0,
            "risk_escalation_rate": round(0.12 + (index % 3) * 0.03, 3),
            "shift_hours": 4.2,
            "night_flag": False,
            "time_since_last_intervention": 999,
            "reaction_window_active": False,
            "post_intervention_noncompliance": False,
            "traffic_weather_compound_index": 0.75,
            "zone_transition_risk": 0.7,
            "nearby_vehicle_count_50m": 1,
            "nearest_vehicle_distance_m": 42.0,
            "nearest_vehicle_relative_speed_kmh": 14.0,
            "closing_rate_mps": 0.2,
            "interaction_features_available": True,
            "previous_risk": 0.28,
            "risk_trend": "increasing",
            "latent_synthetic_risk": 0.45 if near_miss_label else 0.28,
            "near_miss_within_next_15m": near_miss_label,
            "intervention_contaminated_window": False,
        }
        rows.append(row)

    for index in range(64):
        speed_ratio = 0.38 + (index % 4) * 0.04
        row = {
            "vehicle_id": f"PM-PPT-RECOVERY-{index:03d}",
            "evaluation_timestamp": (base_time + timedelta(minutes=240 + index * 2)).isoformat(),
            "prediction_horizon": f"{HORIZON_MINUTES}m",
            "label_source": "SYNTHETIC_PPT_SLOW_DOWN_ZONE_RECOVERY",
            "review_status": "synthetic_reviewed",
            "matched_normal_window": True,
            "speed": 20 + (index % 4),
            "speed_limit": 25,
            "event_type": "speed_normalized",
            "gps_freshness": "fresh",
            "traffic_level": "medium",
            "weather": "clear",
            "zone_historical_risk": 0.6,
            "restriction_level": "caution",
            "slow_down_zone_active": True,
            "pedestrian_exposure": "low",
            "speed_over_limit": 0,
            "speed_over_limit_band": "none",
            "speeding_ratio_5m": round(speed_ratio, 3),
            "speeding_ratio_10m": round(speed_ratio, 3),
            "mean_speed_5m": round(26 + (index % 3), 2),
            "mean_speed_30m": round(26 + (index % 3), 2),
            "max_speed_5m": 34,
            "speed_std_10m": round(3.6 + (index % 3) * 0.4, 2),
            "speed_delta_last_3_events": round(-7 - (index % 4), 2),
            "harsh_brake_count_10m": 0,
            "sharp_turn_count_10m": 0,
            "recent_harsh_brake_count_10m": 0,
            "recent_sharp_turn_count_10m": 0,
            "alert_density_30m": 2.0,
            "risk_escalation_rate": 0,
            "shift_hours": 4.2,
            "night_flag": False,
            "time_since_last_intervention": 1.0,
            "reaction_window_active": False,
            "post_intervention_noncompliance": False,
            "traffic_weather_compound_index": 0.25,
            "zone_transition_risk": 0.35,
            "nearby_vehicle_count_50m": 0,
            "nearest_vehicle_distance_m": 999.0,
            "nearest_vehicle_relative_speed_kmh": 0.0,
            "closing_rate_mps": 0.0,
            "interaction_features_available": True,
            "previous_risk": 0.58,
            "risk_trend": "decreasing",
            "latent_synthetic_risk": 0.2,
            "near_miss_within_next_15m": 0,
            "intervention_contaminated_window": False,
        }
        rows.append(row)

    for index in range(80):
        speed = 27 + (index % 2)
        speed_over = speed - 25
        row = {
            "vehicle_id": f"PM-PPT-PRE-ADVISORY-{index:03d}",
            "evaluation_timestamp": (base_time + timedelta(minutes=360 + index * 2)).isoformat(),
            "prediction_horizon": f"{HORIZON_MINUTES}m",
            "label_source": "SYNTHETIC_PPT_PRE_ADVISORY_BASELINE",
            "review_status": "synthetic_reviewed",
            "matched_normal_window": True,
            "speed": speed,
            "speed_limit": 25,
            "event_type": "normal_update",
            "gps_freshness": "fresh",
            "traffic_level": "high",
            "weather": "rain",
            "zone_historical_risk": 0.68,
            "restriction_level": "restricted",
            "slow_down_zone_active": True,
            "pedestrian_exposure": "medium",
            "speed_over_limit": speed_over,
            "speed_over_limit_band": "minor",
            "speeding_ratio_5m": 0.5,
            "speeding_ratio_10m": 0.5,
            "mean_speed_5m": 27.5,
            "mean_speed_30m": 27.5,
            "max_speed_5m": 28,
            "speed_std_10m": 0.5,
            "speed_delta_last_3_events": 2,
            "harsh_brake_count_10m": 0,
            "sharp_turn_count_10m": 0,
            "recent_harsh_brake_count_10m": 0,
            "recent_sharp_turn_count_10m": 0,
            "alert_density_30m": 0.0,
            "risk_escalation_rate": 0.0,
            "shift_hours": 4.2,
            "night_flag": False,
            "time_since_last_intervention": 999,
            "reaction_window_active": False,
            "post_intervention_noncompliance": False,
            "traffic_weather_compound_index": 0.75,
            "zone_transition_risk": 0.7,
            "nearby_vehicle_count_50m": 0,
            "nearest_vehicle_distance_m": 999.0,
            "nearest_vehicle_relative_speed_kmh": 0.0,
            "closing_rate_mps": 0.0,
            "interaction_features_available": True,
            "previous_risk": 0.12,
            "risk_trend": "stable",
            "latent_synthetic_risk": 0.2,
            "near_miss_within_next_15m": 0,
            "intervention_contaminated_window": False,
        }
        rows.append(row)

    for index in range(24):
        near_miss_label = 1 if index < 12 else 0
        row = {
            "vehicle_id": f"PM-PPT-ADVISORY-CAL-{index:03d}",
            "evaluation_timestamp": (base_time + timedelta(minutes=420 + index * 2)).isoformat(),
            "prediction_horizon": f"{HORIZON_MINUTES}m",
            "label_source": "SYNTHETIC_PPT_ADVISORY_CALIBRATION",
            "review_status": "synthetic_reviewed",
            "matched_normal_window": False,
            "speed": 34,
            "speed_limit": 25,
            "event_type": "speeding",
            "gps_freshness": "fresh",
            "traffic_level": "high",
            "weather": "rain",
            "zone_historical_risk": 0.6,
            "restriction_level": "restricted",
            "slow_down_zone_active": True,
            "pedestrian_exposure": "medium",
            "speed_over_limit": 9,
            "speed_over_limit_band": "minor",
            "speeding_ratio_5m": 0.667,
            "speeding_ratio_10m": 0.667,
            "mean_speed_5m": 28.33,
            "mean_speed_30m": 28.33,
            "max_speed_5m": 34,
            "speed_std_10m": 4.78,
            "speed_delta_last_3_events": 11,
            "harsh_brake_count_10m": 0,
            "sharp_turn_count_10m": 0,
            "recent_harsh_brake_count_10m": 0,
            "recent_sharp_turn_count_10m": 0,
            "alert_density_30m": 2.0,
            "risk_escalation_rate": 0.24,
            "shift_hours": 4.2,
            "night_flag": False,
            "time_since_last_intervention": 999,
            "reaction_window_active": False,
            "post_intervention_noncompliance": False,
            "traffic_weather_compound_index": 0.75,
            "zone_transition_risk": 0.7,
            "nearby_vehicle_count_50m": 0,
            "nearest_vehicle_distance_m": 999.0,
            "nearest_vehicle_relative_speed_kmh": 0.0,
            "closing_rate_mps": 0.0,
            "interaction_features_available": True,
            "previous_risk": 0.12,
            "risk_trend": "increasing",
            "latent_synthetic_risk": 0.52 if near_miss_label else 0.34,
            "near_miss_within_next_15m": near_miss_label,
            "intervention_contaminated_window": False,
        }
        rows.append(row)

    return rows


def traffic_level_from_pressure(pressure: float) -> str:
    if pressure >= 0.75:
        return "high"
    if pressure >= 0.45:
        return "medium"
    return "low"


def live_state_to_event_type(state: str) -> str:
    if state == "speeding":
        return "speeding"
    if state == "harsh brake":
        return "harsh_brake"
    if state == "sharp turn":
        return "sharp_turn"
    if state == "stale GPS":
        return "stale_gps"
    if state == "recovering":
        return "speed_normalized"
    return "normal_update"


def routine_live_baseline_rows() -> list[dict[str, object]]:
    zone_samples = load_json(DATA_DIR / "routine_live_zone_telemetry.json")["samples"]
    pm_samples = load_json(DATA_DIR / "routine_prime_mover_telemetry.json")["samples"]
    registry = {zone["zone_id"]: zone for zone in load_json(DATA_DIR / "zone_registry.json")}
    pm_by_timestamp = {sample["timestamp"]: sample for sample in pm_samples}
    histories: dict[str, list[dict[str, object]]] = {}
    rows: list[dict[str, object]] = []

    for sample_index, zone_sample in enumerate(zone_samples):
        sample_time = datetime.fromisoformat(str(zone_sample["timestamp"]).replace("Z", "+00:00"))
        pm_sample = pm_by_timestamp.get(zone_sample["timestamp"], pm_samples[sample_index] if sample_index < len(pm_samples) else None)
        if pm_sample is None:
            continue

        for zone in zone_sample["zones"]:
            static_zone = registry[str(zone["zone_id"])]
            traffic_level = traffic_level_from_pressure(float(zone["traffic_pressure"]))
            weather_index = {"clear": 0.0, "rain": 0.5, "heavy_rain": 1.0}[str(zone["weather"])]
            traffic_index = {"low": 0.0, "medium": 0.5, "high": 1.0}[traffic_level]
            restriction_index = {"normal": 0.0, "caution": 0.35, "restricted": 0.7, "wharf": 1.0}[str(zone["restriction_level"])]
            zone_movers = [mover for mover in pm_sample["prime_movers"] if mover["zone_id"] == zone["zone_id"]]

            for mover_index, mover in enumerate(zone_movers):
                vehicle_id = str(mover["vehicle_id"])
                history = histories.setdefault(vehicle_id, [])
                event_type = live_state_to_event_type(str(mover["state"]))
                current_event = {
                    "timestamp": sample_time,
                    "speed": mover["speed"],
                    "speed_limit": mover["speed_limit"],
                    "event_type": event_type,
                    "gps_freshness": mover["gps_freshness"],
                }
                window_events = [
                    item
                    for item in [*history, current_event]
                    if sample_time - item["timestamp"] <= timedelta(minutes=10)
                ]
                speeds = [float(item["speed"]) for item in window_events]
                speed_over = max(0, float(mover["speed"]) - float(mover["speed_limit"]))
                speeding_events = sum(1 for item in window_events if float(item["speed"]) > float(item["speed_limit"]))
                harsh_count = sum(1 for item in window_events if item["event_type"] == "harsh_brake")
                sharp_count = sum(1 for item in window_events if item["event_type"] == "sharp_turn")
                alert_events = sum(
                    1
                    for item in window_events
                    if item["event_type"] in {"speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"}
                )
                mean_speed = mean(speeds)
                last_three = window_events[-3:]
                speed_delta = float(last_three[-1]["speed"]) - float(last_three[0]["speed"]) if len(last_three) >= 2 else 0.0
                interaction_available = str(mover["gps_freshness"]) != "stale"
                nearest_distance = 160.0 + (mover_index % 3) * 45.0 if interaction_available and len(zone_movers) > 1 else 999.0
                nearby_vehicle_count = 0
                relative_speed = abs(float(mover["speed"]) - float(zone_movers[(mover_index + 1) % len(zone_movers)]["speed"])) if interaction_available and len(zone_movers) > 1 else 0.0
                closing_rate = 1.6 + (sample_index % 5) * 0.7 if interaction_available and len(zone_movers) > 1 else 0.0

                routine_context_risk = (
                    0.035
                    + min(0.035, float(zone["traffic_pressure"]) * 0.025)
                    + (0.02 if str(zone["weather"]) == "rain" else 0.0)
                    + (0.02 if str(zone["restriction_level"]) in {"caution", "restricted", "wharf"} else 0.0)
                    + min(0.025, max(0.0, float(mover["speed"]) / max(float(mover["speed_limit"]), 1) - 0.75) * 0.12)
                    + (mover_index % 4) * 0.006
                )

                rows.append(
                    {
                        "vehicle_id": f"PM-ROUTINE-BASELINE-{sample_index:04d}-{vehicle_id}",
                        "evaluation_timestamp": sample_time.isoformat(),
                        "prediction_horizon": f"{HORIZON_MINUTES}m",
                        "label_source": "SYNTHETIC_ROUTINE_LIVE_BASELINE",
                        "review_status": "synthetic_reviewed",
                        "matched_normal_window": True,
                        "speed": int(mover["speed"]),
                        "speed_limit": int(mover["speed_limit"]),
                        "event_type": event_type,
                        "gps_freshness": mover["gps_freshness"],
                        "traffic_level": traffic_level,
                        "weather": zone["weather"],
                        "zone_historical_risk": static_zone["zone_historical_risk"],
                        "restriction_level": zone["restriction_level"],
                        "slow_down_zone_active": zone["slow_down_zone_active"],
                        "pedestrian_exposure": zone["pedestrian_exposure"],
                        "speed_over_limit": round(speed_over, 2),
                        "speed_over_limit_band": speed_band(speed_over),
                        "speeding_ratio_5m": round(speeding_events / max(len(window_events), 1), 3),
                        "speeding_ratio_10m": round(speeding_events / max(len(window_events), 1), 3),
                        "mean_speed_5m": round(mean_speed, 2),
                        "mean_speed_30m": round(mean_speed, 2),
                        "max_speed_5m": round(max(speeds or [0]), 2),
                        "speed_std_10m": round(std(speeds), 2),
                        "speed_delta_last_3_events": round(speed_delta, 2),
                        "harsh_brake_count_10m": harsh_count,
                        "sharp_turn_count_10m": sharp_count,
                        "recent_harsh_brake_count_10m": harsh_count,
                        "recent_sharp_turn_count_10m": sharp_count,
                        "alert_density_30m": round(alert_events / 0.5, 2),
                        "risk_escalation_rate": 0.0,
                        "shift_hours": 4.2,
                        "night_flag": False,
                        "time_since_last_intervention": 999,
                        "reaction_window_active": False,
                        "post_intervention_noncompliance": False,
                        "traffic_weather_compound_index": round((traffic_index + weather_index) / 2, 2),
                        "zone_transition_risk": round(restriction_index, 2),
                        "nearby_vehicle_count_50m": nearby_vehicle_count,
                        "nearest_vehicle_distance_m": nearest_distance,
                        "nearest_vehicle_relative_speed_kmh": round(relative_speed, 1),
                        "closing_rate_mps": round(closing_rate, 2),
                        "interaction_features_available": interaction_available,
                        "previous_risk": 0.12,
                        "risk_trend": "stable",
                        "latent_synthetic_risk": round(min(0.15, routine_context_risk), 3),
                        "near_miss_within_next_15m": 0,
                        "intervention_contaminated_window": False,
                    }
                )
                history.append(current_event)

    return rows


def routine_live_low_signal_near_miss_boundary_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []

    for index, baseline_row in enumerate(routine_live_baseline_rows()):
        for duplicate_index in range(9):
            rows.append(
                {
                    **baseline_row,
                    "vehicle_id": f"{baseline_row['vehicle_id']}-LOW-CAL-N{duplicate_index:02d}",
                    "label_source": "SYNTHETIC_ROUTINE_LOW_SIGNAL_DISTRIBUTION_CALIBRATION",
                    "matched_normal_window": True,
                    "latent_synthetic_risk": min(0.15, 0.04 + duplicate_index * 0.006),
                    "near_miss_within_next_15m": 0,
                    "intervention_contaminated_window": False,
                }
            )

        rows.append(
            {
                **baseline_row,
                "vehicle_id": str(baseline_row["vehicle_id"]).replace("PM-ROUTINE-BASELINE", "PM-ROUTINE-LOW-SIGNAL-BOUNDARY"),
                "label_source": "SYNTHETIC_ROUTINE_LOW_SIGNAL_NEAR_MISS_BOUNDARY",
                "matched_normal_window": False,
                "latent_synthetic_risk": 0.18,
                "near_miss_within_next_15m": 1,
                "intervention_contaminated_window": False,
            }
        )

    return rows


def routine_low_signal_boundary_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T12:40:00+08:00")

    for index in range(520):
        positive_tail = False
        speed_limit = 25 if index % 3 else 15
        speed_over = 0 if positive_tail else (1 + (index % 3) if index % 11 == 0 else 0)
        speed = speed_limit + speed_over - (0 if positive_tail else index % 3)
        wharf_context = index % 6 == 0
        rain_context = index % 4 in {0, 1}
        active_slow_down = index % 5 == 0
        nearby_count = 1 if index % 3 == 0 else 0
        nearest_distance = 58.0 + (index % 4) * 12.0 if nearby_count else 999.0
        relative_speed = 4.0 + (index % 3) * 1.5 if nearby_count else 0.0

        rows.append(
            {
                "vehicle_id": f"PM-ROUTINE-BOUNDARY-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=index)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_ROUTINE_LOW_SIGNAL_BOUNDARY",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": not positive_tail,
                "speed": speed,
                "speed_limit": speed_limit,
                "event_type": "normal_update",
                "gps_freshness": "fresh",
                "traffic_level": "medium",
                "weather": "rain" if rain_context else "clear",
                "zone_historical_risk": 0.58 + (index % 4) * 0.025,
                "restriction_level": "wharf" if wharf_context else ("caution" if index % 2 == 0 else "normal"),
                "slow_down_zone_active": active_slow_down,
                "pedestrian_exposure": "medium" if wharf_context or index % 7 == 0 else "low",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": speed_band(speed_over),
                "speeding_ratio_5m": 0.0 if positive_tail else (0.08 if speed_over > 0 else 0.0),
                "speeding_ratio_10m": 0.0 if positive_tail else (0.08 if speed_over > 0 else 0.0),
                "mean_speed_5m": speed_limit * (0.82 + (index % 4) * 0.025),
                "mean_speed_30m": speed_limit * (0.8 + (index % 4) * 0.02),
                "max_speed_5m": max(speed, speed_limit),
                "speed_std_10m": 0.8 + (index % 5) * 0.18,
                "speed_delta_last_3_events": 0,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 0,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 0,
                "alert_density_30m": 0.0 if speed_over == 0 else 2.0,
                "risk_escalation_rate": 0.0,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.5 if rain_context else 0.25,
                "zone_transition_risk": 1.0 if wharf_context else (0.35 if index % 2 == 0 else 0.0),
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": nearest_distance,
                "nearest_vehicle_relative_speed_kmh": relative_speed,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.08 + (index % 4) * 0.015,
                "risk_trend": "stable",
                "latent_synthetic_risk": 0.18 if positive_tail else 0.05 + (index % 7) * 0.012,
                "near_miss_within_next_15m": 1 if positive_tail else 0,
                "intervention_contaminated_window": False,
            }
        )

    for index in range(180):
        speed_limit = 15 if index % 2 == 0 else 25
        speed_over = 1 + (index % 3)
        rows.append(
            {
                "vehicle_id": f"PM-ROUTINE-MINOR-NEG-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=700 + index)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_ROUTINE_LOW_SIGNAL_BOUNDARY",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": True,
                "speed": speed_limit + speed_over,
                "speed_limit": speed_limit,
                "event_type": "speeding",
                "gps_freshness": "fresh",
                "traffic_level": "medium",
                "weather": "rain",
                "zone_historical_risk": 0.66 if speed_limit == 15 else 0.72,
                "restriction_level": "restricted" if speed_limit == 15 else "caution",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": speed_band(speed_over),
                "speeding_ratio_5m": 0.02 + (index % 4) * 0.035,
                "speeding_ratio_10m": 0.02 + (index % 4) * 0.035,
                "mean_speed_5m": speed_limit - 0.8 + (index % 3) * 0.15,
                "mean_speed_30m": speed_limit - 0.9 + (index % 3) * 0.15,
                "max_speed_5m": speed_limit + speed_over,
                "speed_std_10m": 0.55 + (index % 5) * 0.22,
                "speed_delta_last_3_events": index % 3,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 0,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 0,
                "alert_density_30m": 2.0 + (index % 3) * 2.0,
                "risk_escalation_rate": 0.04 + (index % 3) * 0.035,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.5,
                "zone_transition_risk": 0.7 if speed_limit == 15 else 0.35,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 70.0 + (index % 7) * 20.0,
                "nearest_vehicle_relative_speed_kmh": 3.0 + (index % 5),
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.04 + (index % 5) * 0.012,
                "risk_trend": "increasing",
                "latent_synthetic_risk": 0.08 + (index % 5) * 0.015,
                "near_miss_within_next_15m": 0,
                "intervention_contaminated_window": False,
            }
        )

    return rows


def compound_scenario_pattern_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T12:00:00+08:00")

    for index in range(180):
        harsh_count = 1 + (index % 2)
        sharp_count = 1
        event_type = "harsh_brake" if index % 4 != 3 else "risk_persistent"
        speed = 24 + (index % 3)
        speed_over = max(0, speed - 25)
        near_miss_label = 1 if index % 10 < 8 else 0
        rows.append(
            {
                "vehicle_id": f"PM-COMPOUND-CAL-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_COMPOUND_INTERVENTION_PATTERN",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": False,
                "speed": speed,
                "speed_limit": 25,
                "event_type": event_type,
                "gps_freshness": "fresh",
                "traffic_level": "high",
                "weather": "rain",
                "zone_historical_risk": 0.72,
                "restriction_level": "caution",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": speed_band(speed_over),
                "speeding_ratio_5m": 0.25 + (index % 2) * 0.083,
                "speeding_ratio_10m": 0.25 + (index % 2) * 0.083,
                "mean_speed_5m": 24,
                "mean_speed_30m": 24,
                "max_speed_5m": 26,
                "speed_std_10m": 1.35 + (index % 3) * 0.15,
                "speed_delta_last_3_events": 0 if event_type == "risk_persistent" else 4,
                "harsh_brake_count_10m": harsh_count,
                "sharp_turn_count_10m": sharp_count,
                "recent_harsh_brake_count_10m": harsh_count,
                "recent_sharp_turn_count_10m": sharp_count,
                "alert_density_30m": 4.0 + (index % 3) * 2.0,
                "risk_escalation_rate": 0.0,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 0.65 + (index % 4) * 0.45,
                "reaction_window_active": False,
                "post_intervention_noncompliance": True,
                "traffic_weather_compound_index": 0.75,
                "zone_transition_risk": 0.35,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999.0,
                "nearest_vehicle_relative_speed_kmh": 0.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.58,
                "risk_trend": "stable",
                "latent_synthetic_risk": 0.72 if near_miss_label else 0.38,
                "near_miss_within_next_15m": near_miss_label,
                "intervention_contaminated_window": False,
            }
        )

    for index in range(140):
        speed = 26 + (index % 2)
        speed_over = speed - 25
        near_miss_label = 1 if index % 10 < 7 else 0
        rows.append(
            {
                "vehicle_id": f"PM-COMPOUND-FIRST-CAL-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=390 + index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_COMPOUND_FIRST_INTERVENTION_PATTERN",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": False,
                "speed": speed,
                "speed_limit": 25,
                "event_type": "harsh_brake",
                "gps_freshness": "fresh",
                "traffic_level": "high",
                "weather": "rain",
                "zone_historical_risk": 0.72,
                "restriction_level": "caution",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": speed_band(speed_over),
                "speeding_ratio_5m": 0.3 + (index % 2) * 0.04,
                "speeding_ratio_10m": 0.3 + (index % 2) * 0.04,
                "mean_speed_5m": 24,
                "mean_speed_30m": 24,
                "max_speed_5m": speed,
                "speed_std_10m": 1.55 + (index % 3) * 0.12,
                "speed_delta_last_3_events": 4,
                "harsh_brake_count_10m": 1,
                "sharp_turn_count_10m": 1,
                "recent_harsh_brake_count_10m": 1,
                "recent_sharp_turn_count_10m": 1,
                "alert_density_30m": 4.0 + (index % 2) * 2.0,
                "risk_escalation_rate": 0.16,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.75,
                "zone_transition_risk": 0.35,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999.0,
                "nearest_vehicle_relative_speed_kmh": 0.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.12,
                "risk_trend": "increasing",
                "latent_synthetic_risk": 0.68 if near_miss_label else 0.36,
                "near_miss_within_next_15m": near_miss_label,
                "intervention_contaminated_window": False,
            }
        )

    for index in range(120):
        near_miss_label = 1 if index % 10 < 7 else 0
        rows.append(
            {
                "vehicle_id": f"PM-WHARF-CAL-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=420 + index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_WHARF_MANEUVER_PATTERN",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": False,
                "speed": 18 + (index % 2),
                "speed_limit": 15,
                "event_type": "sharp_turn",
                "gps_freshness": "fresh",
                "traffic_level": "medium",
                "weather": "clear",
                "zone_historical_risk": 0.78,
                "restriction_level": "wharf",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "high",
                "speed_over_limit": 3 + (index % 2),
                "speed_over_limit_band": "minor",
                "speeding_ratio_5m": 0.5,
                "speeding_ratio_10m": 0.5,
                "mean_speed_5m": 15,
                "mean_speed_30m": 15,
                "max_speed_5m": 18 + (index % 2),
                "speed_std_10m": 3.0,
                "speed_delta_last_3_events": 6,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 1,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 1,
                "alert_density_30m": 2.0,
                "risk_escalation_rate": 0.08,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.25,
                "zone_transition_risk": 1.0,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999.0,
                "nearest_vehicle_relative_speed_kmh": 0.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.12,
                "risk_trend": "increasing",
                "latent_synthetic_risk": 0.7 if near_miss_label else 0.36,
                "near_miss_within_next_15m": near_miss_label,
                "intervention_contaminated_window": False,
            }
        )

    return rows


def routine_minor_speed_baseline_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T13:00:00+08:00")

    for index in range(160):
        speed_over = 1 + (index % 3)
        speed = 15 + speed_over
        rows.append(
            {
                "vehicle_id": f"PM-ROUTINE-MINOR-SPEED-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_ROUTINE_MINOR_SPEED_BASELINE",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": True,
                "speed": speed,
                "speed_limit": 15,
                "event_type": "speeding",
                "gps_freshness": "fresh",
                "traffic_level": "medium",
                "weather": "rain",
                "zone_historical_risk": 0.66,
                "restriction_level": "restricted",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": "minor",
                "speeding_ratio_5m": 0.18 + (index % 3) * 0.02,
                "speeding_ratio_10m": 0.18 + (index % 3) * 0.02,
                "mean_speed_5m": 14.7,
                "mean_speed_30m": 14.7,
                "max_speed_5m": speed,
                "speed_std_10m": 1.35,
                "speed_delta_last_3_events": 0,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 0,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 0,
                "alert_density_30m": 8.0 + (index % 3) * 2.0,
                "risk_escalation_rate": 0.08 + (index % 2) * 0.02,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.5,
                "zone_transition_risk": 0.7,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 100.0 + (index % 3) * 25.0,
                "nearest_vehicle_relative_speed_kmh": 5.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.16,
                "risk_trend": "increasing",
                "latent_synthetic_risk": 0.22,
                "near_miss_within_next_15m": 0,
                "intervention_contaminated_window": False,
            }
        )

    return rows


def telemetry_uncertainty_pattern_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T14:00:00+08:00")

    for index in range(160):
        stale = index % 2 == 0
        speed = 28 if stale else 27
        speed_over = speed - 25
        near_miss_label = 1 if index % 10 < 7 else 0
        rows.append(
            {
                "vehicle_id": f"PM-UNCERTAIN-CAL-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_TELEMETRY_UNCERTAINTY_PATTERN",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": False,
                "speed": speed,
                "speed_limit": 25,
                "event_type": "stale_gps" if stale else "normal_update",
                "gps_freshness": "stale" if stale else "delayed",
                "traffic_level": "high",
                "weather": "rain",
                "zone_historical_risk": 0.66,
                "restriction_level": "restricted",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": speed_over,
                "speed_over_limit_band": "minor",
                "speeding_ratio_5m": 1.0,
                "speeding_ratio_10m": 1.0,
                "mean_speed_5m": 28 if stale else 27.5,
                "mean_speed_30m": 28 if stale else 27.5,
                "max_speed_5m": 28,
                "speed_std_10m": 0 if stale else 0.5,
                "speed_delta_last_3_events": 0 if stale else -1,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 0,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 0,
                "alert_density_30m": 2.0,
                "risk_escalation_rate": 0.0,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.75,
                "zone_transition_risk": 0.7,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999.0,
                "nearest_vehicle_relative_speed_kmh": 0.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.12,
                "risk_trend": "stable",
                "latent_synthetic_risk": 0.7 if near_miss_label else 0.36,
                "near_miss_within_next_15m": near_miss_label,
                "intervention_contaminated_window": False,
            }
        )

    for index in range(80):
        rows.append(
            {
                "vehicle_id": f"PM-UNCERTAIN-RECOVERY-{index:03d}",
                "evaluation_timestamp": (base_time + timedelta(minutes=420 + index * 2)).isoformat(),
                "prediction_horizon": f"{HORIZON_MINUTES}m",
                "label_source": "SYNTHETIC_TELEMETRY_UNCERTAINTY_RECOVERY",
                "review_status": "synthetic_reviewed",
                "matched_normal_window": True,
                "speed": 20,
                "speed_limit": 25,
                "event_type": "speed_normalized",
                "gps_freshness": "fresh",
                "traffic_level": "high",
                "weather": "rain",
                "zone_historical_risk": 0.66,
                "restriction_level": "restricted",
                "slow_down_zone_active": False,
                "pedestrian_exposure": "medium",
                "speed_over_limit": 0,
                "speed_over_limit_band": "none",
                "speeding_ratio_5m": 0.667,
                "speeding_ratio_10m": 0.667,
                "mean_speed_5m": 25,
                "mean_speed_30m": 25,
                "max_speed_5m": 28,
                "speed_std_10m": 3.56,
                "speed_delta_last_3_events": -8,
                "harsh_brake_count_10m": 0,
                "sharp_turn_count_10m": 0,
                "recent_harsh_brake_count_10m": 0,
                "recent_sharp_turn_count_10m": 0,
                "alert_density_30m": 2.0,
                "risk_escalation_rate": 0.0,
                "shift_hours": 4.2,
                "night_flag": False,
                "time_since_last_intervention": 999,
                "reaction_window_active": False,
                "post_intervention_noncompliance": False,
                "traffic_weather_compound_index": 0.75,
                "zone_transition_risk": 0.7,
                "nearby_vehicle_count_50m": 0,
                "nearest_vehicle_distance_m": 999.0,
                "nearest_vehicle_relative_speed_kmh": 0.0,
                "closing_rate_mps": 0.0,
                "interaction_features_available": True,
                "previous_risk": 0.12,
                "risk_trend": "decreasing",
                "latent_synthetic_risk": 0.22,
                "near_miss_within_next_15m": 0,
                "intervention_contaminated_window": False,
            }
        )

    return rows


def write_rows(rows: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    write_rows(
        [
            *generate_rows(),
            *slow_down_zone_advisory_rows(),
            *routine_live_baseline_rows(),
            *routine_live_low_signal_near_miss_boundary_rows(),
            *routine_low_signal_boundary_rows(),
            *compound_scenario_pattern_rows(),
            *routine_minor_speed_baseline_rows(),
            *telemetry_uncertainty_pattern_rows(),
        ],
        DATA_DIR / "synthetic_training_data.csv",
    )
    print("Wrote data/synthetic_training_data.csv")
