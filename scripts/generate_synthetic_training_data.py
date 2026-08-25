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


def write_rows(rows: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    write_rows(generate_rows(), DATA_DIR / "synthetic_training_data.csv")
    print("Wrote data/synthetic_training_data.csv")
