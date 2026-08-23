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

`data/scenarios.json` remains the deterministic replay source for the dashboard. It uses `VehicleEvent` rows with `timestamp`, `vehicle_id`, `zone_id`, `event_type`, `speed`, `speed_limit` and `gps_freshness`.

`data/synthetic_training_data.csv` is generated from longer vehicle time series. Each row represents an evaluation snapshot:

```text
vehicle_id
evaluation_timestamp
prediction_horizon = 15m
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

## AI Training Pipeline

1. Generate synthetic vehicle time-series telemetry with fixed seed.
2. Compute 5/10/30-minute rolling features at each evaluation timestamp.
3. Generate a latent synthetic risk pressure from temporal patterns, context and intervention response.
4. Sample future synthetic near-miss events and label `near_miss_within_next_15m`.
5. Train a scikit-learn `HistGradientBoostingClassifier`.
6. Export the model artifact, basic holdout metrics and deterministic replay predictions.
7. Preserve clear language: the output is synthetic risk evidence, not PSA production probability.

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
- low-confidence inputs trigger human review
- disruptive intervention still requires approval
- tool failure is logged and followed by fallback/escalation
