# NearGuard AI And Data

## Purpose

This document is the source of truth for NearGuard's synthetic data, scripted scenarios and accident / safety incident risk prediction model methodology. It defines the variables, feature engineering, model target, synthetic label approach, confidence handling and explanation strategy used by the hackathon MVP.

NearGuard uses synthetic data because real PSA production telemetry, incident labels, near-miss records and internal safety policies are not available for the prototype. Synthetic labels and risk scores demonstrate model mechanics and agentic workflow integration; they are not evidence of production prediction accuracy.

## Data Principles

- Generate Prime Mover telemetry first; this is the MVP live input.
- Join telemetry with synthetic `ZoneContext` before prediction.
- Generate coherent event sequences, not isolated random rows.
- Keep scripted scenarios deterministic for demo reliability.
- Use fixed random seeds for synthetic training data and label noise.
- Include follow-up events after interventions so NearGuard can reassess whether risk decreased.
- Use public PSA safety materials only as context and scenario inspiration.
- Do not represent any generated event as a real PSA event, real driver behaviour or real incident record.

## Core Entities

### VehicleEvent

| Field | Type / Allowed Values | Notes |
| --- | --- | --- |
| `event_id` | string, unique | Example: `evt-1027`. |
| `timestamp` | ISO 8601 datetime | Use increasing timestamps within each scenario. |
| `vehicle_id` | string | Example: `PM-27`. |
| `zone_id` | string | Must match a `ZoneContext.zone_id`. |
| `event_type` | `normal_update`, `speeding`, `harsh_brake`, `sharp_turn`, `stale_gps`, `speed_normalized`, `risk_persistent` | Main event category. |
| `speed` | number, 0-50 km/h | Demo range for Prime Mover scenarios. |
| `speed_limit` | 15, 25 or 40 km/h | 15 for wharf-like areas, 25 for PPT Link slow-down-zone scenario, 40 for main port road scenario. |
| `gps_freshness` | `fresh`, `delayed`, `stale` | Used for prediction and confidence. |

### ZoneContext

| Field | Type / Allowed Values | Notes |
| --- | --- | --- |
| `zone_id` | string, unique | Example: `PPT-LINK-25`, `WHARF-C4`. |
| `zone_name` | string | Human-readable location label. |
| `traffic_level` | `low`, `medium`, `high` | May change by scenario step if needed. |
| `weather` | `clear`, `rain`, `heavy_rain` | Synthetic environmental context. |
| `zone_historical_risk` | number, 0.0-1.0 | Synthetic baseline, not real historical PSA risk. |
| `restriction_level` | `normal`, `caution`, `restricted`, `wharf` | Used for policy and explanation. |
| `slow_down_zone_active` | boolean | True in the PPT Link slow-down-zone scenario. |
| `pedestrian_exposure` | `low`, `medium`, `high` | Higher in wharf and crossing scenarios. |

### Agent-Managed Entities

| Entity | Key Fields |
| --- | --- |
| `VehicleCase` | `case_id`, `vehicle_id`, `status`, `current_risk`, `previous_risk`, `confidence`, `risk_reasons`, `recommended_action`, `pending_approval`, `created_at`, `updated_at` |
| `RiskAssessment` | `assessment_id`, `case_id`, `safety_incident_risk_score`, `confidence`, `uncertainty_reason`, `top_risk_reasons`, `created_at` |
| `ToolCall` | `tool_call_id`, `case_id`, `tool_name`, `arguments`, `status`, `result`, `error`, `timestamp` |
| `ApprovalRequest` | `approval_id`, `case_id`, `requested_action`, `rationale`, `status`, `approver`, `decision_time` |
| `SafetyCase` | `safety_case_id`, `case_id`, `summary`, `evidence`, `created_at`, `status` |
| `TraceEvent` | `trace_id`, `case_id`, `timestamp`, `event_type`, `message`, `metadata` |
| `WorkerRiskReport` | Optional future enrichment: `report_id`, `timestamp`, `reporter_role`, `zone_id`, `vehicle_id`, `description`, `extracted_context`, `extraction_confidence` |

## Derived Features

| Feature | Rule |
| --- | --- |
| `speed_over_limit` | `max(0, speed - speed_limit)`. |
| `speed_over_limit_band` | `none` if 0, `minor` if 1-10, `moderate` if 11-20, `severe` if greater than 20. |
| `recent_harsh_brake_count_10m` | Count `harsh_brake` events for same vehicle in prior 10 minutes. |
| `recent_sharp_turn_count_10m` | Count `sharp_turn` events for same vehicle in prior 10 minutes. |
| `previous_risk` | Most recent prior `safety_incident_risk_score` for the active case. |
| `risk_trend` | `increasing`, `stable` or `decreasing` based on previous and current risk. |

## Risk Score Bands

These bands are prototype policy thresholds, not PSA production thresholds.

| Band | Score Range | Default Policy Meaning |
| --- | --- | --- |
| Low | 0.00-0.39 | Monitor only. |
| Medium | 0.40-0.64 | Driver advisory. |
| High | 0.65-0.84 | Driver advisory plus supervisor notification. |
| Persistent High | 0.65-0.84 after prior action | Stronger response or approval workflow. |
| Critical / Low Confidence | 0.85-1.00, or high uncertainty with severe context | Urgent escalation or human review. |

## Scripted Scenarios

### PM-27 Persistent High Risk

Initial context: `PM-27` in `YARD-C4`, high traffic, rain, `zone_historical_risk = 0.72`, caution restriction and medium pedestrian exposure.

| Step | Event | Expected Result |
| --- | --- | --- |
| 1 | `normal_update`, speed 22, limit 25 | Low or medium risk, monitoring. |
| 2 | `speeding`, speed 32, limit 25 | Risk increases; speeding reason appears. |
| 3 | `harsh_brake`, speed 29, limit 25 | High risk; repeated braking reason appears. |
| 4 | `harsh_brake`, speed 27, limit 25 | Notify driver and supervisor. |
| 5 | Simulated supervisor notification timeout | Failure recorded and fallback used. |
| 6 | `risk_persistent`, speed 26, limit 25 | Persistent high risk. |
| 7 | Approval requested for zone advisory | Human approval gate shown. |
| 8 | Approval granted and safety case created | Trace includes approval and safety case. |

### PPT Link Slow Down Zone

Initial context: `PPT-LINK-25`, Pasir Panjang Terminal Link Slow Down Zone, speed limit 25, slow-down-zone active, caution restriction and `zone_historical_risk = 0.60`.

| Step | Event | Expected Result |
| --- | --- | --- |
| 1 | `normal_update`, speed 22 | Monitor. |
| 2 | `speeding`, speed 34 | High risk reason: exceeds slow-down-zone limit. |
| 3 | `speed_normalized`, speed 21 | Risk decreases and case can stabilize. |

### Wharf Pedestrian Exposure

Initial context: `WHARF-C4`, speed limit 15, wharf restriction, high pedestrian exposure, medium traffic and `zone_historical_risk = 0.78`.

| Step | Event | Expected Result |
| --- | --- | --- |
| 1 | `normal_update`, speed 12 | Medium contextual risk due to wharf exposure. |
| 2 | `sharp_turn`, speed 18 | High risk due to speed, sharp turn and pedestrian exposure. |
| 3 | Driver advisory delivered | Continue monitoring. |
| 4 | `speed_normalized`, speed 9 | Risk decreases. |

### Telemetry Uncertainty

Initial context: `YARD-U2`, high traffic, `zone_historical_risk = 0.66` and restricted zone context.

| Step | Event | Expected Result |
| --- | --- | --- |
| 1 | `stale_gps`, speed 28, limit 25, GPS stale | Confidence drops and uncertainty reason appears. |
| 2 | Zone context lookup fails | Model avoids overconfident claim. |
| 3 | Supervisor notified with low-confidence high-risk summary | Human review rather than autonomous stronger action. |
| 4 | GPS restored and speed 20 | Risk recalculated with improved confidence. |

## Model Methodology

NearGuard uses a tabular machine learning model to estimate `safety_incident_risk_score` from Prime Mover telemetry, zone context and recent vehicle behaviour. The recommended prototype model is a scikit-learn gradient boosting model trained on deterministic synthetic data generated from the four scenario families above.

Use a scikit-learn gradient boosting tabular model:

- Preferred: `HistGradientBoostingRegressor` or `GradientBoostingRegressor`.
- Target: `safety_incident_risk_score`, clipped to `0.0-1.0`.
- Runtime: pretrained local model artifact plus exported scenario predictions for demo reliability.
- Inputs: model-ready features from normalized telemetry, joined zone context and derived event-window features.

This is conventional for structured safety-risk prediction because it supports mixed numeric and categorical inputs, nonlinear interactions, fast local inference and interpretable feature-driven explanations. XGBoost is a reasonable alternative if the implementation environment already supports it, but scikit-learn is preferred for the MVP because setup stays small and reproducible.

## Feature Set

| Category | Features |
| --- | --- |
| Raw telemetry | `speed`, `speed_limit`, `event_type`, `gps_freshness` |
| Zone context | `traffic_level`, `weather`, `zone_historical_risk`, `restriction_level`, `slow_down_zone_active`, `pedestrian_exposure` |
| Derived behaviour | `speed_over_limit`, `speed_over_limit_band`, `recent_harsh_brake_count_10m`, `recent_sharp_turn_count_10m` |
| Case state | `previous_risk`, `risk_trend`, prior intervention indicator where available |

Categorical values should be encoded using a reproducible scikit-learn `Pipeline` or `ColumnTransformer`. Numeric features should be bounded to the documented demo ranges.

## Synthetic Label Recipe

The synthetic label generator should calculate a base risk score from weighted contributors, add light fixed-seed noise and clip the final label to `0.0-1.0`.

Recommended contributors:

| Contributor | Expected Effect |
| --- | --- |
| Speed over limit | Higher excess speed increases risk, especially in slow-down or wharf zones. |
| Repeated harsh braking | Recent repeated harsh braking increases risk and supports persistent high-risk detection. |
| Sharp turns | Sharp turns increase risk, especially with speed or pedestrian exposure. |
| Zone historical risk | Higher synthetic zone baseline raises contextual risk. |
| Traffic and weather | High traffic, rain and heavy rain increase risk. |
| Pedestrian exposure | Medium or high exposure increases risk, especially in wharf contexts. |
| GPS freshness | Delayed or stale GPS increases uncertainty and may increase cautious risk. |
| Previous risk and trend | High previous risk or increasing trend supports persistence. |

## Confidence And Uncertainty

Model confidence should be computed deterministically around input quality and signal consistency rather than treated as an unverified model probability.

- `high`: fresh telemetry, available zone context, sufficient recent history and consistent signals.
- `medium`: delayed GPS, sparse history or mild signal conflicts.
- `low`: stale GPS, unavailable zone context, missing required fields or severe signal conflicts.

`uncertainty_reason` should name the main cause, such as `stale GPS signal`, `missing zone context`, `sparse recent vehicle history` or `conflicting risk signals`. Low-confidence high-risk situations should trigger human review or urgent escalation rather than autonomous stronger action.

## Explanations

Each high-risk assessment should provide at least three `top_risk_reasons` where available. Reasons should be phrased for supervisors.

Examples:

- Speed is 7 km/h above the zone limit.
- Four harsh-braking events occurred within 10 minutes.
- Vehicle is operating in a high-traffic caution zone.
- GPS signal is stale, so confidence is reduced.
- Pedestrian exposure is high in a wharf-like zone.

For the MVP, explanations may be model-informed by active high-risk features and offline feature importance. SHAP or permutation importance can be added later if it fits the implementation timeline, but the dashboard should prioritize concise operational reasons over technical charts.

## AI Safety Boundary

The AI model predicts risk. It does not decide final action authority, approve or execute disruptive actions. NearGuard's deterministic safety policy maps model outputs, confidence, uncertainty and case history to allowed intervention classes, and human supervisors approve zone advisories, rerouting recommendations or operational interventions.

Recommended pitch sentence:

> NearGuard uses a tabular AI model trained on synthetic Prime Mover scenarios to estimate safety incident risk; the AI predicts risk, while deterministic safety policy and human approval control what actions are allowed.

## Future Worker Report Enrichment

Worker reports can enrich zone context after the MVP. The LLM should translate plain language into structured context, not directly make safety decisions.

Rules:

- Use `extraction_confidence = low` when the report lacks location or clear hazard type.
- Do not let a worker report directly override `safety_incident_risk_score`.
- Use extracted context as temporary `ZoneContext` enrichment only.
- Require policy checks and human approval before any disruptive action.

## Production Path

A production-grade model would require approved real-world data, including historical telemetry, near-miss records, incident outcomes, safety observations and operational context. Future work may include probability calibration, class imbalance handling, explanation validation, temporal sequence models, spatial or graph-based zone models, drift monitoring and approved mapping into organization-specific safety policy.
