from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
import sys
from typing import Any

import joblib
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.train_model import (
    CATEGORICAL_FEATURES,
    HORIZON,
    MODEL_DIR,
    NUMERIC_FEATURES,
    confidence_and_reason,
    live_interaction_features,
    live_state_to_event_type,
    load_json,
    merge_routine_live_samples,
    parse_timestamp,
    reasons,
    risk_band,
    speed_band,
    state_risk,
    traffic_level_from_pressure,
)

MODEL_PATH = MODEL_DIR / "nearguard-risk-model.joblib"


@dataclass
class PendingPrediction:
    sample_id: str
    timestamp: str
    vehicle_id: str
    zone_id: str
    features: dict[str, Any]
    history: list[dict[str, Any]]
    current_event: dict[str, Any]


@dataclass
class LiveInferenceEngine:
    model: Any
    samples: list[dict[str, Any]]
    zones: dict[str, dict[str, Any]]
    histories: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    previous_risk_by_vehicle: dict[str, float] = field(default_factory=dict)
    cache: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    next_index: int = 0

    @classmethod
    def load(cls) -> "LiveInferenceEngine":
        if not MODEL_PATH.exists():
            raise RuntimeError(f"Missing model artifact: {MODEL_PATH}")
        artifact = joblib.load(MODEL_PATH)
        zones = {zone["zone_id"]: zone for zone in load_json(ROOT / "data" / "zone_registry.json")}
        return cls(model=artifact["model"], samples=merge_routine_live_samples(), zones=zones)

    def reset(self) -> None:
        self.histories.clear()
        self.previous_risk_by_vehicle.clear()
        self.cache.clear()
        self.next_index = 0

    def predict_sample(self, sample_id: str) -> list[dict[str, Any]]:
        target_index = next((index for index, sample in enumerate(self.samples) if sample["sample_id"] == sample_id), None)
        if target_index is None:
            raise KeyError(sample_id)

        if target_index < self.next_index and sample_id not in self.cache:
            self.reset()

        while self.next_index <= target_index:
            sample = self.samples[self.next_index]
            self.cache[sample["sample_id"]] = self._predict_next_sample(self.next_index)
            self.next_index += 1

        return self.cache[sample_id]

    def _predict_next_sample(self, sample_index: int) -> list[dict[str, Any]]:
        sample = self.samples[sample_index]
        sample_time = parse_timestamp(str(sample["timestamp"]))
        previous_sample = self.samples[sample_index - 1] if sample_index > 0 else None
        previous_time = parse_timestamp(str(previous_sample["timestamp"])) if previous_sample else None
        elapsed_seconds = max(0.001, (sample_time - previous_time).total_seconds()) if previous_time else 1
        pending: list[PendingPrediction] = []

        for zone in sample["zones"]:
            static_zone = self.zones[str(zone["zone_id"])]
            traffic_level = traffic_level_from_pressure(float(zone["traffic_pressure"]))
            weather_index = {"clear": 0.0, "rain": 0.5, "heavy_rain": 1.0}[str(zone["weather"])]
            traffic_index = {"low": 0.0, "medium": 0.5, "high": 1.0}[traffic_level]
            restriction_index = {"normal": 0.0, "caution": 0.35, "restricted": 0.7, "wharf": 1.0}[str(zone["restriction_level"])]
            previous_zone = None
            if previous_sample:
                previous_zone = next((item for item in previous_sample["zones"] if item["zone_id"] == zone["zone_id"]), None)

            for mover in zone["prime_movers"]:
                vehicle_id = str(mover["vehicle_id"])
                history = self.histories.setdefault(vehicle_id, [])
                event_type = live_state_to_event_type(str(mover["state"]))
                current_event = {
                    "timestamp": sample_time,
                    "speed": mover["speed"],
                    "speed_limit": mover["speed_limit"],
                    "event_type": event_type,
                    "gps_freshness": mover["gps_freshness"],
                }
                window_events = [item for item in [*history, current_event] if sample_time - item["timestamp"] <= timedelta(minutes=10)]
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
                mean_speed = sum(speeds) / max(len(speeds), 1)
                speed_std = (sum((value - mean_speed) ** 2 for value in speeds) / max(len(speeds), 1)) ** 0.5
                last_three = window_events[-3:]
                speed_delta = float(last_three[-1]["speed"]) - float(last_three[0]["speed"]) if len(last_three) >= 2 else 0
                previous_risk = self.previous_risk_by_vehicle.get(vehicle_id, 0.12)
                current_signal = speed_over / 25 + harsh_count * 0.1 + sharp_count * 0.1 + state_risk(str(mover["state"]))
                previous_mover = history[-1] if history else None
                speed_increased = bool(previous_mover and float(mover["speed"]) > float(previous_mover["speed"]) + 3)
                if mover["state"] == "recovering" or (previous_mover and float(mover["speed"]) < float(previous_mover["speed"]) - 3):
                    trend = "decreasing"
                elif current_signal > previous_risk + 0.04 or speed_increased:
                    trend = "increasing"
                else:
                    trend = "stable"

                feature = {
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
                    "speed_std_10m": round(speed_std, 2),
                    "speed_delta_last_3_events": round(speed_delta, 2),
                    "harsh_brake_count_10m": harsh_count,
                    "sharp_turn_count_10m": sharp_count,
                    "recent_harsh_brake_count_10m": harsh_count,
                    "recent_sharp_turn_count_10m": sharp_count,
                    "alert_density_30m": round(alert_events / 0.5, 2),
                    "risk_escalation_rate": round(max(0, current_signal - previous_risk), 3),
                    "shift_hours": 4.2,
                    "night_flag": False,
                    "time_since_last_intervention": 999,
                    "reaction_window_active": False,
                    "post_intervention_noncompliance": False,
                    "traffic_weather_compound_index": round((traffic_index + weather_index) / 2, 2),
                    "zone_transition_risk": round(restriction_index, 2),
                    **live_interaction_features(mover, zone, previous_zone, elapsed_seconds),
                    "previous_risk": round(previous_risk, 3),
                    "risk_trend": trend,
                }
                pending.append(
                    PendingPrediction(
                        sample_id=str(sample["sample_id"]),
                        timestamp=str(sample["timestamp"]),
                        vehicle_id=vehicle_id,
                        zone_id=str(zone["zone_id"]),
                        features=feature,
                        history=history,
                        current_event=current_event,
                    )
                )

        if not pending:
            return []

        model_input = pd.DataFrame([{key: item.features[key] for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES} for item in pending])
        scores = self.model.predict_proba(model_input)[:, 1].clip(0, 1)
        outputs = []

        for item, score_value in zip(pending, scores):
            score = float(score_value)
            confidence, uncertainty = confidence_and_reason(item.features, False)
            band = risk_band(score, confidence, False)
            outputs.append(
                {
                    "sample_id": item.sample_id,
                    "timestamp": item.timestamp,
                    "vehicle_id": item.vehicle_id,
                    "zone_id": item.zone_id,
                    "features": item.features,
                    "assessment": {
                        "synthetic_near_miss_risk_score": round(score, 3),
                        "safety_incident_risk_score": round(score, 3),
                        "prediction_horizon": HORIZON,
                        "evidence_authority": "SYNTHETIC_DATA",
                        "risk_band": band,
                        "confidence": confidence,
                        "uncertainty_reason": uncertainty,
                        "top_risk_reasons": reasons(item.features, confidence, uncertainty),
                    },
                }
            )
            self.previous_risk_by_vehicle[item.vehicle_id] = score
            item.history.append(item.current_event)

        return outputs


app = FastAPI(title="NearGuard Runtime Model Inference")
engine = LiveInferenceEngine.load()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model_loaded": True, "samples": len(engine.samples), "next_index": engine.next_index}


@app.post("/reset")
def reset() -> dict[str, bool]:
    engine.reset()
    return {"ok": True}


@app.get("/predict/live-sample/{sample_id}")
def predict_live_sample(sample_id: str) -> dict[str, Any]:
    try:
        predictions = engine.predict_sample(sample_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown sample_id: {sample_id}") from exc
    return {"source": "runtime_model_service", "prediction_horizon": HORIZON, "predictions": predictions}


if __name__ == "__main__":
    uvicorn.run("scripts.inference_service:app", host="127.0.0.1", port=8001, reload=False)
