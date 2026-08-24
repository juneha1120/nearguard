# NearGuard Implementation Plan

## Purpose

This document is the source of truth for implementing the NearGuard hackathon MVP. The target is a local, synthetic, telemetry-first safety intervention demo, not a production deployment.

The current implementation direction is a telemetry forecast safety model: rolling Prime Mover history is used to predict synthetic near-miss risk within the next 15 minutes, then deterministic policy and human approval control interventions.

## Stack And Runtime

- Web app: Next.js, TypeScript, React and local in-memory state.
- AI pipeline: Python, pandas, scikit-learn and joblib.
- Model runtime: pretrained local artifact plus exported scenario predictions for deterministic demo playback.
- Storage: checked-in JSON/CSV fixtures and generated artifacts; no database for MVP.
- External integrations: none. Notifications, approvals and safety cases are simulated.

## Data And Artifact Contracts

`data/scenarios.json` remains the deterministic decision-evidence source for replay. It uses sparse `VehicleEvent` rows with `timestamp`, `vehicle_id`, `zone_id`, `event_type`, `speed`, `speed_limit` and `gps_freshness`. `Next Evidence` advances between these anchors; raw 1-second telemetry should not be traced as agent evidence.

`data/live_zone_telemetry.json` is the loopable 1-second Live Monitoring stream for zone cards and Prime Mover status when no scenario is selected.

`data/scenario_telemetry/{scenario}.json` contains dense 1-second primary Prime Mover telemetry for selected scenario playback. It fills the visual gaps between sparse evidence anchors.

`data/scenario_zone_telemetry/{scenario}.json` contains dense 1-second dynamic zone telemetry aligned to each selected scenario. Static zone registry/default context remains in `data/zones.json`; `zone_historical_risk` is a static synthetic prior, while weather, traffic, restrictions and pedestrian exposure are MVP defaults that can be overridden by dynamic zone telemetry.

`data/synthetic_training_data.csv` is generated from longer vehicle time series. Each row represents an evaluation snapshot:

```text
vehicle_id
evaluation_timestamp
prediction_horizon = 15m
label_source
review_status
matched_normal_window
rolling telemetry features
context features
operational history features
near_miss_within_next_15m
```

The target label is a synthetic future outcome, not a direct current-event score.

`models/scenario_predictions.json` must include:

```json
{
  "target": "near_miss_within_next_15m",
  "prediction_horizon": "15m",
  "predictions": [
    {
      "scenario_id": "pm27-persistent-high-risk",
      "event_id": "pm27-004",
      "assessment": {
        "synthetic_near_miss_risk_score": 0.77,
        "safety_incident_risk_score": 0.77,
        "prediction_horizon": "15m",
        "evidence_authority": "SYNTHETIC_DATA",
        "risk_band": "High",
        "confidence": "high",
        "uncertainty_reason": null,
        "top_risk_reasons": []
      }
    }
  ]
}
```

## Application Modules

- Types should expose rolling telemetry features and risk assessment metadata: `prediction_horizon` and `evidence_authority`.
- The feature aggregator should compute current and rolling-window fields from observed telemetry only.
- The risk service should consume exported scenario predictions for replay reliability.
- The policy engine should treat ML output as evidence and remain responsible for action class.
- The tool layer should keep simulated notifications, fallback notification, approval request, zone advisory recommendation and safety case creation.
- The dashboard should label the score as synthetic near-miss risk within the next 15 minutes and show that deterministic policy/human approval control interventions.
- The dashboard should separate `Telemetry Stream`, `Decision Evidence` and `Agent Trace`: dense PM/zone samples drive live visuals, while sparse scenario anchors drive risk assessment, policy and tool trace.
- The dashboard `Reset` control should return to unselected Live Monitoring mode, clearing replay state and scenario telemetry overlays.
- Scenario zone risk should be a documented blend of zone telemetry, event impact, latest agent/model risk and static zone prior, not a simple maximum.

## AI Training Pipeline

1. Generate synthetic vehicle time-series telemetry with fixed seed.
2. Compute 5/10/30-minute rolling features at each evaluation timestamp.
3. Generate a latent synthetic risk pressure from temporal patterns, context and intervention response.
4. Sample future synthetic near-miss events and label `near_miss_within_next_15m`.
5. Record label provenance and review metadata.
6. Train a scikit-learn `HistGradientBoostingClassifier`.
7. Export the model artifact, basic holdout metrics and deterministic replay predictions.
8. Preserve clear language: the output is synthetic risk evidence, not PSA production probability.

## Future Retraining Loop

Do not implement online learning in the MVP. A production retraining loop would:

- accept only safety-reviewed incident, near-miss and safe-operation labels
- build positive examples from telemetry windows before reviewed incidents
- sample matched normal windows from comparable zone, shift, traffic and weather conditions
- rebuild and validate the full training dataset in batches
- release a new model only after threshold, false-negative, false-alarm and lead-time checks pass

## Safety And Scope Boundaries

Adopt the following prompt-derived rules:

- `LLM is not the Safety Authority`.
- `UNKNOWN != SUCCESS`.
- Missing data reduces confidence and must not be hallucinated.
- Tool failure must remain visible and must not be treated as resolved risk.
- Unsafe residual risk must not be marked resolved.
- All prototype interventions remain simulation-only.

Do not implement real-time person tracking, TTC/stopping-margin logic, Kafka/broker-neutral streaming, XGBoost migration, memory retrieval or multi-horizon forecasting in this MVP branch. Vehicle-person interaction risk is a future extension that requires approved person-position data.

## Validation

Run:

- `npm run model:train`
- `npm test`
- `npm run build`

Required test coverage:

- generated labels include positive and negative examples
- exported predictions include horizon/evidence metadata
- high-risk replay scenarios score above stabilized scenarios
- dense scenario PM and zone telemetry are 1-second aligned
- low-confidence inputs trigger human review
- disruptive intervention still requires approval
- tool failure is logged and followed by fallback/escalation
