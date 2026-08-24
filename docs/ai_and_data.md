# NearGuard AI And Data

## Purpose

This document is the source of truth for NearGuard's synthetic telemetry, labelled training snapshots and model methodology. The MVP demonstrates a supervised-learning pipeline for Prime Mover safety intervention without claiming access to real PSA incident labels.

NearGuard uses synthetic data because real PSA production telemetry, reviewed near-miss records, incident outcomes and internal safety policy are not available for the prototype. Synthetic labels demonstrate how telemetry-driven risk evidence can feed an agentic workflow; they are not evidence of production accident prediction accuracy.

## Data Principles

- Generate Prime Mover telemetry time series first; this is the MVP live input.
- Convert each vehicle history into evaluation snapshots using only data observed up to `evaluation_timestamp`.
- Label each snapshot with a future synthetic outcome: `near_miss_within_next_15m`.
- Preserve label provenance using `label_source`, `review_status` and `matched_normal_window`.
- Keep scripted replay scenarios deterministic for demo reliability.
- Use fixed random seeds for reproducible generated data and model artifacts.
- Keep public PSA context and prototype assumptions separate.
- Do not represent any generated event as a real PSA event, real driver behaviour or real incident record.

## Learning Target

The current model answers this prototype question:

```text
Given the Prime Mover telemetry and context observed up to time T,
is a synthetic near-miss event generated within the next 15 minutes?
```

The training target is:

```text
near_miss_within_next_15m: 0 | 1
```

The served score remains `safety_incident_risk_score` for app compatibility, but its meaning is:

```text
synthetic near-miss risk evidence within next 15 minutes
```

It must not be described as a PSA production probability or accident probability.

## Data Provenance And Core Inputs

The MVP is synthetic, but each field still has a defined role. This avoids mixing measured telemetry, static priors, derived features and model output.

| Class | Meaning | MVP Source | Future Source | Cadence |
| --- | --- | --- | --- | --- |
| Static registry | Slowly changing zone metadata and priors. | `data/zones.json` | Approved master data, yard map registry or safety configuration. | Controlled release. |
| Dynamic zone telemetry | Current zone operating state for dashboard zone cards. | `data/live_zone_telemetry.json`, `data/scenario_zone_telemetry/{scenario}.json` | Weather, yard traffic, access control, telemetry aggregation, approved pedestrian-density source. | Seconds to minutes. |
| Vehicle telemetry | Prime Mover movement and data quality. | `data/scenarios.json`, `data/scenario_telemetry/{scenario}.json` | Telematics, GPS/RTLS, vehicle system events. | Seconds. |
| Derived features | Rolling windows and engineered context. | `scripts/train_model.py`, `lib/model/features.ts` | Feature service using approved window definitions. | Per evaluation snapshot. |
| Labels | Future outcome used for training. | Synthetic latent process in generated CSV. | Safety-reviewed incident or near-miss labels plus matched normal windows. | Batch dataset rebuild. |
| Model output | Per-PM risk evidence. | `models/scenario_predictions.json` and `.joblib` artifact. | Versioned approved model service or artifact. | Per event/snapshot. |

`VehicleEvent` remains the sparse decision-evidence replay input:

| Field | Notes |
| --- | --- |
| `timestamp`, `vehicle_id`, `zone_id` | Identify the vehicle, time and operating zone. |
| `event_type` | `normal_update`, `speeding`, `harsh_brake`, `sharp_turn`, `stale_gps`, `speed_normalized`, `risk_persistent`. |
| `speed`, `speed_limit`, `gps_freshness` | Primary telemetry and confidence signals. |

`ZoneContext` provides registry defaults and a static synthetic prior:

| Field | Notes |
| --- | --- |
| `zone_historical_risk` | Static synthetic zone prior in the MVP. It is an input feature, not a model output and not updated by the live stream. |
| `traffic_level`, `weather`, `restriction_level`, `slow_down_zone_active`, `pedestrian_exposure` | MVP defaults. In production these are dynamic operating-context fields when live sources are available. |

Current `zone_historical_risk` values are hand-authored assumptions: `YARD-C4 = 0.72`, `PPT-LINK-25 = 0.60`, `WHARF-C4 = 0.78`, `YARD-U2 = 0.66`. They represent a synthetic prior for demo differentiation. In production, this value should be calculated offline from reviewed historical evidence, for example:

```text
zone_historical_risk =
  0.35 * reviewed_near_miss_rate
+ 0.20 * reviewed_incident_rate
+ 0.15 * harsh_brake_or_sharp_turn_rate
+ 0.10 * speeding_or_noncompliance_rate
+ 0.10 * pedestrian_exposure_index
+ 0.10 * traffic_complexity_index
```

The exact weights would need safety-owner approval, backtesting and calibration. Until then, the MVP must describe `zone_historical_risk` as a synthetic static prior.

The dashboard uses four checked-in demo data layers:

| Layer | Files | Purpose |
| --- | --- | --- |
| Idle zone stream | `data/live_zone_telemetry.json` | Loopable 1-second zone/Prime Mover monitoring when no intervention evidence is active. |
| Decision anchors | `data/scenarios.json` | Sparse evidence events consumed by replay, risk assessment, policy and tool simulation. |
| Scenario PM stream | `data/scenario_telemetry/{scenario}.json` | Dense 1-second primary Prime Mover telemetry for visual scenario playback between evidence anchors. |
| Scenario zone stream | `data/scenario_zone_telemetry/{scenario}.json` | Dense 1-second dynamic zone risk/context telemetry aligned to the selected scenario. |

Dense scenario telemetry is presentation/demo input. It makes the dashboard feel continuous, but only sparse decision anchors are traced as risk evidence and policy/tool events.

Runtime risk terms are intentionally separate:

| Value | Meaning |
| --- | --- |
| `live_risk` | Zone-level operational risk from live or scenario zone telemetry. It is not the ML model output. |
| `eventRisk` | Heuristic PM event impact used to make a scenario zone react. |
| `safety_incident_risk_score` | ML model output: per-PM, per-event synthetic near-miss risk evidence within the next 15 minutes. |
| `risk_band` | Deterministic banding from model score, confidence and prior action state. |

Live Monitoring reads `live_risk` directly from the looped zone telemetry stream and maps it to `Low`, `Medium` or `High`. During scenario replay, the active zone card blends zone telemetry, event impact, the latest agent/model risk score and the zone prior:

```text
scenario_zone_risk =
  0.50 * telemetry_risk
+ 0.20 * event_risk
+ 0.20 * safety_incident_risk_score
+ 0.10 * zone_historical_risk
```

The dashboard floors this blended value at `0.85 * zone_historical_risk` and caps it at `0.96`. This blend is a UI/replay overlay, not a retrained zone model.

## Rolling Features

Each training row represents an evaluation snapshot. Features are computed from past windows and current context:

| Category | Features |
| --- | --- |
| Current telemetry | `speed`, `speed_limit`, `speed_over_limit`, `speed_over_limit_band`, `event_type`, `gps_freshness` |
| Rolling speed | `speeding_ratio_5m`, `speeding_ratio_10m`, `mean_speed_5m`, `mean_speed_30m`, `max_speed_5m`, `speed_std_10m`, `speed_delta_last_3_events` |
| Rolling alerts | `harsh_brake_count_10m`, `sharp_turn_count_10m`, `alert_density_30m`, `risk_escalation_rate` |
| Context | `traffic_level`, `weather`, `zone_historical_risk`, `restriction_level`, `pedestrian_exposure`, `traffic_weather_compound_index`, `zone_transition_risk` |
| Operational history | `shift_hours`, `night_flag`, `time_since_last_intervention`, `post_intervention_noncompliance`, `previous_risk`, `risk_trend` |

Future telemetry rows must not be used to compute these features. Future outcomes are used only to create labels.

### Feature Taxonomy

NearGuard groups model inputs into four practical safety feature layers:

| Layer | NearGuard Features | Purpose |
| --- | --- | --- |
| Vehicle dynamics | `speed`, `speed_over_limit`, `speeding_ratio_5m`, `speeding_ratio_10m`, `mean_speed_5m`, `speed_std_10m`, `harsh_brake_count_10m`, `sharp_turn_count_10m` | Captures recent vehicle behaviour and instability. |
| Operational context | `zone_historical_risk`, `traffic_level`, `weather`, `restriction_level`, `pedestrian_exposure`, `slow_down_zone_active` | Adds where and under what operating conditions the vehicle is moving. In the MVP model pipeline these context values come from `data/zones.json`; production should prefer latest approved dynamic context where available. |
| Human / behaviour proxy | `shift_hours`, `night_flag`, `time_since_last_intervention`, `post_intervention_noncompliance` | Represents fatigue-like and response-to-advisory signals without using private biometrics. |
| Engineered risk signals | `alert_density_30m`, `risk_escalation_rate`, `traffic_weather_compound_index`, `zone_transition_risk`, `previous_risk`, `risk_trend` | Summarizes temporal accumulation and compound risk. |

Privacy-heavy signals such as eye tracking, HRV or driver biometrics are not part of the MVP. They remain future inputs only if approved and governed.

### Label Governance Metadata

Each row also carries label governance metadata:

| Field | MVP Value | Future Production Meaning |
| --- | --- | --- |
| `label_source` | `SYNTHETIC_LATENT_PROCESS` | `SAFETY_REVIEWED_INCIDENT`, `SAFETY_REVIEWED_NEAR_MISS` or approved proxy source. |
| `review_status` | `synthetic_reviewed` | Only `safety_reviewed` rows are eligible for production training. |
| `matched_normal_window` | `false` for generated synthetic rows | `true` when a normal/safe window is deliberately sampled to match positive windows by zone, shift, traffic and weather. |

## Synthetic Label Recipe

The generator creates a latent risk pressure over time rather than assigning a direct row-level score. Risk pressure increases when multiple conditions accumulate:

- sustained speeding over recent windows
- repeated harsh braking or sharp turns
- speed volatility and rising trend
- high zone baseline risk
- high traffic combined with rain or heavy rain
- high pedestrian exposure or wharf-like restrictions
- longer shift duration or night operation
- noncompliance after an intervention signal

A random shock is added with a fixed seed, then the generator samples whether a synthetic near-miss event occurs in the next 15 minutes. This creates both positive and negative examples for the classifier while preserving a documented relationship between risk factors and outcomes.

## Model Methodology

The MVP trains a local scikit-learn tabular classifier:

- Model: `HistGradientBoostingClassifier`.
- Target: `near_miss_within_next_15m`.
- Output: synthetic near-miss risk score, risk band, confidence, reasons, `prediction_horizon = 15m`, `evidence_authority = SYNTHETIC_DATA`.
- Runtime: checked-in model artifact and exported scenario predictions for deterministic demo playback.

`data/synthetic_training_data.csv` is the model training/evaluation table. It is not the dashboard replay stream. Replay uses `data/scenarios.json` for evidence anchors plus scenario-specific dense telemetry JSON for visual continuity.

`HistGradientBoostingClassifier` is a decision-tree-family gradient boosting model. It does not react to one isolated event as a single rule. It learns from engineered rolling-window features and context so the MVP can demonstrate how weak signals combine over time.

Simple safety violations can be handled by rules. For example, a speed-limit breach can trigger a deterministic advisory. The ML model is used for the harder prioritization problem: recent speeding ratio, harsh braking, speed volatility, traffic, weather, pedestrian exposure and intervention response may be individually tolerable but jointly indicate elevated near-miss risk.

The model is useful in the MVP because it demonstrates the supervised pipeline that would later use reviewed real labels. It does not prove real-world causality or PSA production accuracy.

## Rule, Model And Policy Separation

NearGuard deliberately separates three responsibilities:

| Layer | Responsibility |
| --- | --- |
| Rule checks | Catch obvious violations, data-quality problems and hard safety boundaries. |
| ML model | Estimate synthetic near-miss risk from rolling multi-variable telemetry and context patterns. |
| Safety policy and human approval | Decide permitted intervention class and gate disruptive actions. |

The model score informs the policy, but it does not approve actions, execute interventions or become the safety authority.

## Confidence And Explanations

Confidence is derived from data quality and signal coverage:

- `high`: fresh telemetry, available context and enough rolling signal.
- `medium`: delayed GPS or sparse recent history.
- `low`: stale GPS, missing context or severe uncertainty.

Explanations should name active rolling/context factors, such as speeding ratio, harsh braking, traffic-weather compound risk, pedestrian exposure, stale GPS or post-intervention noncompliance.

## AI Safety Boundary

The model predicts risk evidence. It does not decide action authority, approve interventions or execute disruptive actions. Deterministic safety policy maps model evidence and confidence to allowed action classes, and human supervisors approve disruptive recommendations.

Recommended pitch sentence:

> NearGuard uses rolling Prime Mover telemetry and synthetic future near-miss labels to demonstrate a supervised risk-prediction pipeline; the AI prioritizes risk, while deterministic safety policy and human approval control interventions.

## Future Production Path

A production-grade version would replace synthetic labels with reviewed operational outcomes:

- near-miss and incident records linked to prior telemetry windows
- safety observations and supervisor-reviewed intervention outcomes
- matched normal/safe telemetry windows from comparable zones, shifts, traffic and weather
- approved feature definitions, threshold analysis and false-negative/false-alarm evaluation
- subgroup checks across zones, shifts, weather and vehicle groups

New operational incidents should not be streamed directly into the model as immediate online learning. Production learning should use batch retraining:

```text
new incident or near-miss
-> safety review confirms label, time, vehicle, zone and severity
-> label builder creates pre-incident positive windows
-> matched normal windows are sampled for comparison
-> training dataset is rebuilt
-> model is retrained and validated
-> approved model artifact is released
```

Raw incident reports, duplicate reports, unresolved investigations and ambiguous post-incident windows should remain outside the training set until review is complete.

Real-time vehicle-person interaction risk remains a future optional lens if approved person-position data from CCTV analytics, RTLS or wearables becomes available. It should be deterministic and physics-based before any ML enhancement.
