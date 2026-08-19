from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RANDOM_SEED = 42


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


def risk_trend(previous: float, current_hint: float) -> str:
    if current_hint > previous + 0.05:
        return "increasing"
    if current_hint < previous - 0.05:
        return "decreasing"
    return "stable"


def label_for(row: dict[str, object]) -> float:
    score = 0.08
    speed_over = float(row["speed_over_limit"])
    score += min(speed_over / 25, 1) * 0.28
    score += min(int(row["recent_harsh_brake_count_10m"]) / 5, 1) * 0.16
    score += min(int(row["recent_sharp_turn_count_10m"]) / 4, 1) * 0.12
    score += float(row["zone_historical_risk"]) * 0.19
    score += {"low": 0.0, "medium": 0.05, "high": 0.1}[str(row["traffic_level"])]
    score += {"clear": 0.0, "rain": 0.05, "heavy_rain": 0.09}[str(row["weather"])]
    score += {"low": 0.0, "medium": 0.06, "high": 0.12}[str(row["pedestrian_exposure"])]
    score += {"fresh": 0.0, "delayed": 0.04, "stale": 0.08}[str(row["gps_freshness"])]
    score += float(row["previous_risk"]) * 0.12
    if row["risk_trend"] == "increasing":
        score += 0.06
    if row["slow_down_zone_active"] and speed_over > 0:
        score += 0.05
    if row["restriction_level"] == "wharf" and speed_over > 0:
        score += 0.06
    if row["event_type"] == "risk_persistent":
        score += 0.08
    if row["event_type"] == "speed_normalized":
        score -= 0.18
    return max(0.0, min(1.0, score))


def generate_rows(count: int = 3200) -> list[dict[str, object]]:
    random.seed(RANDOM_SEED)
    scenarios = load_json(DATA_DIR / "scenarios.json")
    zones = {zone["zone_id"]: zone for zone in load_json(DATA_DIR / "zones.json")}
    rows: list[dict[str, object]] = []
    base_time = datetime.fromisoformat("2026-08-19T08:00:00+08:00")

    scenario_weights = {
        "pm27-persistent-high-risk": 0.38,
        "ppt-link-slow-down-zone": 0.2,
        "wharf-pedestrian-exposure": 0.22,
        "telemetry-uncertainty": 0.2,
    }
    scenario_ids = list(scenario_weights)
    weights = [scenario_weights[item] for item in scenario_ids]
    by_id = {scenario["scenario_id"]: scenario for scenario in scenarios}

    previous_by_vehicle: dict[str, float] = {}
    event_history: dict[str, list[tuple[datetime, str]]] = {}

    for idx in range(count):
        scenario_id = random.choices(scenario_ids, weights=weights, k=1)[0]
        scenario = by_id[scenario_id]
        event_template = random.choice(scenario["events"])
        zone = zones[event_template["zone_id"]]
        vehicle_id = f"{event_template['vehicle_id']}-{idx % 9}"
        event_time = base_time + timedelta(seconds=idx * 45)

        speed_limit = int(event_template["speed_limit"])
        speed_jitter = random.randint(-4, 5)
        speed = max(0, min(50, int(event_template["speed"]) + speed_jitter))
        if random.random() < 0.18:
            speed += random.randint(3, 9)
        speed = min(speed, 50)

        speed_over = max(0, speed - speed_limit)
        prior_events = [
            item
            for item in event_history.get(vehicle_id, [])
            if event_time - item[0] <= timedelta(minutes=10)
        ]
        harsh_count = sum(1 for _, kind in prior_events if kind == "harsh_brake")
        sharp_count = sum(1 for _, kind in prior_events if kind == "sharp_turn")
        if event_template["event_type"] == "harsh_brake":
            harsh_count += 1
        if event_template["event_type"] == "sharp_turn":
            sharp_count += 1

        previous_risk = previous_by_vehicle.get(vehicle_id, random.uniform(0.05, 0.45))
        current_hint = previous_risk + (speed_over / 50) + harsh_count * 0.04 + sharp_count * 0.04

        row = {
            "speed": speed,
            "speed_limit": speed_limit,
            "event_type": event_template["event_type"],
            "gps_freshness": event_template["gps_freshness"],
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
            "risk_trend": risk_trend(previous_risk, current_hint),
        }
        noise = random.uniform(-0.035, 0.035)
        row["safety_incident_risk_score"] = round(max(0.0, min(1.0, label_for(row) + noise)), 3)
        rows.append(row)
        previous_by_vehicle[vehicle_id] = float(row["safety_incident_risk_score"])
        event_history.setdefault(vehicle_id, []).append((event_time, str(event_template["event_type"])))

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
