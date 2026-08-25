# NearGuard AI And Data

## Purpose

This document owns NearGuard's synthetic telemetry, labelled training snapshots and model methodology. The MVP demonstrates a supervised-learning pipeline for Prime Mover safety intervention without claiming access to real PSA incident labels.

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
| Static zone registry | Slowly changing zone metadata, map geometry and synthetic historical prior only. | `data/zone_registry.json` | Approved master data, yard map registry or safety configuration. | Controlled release. |
| Routine live zone telemetry | Normal zone monitoring stream when no replay scenario is selected. | `data/routine_live_zone_telemetry.json` | Weather, yard traffic, access control, telemetry aggregation, approved pedestrian-density source. | Seconds to minutes. |
| Routine Prime Mover telemetry | Normal Prime Mover snapshot stream when no replay scenario is selected. | `data/routine_prime_mover_telemetry.json` | Telematics, GPS/RTLS, vehicle system events. | Seconds. |
| Scenario live zone telemetry | Scenario-specific live zone operating state aligned to replay. | `data/scenario_live_zone_telemetry/{scenario}.json` | Weather, yard traffic, access control, telemetry aggregation, approved pedestrian-density source. | Seconds to minutes. |
| Scenario Prime Mover telemetry | Scenario-specific Prime Mover movement and data quality. | `data/scenario_prime_mover_telemetry/{scenario}.json` | Telematics, GPS/RTLS, vehicle system events. | Seconds. |
| Derived features | Rolling windows and engineered context. | `scripts/train_model.py`, `lib/model/features.ts` | Feature service using approved window definitions. | Per evaluation snapshot. |
| Labels | Future outcome used for training. | Synthetic latent process in generated CSV. | Safety-reviewed incident or near-miss labels plus matched normal windows. | Batch dataset rebuild. |
| Model output | Per-PM risk evidence. | `models/scenario_predictions.json`, `models/routine_live_predictions.json` and `.joblib` artifact. | Versioned approved model service or artifact. | Per event/snapshot. |

`VehicleEvent` remains the sparse decision-evidence replay input:

| Field | Notes |
| --- | --- |
| `timestamp`, `vehicle_id`, `zone_id` | Identify the vehicle, time and operating zone. |
| `event_type` | `normal_update`, `speeding`, `harsh_brake`, `sharp_turn`, `stale_gps`, `speed_normalized`, `risk_persistent`. |
| `speed`, `speed_limit`, `gps_freshness` | Primary telemetry and confidence signals. |
| `position`, `heading_degrees`, `accuracy_m` | Synthetic yard-map pose used for MVP+ interaction features. Position is expressed in map units; V2V calculation converts using `10m` per map unit for demo consistency. |

`ZoneRegistryEntry` provides static zone metadata and a synthetic prior:

| Field | Notes |
| --- | --- |
| `zone_historical_risk` | Static synthetic zone prior in the MVP. It is an input feature, not a model output and not updated by the live stream. |
| `zone_id`, `zone_name`, `map_region`, `center`, `bounds` | Static identity and map display fields. |

`ZoneContext` is runtime operating context assembled from the static registry plus live telemetry:

| Field | Notes |
| --- | --- |
| `traffic_level`, `weather`, `restriction_level`, `slow_down_zone_active`, `pedestrian_exposure` | Dynamic operating-context fields. During scenario replay, the feature path overlays these fields from `data/scenario_live_zone_telemetry/{scenario}.json` before feature derivation. In production, the feature service should consume the latest approved operating-context stream. |

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
| Routine live zone stream | `data/routine_live_zone_telemetry.json` | Loopable 1-second zone monitoring when no replay scenario is active. |
| Routine Prime Mover stream | `data/routine_prime_mover_telemetry.json` | Loopable 1-second Prime Mover snapshots joined into routine zone context at runtime. |
| Scenario decision points | `data/scenario_decision_points/{scenario}.json` | Sparse threshold-relevant assessment anchors consumed by replay, risk assessment, policy and tool simulation. |
| Scenario Prime Mover stream | `data/scenario_prime_mover_telemetry/{scenario}.json` | Dense 1-second primary Prime Mover telemetry for visual scenario playback between decision points. |
| Scenario live zone stream | `data/scenario_live_zone_telemetry/{scenario}.json` | Dense 1-second dynamic zone risk/context telemetry aligned to the selected scenario. |
| Model prediction artifacts | `models/scenario_predictions.json`, `models/routine_live_predictions.json` | Deterministic trained-model outputs used by scenario replay and routine live monitoring. |

Dense scenario telemetry is presentation/demo input. It makes the dashboard feel continuous; sparse decision points show when continuous scoring crosses a policy threshold or records stabilization.

Runtime risk terms are intentionally separate:

| Value | Meaning |
| --- | --- |
| Zone Operational Risk | Dashboard risk value calculated from live zone telemetry fields such as traffic pressure, speed compliance, GPS quality, recent harsh-brake/sharp-turn counts, weather, restrictions and pedestrian exposure. It is not the vehicle ML model output. |
| Vehicle Near-Miss Risk | Continuous trained-model assessment from Prime Mover telemetry, rolling-window features and current zone context. Routine monitoring and scenario replay both use exported deterministic prediction artifacts for demo repeatability. |
| `safety_incident_risk_score` | ML model output: per-PM rolling synthetic near-miss risk assessment within the next 15 minutes. This score updates continuously, while interventions are opened only when policy thresholds are crossed. |
| `risk_band` | Deterministic banding from model score, confidence and prior action state; policy thresholds use this band to decide intervention class. |

Live Monitoring calculates Zone Operational Risk from zone telemetry, then reads exported trained-model predictions for Vehicle Near-Miss Risk. During scenario replay, dense scenario PM/zone telemetry keeps the display continuous while replay decision points use exported trained-model predictions for policy thresholds. The dashboard does not blend zone telemetry risk with vehicle model risk.

## Rolling Features

Each training row represents an evaluation snapshot. Features are computed from past windows and current context:

| Category | Features |
| --- | --- |
| Current telemetry | `speed`, `speed_limit`, `speed_over_limit`, `speed_over_limit_band`, `event_type`, `gps_freshness` |
| Rolling speed | `speeding_ratio_5m`, `speeding_ratio_10m`, `mean_speed_5m`, `mean_speed_30m`, `max_speed_5m`, `speed_std_10m`, `speed_delta_last_3_events` |
| Rolling alerts | `harsh_brake_count_10m`, `sharp_turn_count_10m`, `alert_density_30m`, `risk_escalation_rate` |
| V2V / V2X interaction | `nearby_vehicle_count_50m`, `nearest_vehicle_distance_m`, `nearest_vehicle_relative_speed_kmh`, `closing_rate_mps`, `interaction_features_available` |
| Context | `traffic_level`, `weather`, `zone_historical_risk`, `restriction_level`, `pedestrian_exposure`, `traffic_weather_compound_index`, `zone_transition_risk` |
| Operational history | `shift_hours`, `night_flag`, `time_since_last_intervention`, `reaction_window_active`, `post_intervention_noncompliance`, `previous_risk`, `risk_trend` |

Future telemetry rows must not be used to compute these features. Future outcomes are used only to create labels.

### Feature Taxonomy

NearGuard groups model inputs into four practical safety feature layers:

| Layer | NearGuard Features | Purpose |
| --- | --- | --- |
| Vehicle dynamics | `speed`, `speed_over_limit`, `speeding_ratio_5m`, `speeding_ratio_10m`, `mean_speed_5m`, `speed_std_10m`, `harsh_brake_count_10m`, `sharp_turn_count_10m` | Captures recent vehicle behaviour and instability. |
| V2V / V2X interaction | `nearby_vehicle_count_50m`, `nearest_vehicle_distance_m`, `nearest_vehicle_relative_speed_kmh`, `closing_rate_mps`, `interaction_features_available` | Adds same-zone surrounding PM proximity and relative-motion pressure. Missing, stale or low-accuracy position data disables these features and reduces confidence. |
| Operational context | `zone_historical_risk`, `traffic_level`, `weather`, `restriction_level`, `pedestrian_exposure`, `slow_down_zone_active` | Adds where and under what operating conditions the vehicle is moving. `zone_historical_risk` comes from `data/zone_registry.json`; all other operating-context fields come from live zone telemetry, with a conservative fallback only for missing-context demos. |
| Human / behaviour proxy | `shift_hours`, `night_flag`, `time_since_last_intervention`, `reaction_window_active`, `post_intervention_noncompliance` | Represents fatigue-like and response-to-advisory signals without using private biometrics. A 10-second MVP reaction window prevents immediate unsafe telemetry after a warning from being treated as noncompliance before the driver has had physical response time. |
| Engineered risk signals | `alert_density_30m`, `risk_escalation_rate`, `traffic_weather_compound_index`, `zone_transition_risk`, `previous_risk`, `risk_trend` | Summarizes temporal accumulation and compound risk. |

Privacy-heavy signals such as eye tracking, HRV or driver biometrics are not part of the MVP. They remain future inputs only if approved and governed.

This MVP+ implements the first surrounding-vehicle proxy only: same-zone nearby PM count within 50m, nearest PM distance, nearest PM relative speed and nearest PM closing rate. Future production feature expansion should evaluate richer port-yard interaction and physics proxies:

- nearby PM density within additional configured radii such as 25m
- relative heading bands and lane/topology-aware interaction features for surrounding vehicles
- lane-change, junction-crossing and blind-spot proximity indicators
- lateral acceleration or sharp-turn severity for rollover-sensitive manoeuvres
- chassis attached, bobtail/laden state and container weight class where approved

### Label Governance Metadata

Each row also carries label governance metadata:

| Field | MVP Value | Future Production Meaning |
| --- | --- | --- |
| `label_source` | `SYNTHETIC_LATENT_PROCESS` | `SAFETY_REVIEWED_INCIDENT`, `SAFETY_REVIEWED_NEAR_MISS` or approved proxy source. |
| `review_status` | `synthetic_reviewed` | Only `safety_reviewed` rows are eligible for production training. |
| `matched_normal_window` | `false` for generated synthetic rows | `true` when a normal/safe window is deliberately sampled to match positive windows by zone, shift, traffic and weather. |
| `intervention_contaminated_window` | `true` for post-intervention negative windows with residual risk signals that may have been changed by a successful warning. | Exclude from default training or route to counterfactual evaluation so successful interventions are not learned as ordinary safe negatives. |

MVP training excludes `intervention_contaminated_window=true` rows and records the excluded count in model metrics. This is a bias-control guardrail, not production counterfactual causal modeling.

## Synthetic Label Recipe

The generator creates a latent risk pressure over time rather than assigning a direct row-level score. Risk pressure increases when multiple conditions accumulate:

- sustained speeding or near-limit speed over recent windows
- harsh braking or sharp turns as manoeuvre-instability proxy signals
- speed volatility and rising trend
- high zone baseline risk
- high traffic combined with rain or heavy rain
- high pedestrian exposure or wharf-like restrictions
- longer shift duration or night operation
- noncompliance after an intervention signal
- nearby PM proximity, higher closing rate and larger relative speed

A random shock is added with a fixed seed, then the generator samples whether a synthetic near-miss event occurs in the next 15 minutes. This creates both positive and negative examples for the classifier while preserving a documented relationship between risk factors and outcomes.

For production labels, positive windows must be defined by lead time rather than by post-event data. A recommended rule is:

```text
near-miss at time T
positive training windows: T-15m through T-1m
action dead zone: T-1m through T, excluded from training
post-incident period: excluded until reviewed and stabilized
```

This prevents data leakage from telemetry that would not have been available early enough to act. If an intervention was issued and the near-miss did not occur, the window should not be treated as an ordinary negative sample. It is tagged as `intervention_contaminated_window` in the MVP and excluded from default training, because successful warnings can otherwise teach the model that dangerous pre-intervention patterns are safe.

## Model Methodology

The MVP trains a local scikit-learn tabular classifier:

- Model: `HistGradientBoostingClassifier`.
- Target: `near_miss_within_next_15m`.
- Output: synthetic near-miss risk score, risk band, confidence, reasons, `prediction_horizon = 15m`, `evidence_authority = SYNTHETIC_DATA`.
- Runtime: checked-in model artifact plus exported scenario and routine live predictions for deterministic demo playback.

`data/synthetic_training_data.csv` is the model training/evaluation table. It is not the dashboard replay stream. Replay uses `data/scenario_decision_points/{scenario}.json` for decision-point anchors plus scenario-specific dense telemetry JSON for visual continuity; routine live monitoring uses the routine telemetry JSON plus `models/routine_live_predictions.json`.

`HistGradientBoostingClassifier` is a decision-tree-family gradient boosting model. It does not react to one isolated event as a single rule. It learns from engineered rolling-window features and context so the MVP can demonstrate how weak signals combine over time.

Simple safety violations can be handled by rules. For example, a speed-limit breach can trigger a deterministic advisory, and repeated post-advisory instability can drive deterministic escalation. The ML model is used for the harder prioritization problem: near-limit speed, mild manoeuvre instability, speed volatility, traffic, weather, zone prior, pedestrian exposure and intervention response may be individually tolerable but jointly indicate elevated near-miss risk.

The MVP intentionally uses tabular gradient boosting rather than an LLM, temporal transformer or graph neural network because the demo prioritizes millisecond-scale lightweight inference, strong performance on structured telemetry, deterministic governance and inspectable feature reasons. A production roadmap can evaluate temporal deep learning or graph models once multi-vehicle proximity, edge telemetry and reviewed labels exist at sufficient quality.

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

Explanations should name active rolling/context factors, such as near-limit speed, speeding ratio, manoeuvre instability, nearby PM distance, closing rate, traffic-weather compound risk, zone prior, pedestrian exposure, stale GPS or post-intervention noncompliance. When surrounding-vehicle position is unavailable, the system keeps the 15-minute risk path working but lowers confidence with an uncertainty reason.

For a production safety case, confidence should be upgraded from rule labels to statistical uncertainty. Candidate approaches include conformal prediction for calibrated risk sets or quantile/interval models for numerical uncertainty bands. Multi-horizon targets should also be evaluated: 1-2 minutes for immediate avoidance, 5-15 minutes for route or slow-down intervention, and 30-60 minutes for shift or zone-level planning.

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
