# NearGuard Implementation Plan

## Purpose

This document captures the current implementation contract for the NearGuard hackathon MVP. The target is a local, synthetic, telemetry-first safety intervention demo, not a production deployment.

The current implementation direction is a telemetry forecast safety model: rolling Prime Mover history is used to predict synthetic near-miss risk within the next 15 minutes, then deterministic policy and human approval control interventions.

MVP+ adds a narrow V2V/V2X interaction-aware risk layer: surrounding Prime Mover proximity and relative motion are used as extra features for the same 15-minute Vehicle Near-Miss Risk path. Conformal uncertainty, numeric prediction intervals and multi-horizon forecasting remain production roadmap items.

## Stack And Runtime

- Web app: Next.js, TypeScript, React and local in-memory state.
- AI pipeline: Python, pandas, scikit-learn and joblib.
- Model runtime: pretrained local artifact served by the Python inference service for live monitoring, plus exported scenario predictions for deterministic replay.
- Storage: checked-in JSON fixtures plus generated CSV/model/prediction artifacts; no database for MVP.
- External integrations: worker-report extraction uses Gemini for ease of local setup. Notifications, approvals and safety cases are simulated.

## Environment Contract

Use the `.env.example` structure for local configuration:

| Variable | Purpose |
| --- | --- |
| `NEARGUARD_INFERENCE_URL` | Python inference service base URL. Defaults to `http://127.0.0.1:8001` when unset. |
| `GEMINI_API_KEY` | API key for the current Gemini-backed worker-report extraction provider. |
| `GEMINI_REPORT_MODEL` | Gemini model for worker-report extraction. Current value: `gemini-3.1-flash-lite`. |
| `LLM_REQUEST_TIMEOUT_MS` | Worker-report extraction timeout. Defaults to 30000ms. |

## Data And Artifact Contracts

`data/scenario_decision_points/{scenario}.json` is the deterministic decision-point source for replay. Each file uses sparse `VehicleEvent` rows with `timestamp`, `vehicle_id`, `zone_id`, `event_type`, `speed`, `speed_limit` and `gps_freshness`. `Next Decision` advances between threshold-relevant assessment anchors; raw 1-second telemetry supports continuous visuals and scoring context without tracing every sample as a policy decision.

`data/routine_live_zone_telemetry.json` is the loopable 1-second routine Live Monitoring stream for zone cards when no scenario is selected.

`data/routine_prime_mover_telemetry.json` is the matching loopable 1-second routine Prime Mover snapshot stream. Runtime Live Monitoring joins this PM stream onto `data/routine_live_zone_telemetry.json`, so zone telemetry provides operating context while Prime Mover telemetry is the source of vehicle snapshots.

`data/scenario_prime_mover_telemetry/{scenario}.json` contains dense 1-second primary Prime Mover telemetry for selected scenario playback. It fills the visual gaps between sparse decision-point anchors.

`data/scenario_live_zone_telemetry/{scenario}.json` contains dense 1-second dynamic zone telemetry aligned to each selected scenario. Static zone registry data remains in `data/zone_registry.json`; `zone_historical_risk` is a static synthetic prior, while weather, traffic, restrictions and pedestrian exposure are runtime operating-context fields. The replay feature path should overlay the latest scenario zone telemetry sample at or before the decision timestamp before deriving features.

`data/synthetic_training_data.csv` is generated from longer vehicle time series. Each row represents an evaluation snapshot:

```text
vehicle_id
evaluation_timestamp
prediction_horizon = 15m
label_source
review_status
matched_normal_window
rolling telemetry features
same-zone V2V interaction features
context features
operational history features
label governance metadata including intervention_contaminated_window
near_miss_within_next_15m
```

The target label is a synthetic future outcome, not a direct current-event score.

Both prediction artifacts must include `target`, `prediction_horizon` and `assessment` metadata. Scenario predictions identify replay events; routine live predictions identify telemetry samples and vehicles for artifact inspection only:

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

```json
{
  "target": "near_miss_within_next_15m",
  "prediction_horizon": "15m",
  "predictions": [
    {
      "sample_id": "routine-live-0001",
      "vehicle_id": "PM-101",
      "zone_id": "YARD-C4",
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
- The feature aggregator should apply a 10-second reaction window after an intervention signal; unsafe telemetry inside that window is not `post_intervention_noncompliance`.
- The live feature aggregator should compute same-zone nearby PM count within 50m, nearest PM distance, nearest PM relative speed and closing rate when position data is usable.
- The risk service should consume exported scenario predictions for replay reliability.
- Routine Live Monitoring should call the Python runtime inference service for per-tick trained-model scoring. It must not silently use checked-in prediction files as live output.
- The policy engine should map continuous ML risk scores to intervention thresholds and remain responsible for action class.
- The tool layer should keep simulated notifications, fallback notification, approval request, zone advisory recommendation and safety case creation.
- The dashboard should label the score as synthetic near-miss risk within the next 15 minutes and show that deterministic policy/human approval control interventions.
- The dashboard should separate live zone monitoring, vehicle risk signal and AI assessment timeline: dense PM/zone samples drive visuals, while sparse scenario decision points show when continuous scoring crosses policy thresholds or stabilizes.
- The dashboard `Reset` control should return to unselected Live Monitoring mode, clearing replay state and scenario telemetry overlays.
- Scenario zone risk should be calculated from live zone telemetry fields. Do not blend it with vehicle model risk; show Zone Operational Risk separately from continuous Vehicle Near-Miss Risk.
- Worker report extraction is a context-enrichment workflow feature. The current parser uses Gemini for ease of setup and may produce `WorkerRiskReport` context fields, but it must not set risk scores, bypass policy or authorize disruptive actions.

## API Surface

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/scenarios` | `GET` | List scenario metadata for the dashboard selector. |
| `/api/zones` | `GET` | Return static zone registry entries. |
| `/api/live-zone-telemetry` | `GET` | Return loopable routine live zone/Prime Mover telemetry samples. |
| `/api/live-risk-predictions?sample_id=...` | `GET` | Call the runtime inference service for a live sample. |
| `/api/scenario-telemetry?scenario_id=...` | `GET` | Return dense scenario Prime Mover telemetry for visual playback. |
| `/api/scenario-zone-telemetry?scenario_id=...` | `GET` | Return dense scenario zone telemetry aligned to playback. |
| `/api/replay/start` | `POST` | Start or reset a replay session for a selected scenario. |
| `/api/replay/step` | `POST` | Advance to the next decision-point event. |
| `/api/replay/previous` | `POST` | Rewind to the previous decision-point event while preserving completed approvals and safety cases. |
| `/api/replay/approve` | `POST` | Record approval or rejection of a pending intervention. |
| `/api/worker-reports/extract` | `POST` | Parse worker report text into structured context using the current Gemini-backed provider. |

`GET /api/live-risk-predictions?sample_id=...` requires `sample_id`. It calls `${NEARGUARD_INFERENCE_URL}/predict/live-sample/{sample_id}` with a short timeout. If the runtime service is unavailable or returns a non-success response, the API returns `502`; it does not fall back to checked-in predictions.

`POST /api/worker-reports/extract` accepts:

```json
{
  "description": "Workers are crossing near WHARF-C4 during rain.",
  "reporter_role": "worker"
}
```

`description` is required. `reporter_role` defaults to `worker`. Success returns `{ "report": WorkerRiskReport }`; malformed input returns `400`, and missing credentials, timeout or provider failures return `502` with an error message.

## Public Types To Keep Stable

- `RiskAssessment`: model evidence for a case and timestamp, including `safety_incident_risk_score`, `prediction_horizon = 15m`, `evidence_authority = SYNTHETIC_DATA`, `risk_band`, confidence, uncertainty and reasons.
- `DerivedFeatures`: current, rolling, context, operational-history and V2V features. V2V fields include `nearby_vehicle_count_50m`, `nearest_vehicle_distance_m`, `nearest_vehicle_relative_speed_kmh`, `closing_rate_mps` and `interaction_features_available`.
- `WorkerRiskReport`: LLM-derived report record with source/model metadata, extracted context and confidence.
- `WorkerReportExtractedContext`: structured hazard/context fields extracted from worker text; usable only as reviewed enrichment, not action authority.

## AI Training Pipeline

1. Generate synthetic vehicle time-series telemetry with fixed seed.
2. Compute 5/10/30-minute rolling features at each evaluation timestamp.
3. Generate a latent synthetic risk pressure from temporal patterns, V2V interaction pressure, context and intervention response.
4. Sample future synthetic near-miss events and label `near_miss_within_next_15m`; production labeling should mark positive lead-time windows, exclude the final action-dead-zone minute before an incident and tag intervention-contaminated windows separately.
5. Record label provenance and review metadata.
6. Exclude `intervention_contaminated_window=true` rows from default MVP training and record the excluded row count in metrics.
7. Train a scikit-learn `HistGradientBoostingClassifier`.
8. Export the model artifact, basic holdout metrics, deterministic scenario predictions and deterministic routine live predictions.
9. Run `npm run model:check` before app or service startup so missing or invalid generated artifacts fail fast.
10. Preserve clear language: the output is synthetic risk evidence, not PSA production probability.

## Future Retraining Loop

Do not implement online learning in the MVP. A production retraining loop would:

- accept only safety-reviewed incident, near-miss and safe-operation labels
- build positive examples from documented lead-time windows before reviewed incidents
- exclude action-dead-zone and post-incident windows that would leak unavailable evidence
- mask or separately evaluate windows where prior intervention may have prevented the outcome
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
- Drivers are given the MVP 10-second reaction window after a warning before residual unsafe telemetry is marked as post-intervention noncompliance.
- Successful intervention windows are label-governance exceptions, not ordinary safe negatives.
- All prototype interventions remain simulation-only.

Do not implement real-time person tracking, TTC/stopping-margin logic, Kafka/broker-neutral streaming, XGBoost migration, memory retrieval, conformal prediction, numeric confidence intervals or multi-horizon forecasting in this MVP branch. Vehicle-person interaction risk is a future extension that requires approved person-position data.

Production roadmap items should remain explicit: richer topology-aware multi-vehicle interaction features, conformal or quantile uncertainty, multi-horizon targets, chassis/laden-state proxies and edge/cloud separation for immediate in-cab warnings versus slower yard-level optimization. The MVP reaction-window and intervention-contamination handling is a lightweight bias-control guardrail, not production counterfactual modeling.

## Validation

Run:

- `npm run model:train`
- `npm run model:check`
- `npm run model:serve`
- `npm run lint`
- `npm test`
- `npm run build`

Required test coverage:

- generated labels include positive and negative examples
- exported predictions include horizon/evidence metadata
- high-risk replay scenarios score above stabilized scenarios
- dense scenario PM and zone telemetry are 1-second aligned
- V2V helper calculates nearby count, nearest distance, relative speed and positive closing rate for approaching PMs
- missing or stale position disables interaction features and lowers confidence
- low-confidence inputs trigger human review
- disruptive intervention still requires approval
- tool failure is logged and followed by fallback/escalation
- worker report extraction sends constrained prompts through the current Gemini provider, normalizes unknown values and fails visibly when credentials are absent
