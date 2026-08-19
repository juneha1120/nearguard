# NearGuard Implementation Plan

## Purpose

This document is the source of truth for implementing the NearGuard hackathon MVP. It turns the product, system design and AI/data methodology documents into concrete build decisions for the web app, agent loop and AI model.

The implementation target is a local demo product, not a production deployment. It shall use synthetic data, simulated tools and local artifacts only.

## Stack And Runtime

Use a Next.js and Python split:

- Web app: Next.js, TypeScript, React and local in-memory state.
- UI styling: CSS modules, Tailwind or a small local design system chosen at scaffold time; keep the dashboard dense, operational and demo-friendly.
- AI pipeline: Python with scikit-learn, pandas, numpy and joblib.
- Model runtime: pretrained local artifact plus exported scenario predictions for deterministic demo playback.
- Storage: checked-in JSON fixtures and generated artifacts; no database for MVP.
- External integrations: none. Notifications, approvals and safety cases are simulated.

The app should run locally with one web command and one optional model-training command.

## Repository Layout

Use this structure when scaffolding:

```text
app/
  api/
    scenarios/
    replay/
  page.tsx
components/
  dashboard/
  trace/
  approvals/
lib/
  agent/
  data/
  model/
  policy/
  tools/
  types/
models/
  nearguard-risk-model.joblib
  scenario_predictions.json
scripts/
  train_model.py
  generate_synthetic_training_data.py
data/
  scenarios.json
  zones.json
  synthetic_training_data.csv
tests/
```

If the selected Next.js scaffold uses a `src/` directory, place `app/`, `components/` and `lib/` under `src/` while keeping `models/`, `scripts/`, `data/` and `docs/` at the repository root.

## Data And Artifact Contracts

### Scenario Fixtures

`data/scenarios.json` shall contain all four scenarios from `docs/ai_and_data.md`.

Each scenario contains:

- `scenario_id`
- `name`
- `description`
- `primary_vehicle_id`
- ordered `events`
- expected demo highlights

Each event must conform to `VehicleEvent`:

```json
{
  "event_id": "evt-1027",
  "timestamp": "2026-08-19T09:14:02+08:00",
  "vehicle_id": "PM-27",
  "zone_id": "YARD-C4",
  "event_type": "harsh_brake",
  "speed": 29,
  "speed_limit": 25,
  "gps_freshness": "fresh"
}
```

`data/zones.json` shall contain the matching `ZoneContext` records for every `zone_id` used by scenario events.

### Model Artifact

`scripts/train_model.py` shall produce:

- `models/nearguard-risk-model.joblib`
- `models/scenario_predictions.json`
- `data/synthetic_training_data.csv`

`scenario_predictions.json` shall expose deterministic predictions keyed by scenario and event:

```json
{
  "scenario_id": "pm27-persistent-high-risk",
  "event_id": "evt-1027",
  "assessment": {
    "safety_incident_risk_score": 0.84,
    "risk_band": "High",
    "confidence": "medium",
    "uncertainty_reason": null,
    "top_risk_reasons": [
      "Speed is 4 km/h above the zone limit.",
      "Repeated harsh-braking events occurred within 10 minutes.",
      "Vehicle is operating in a high-traffic caution zone."
    ]
  }
}
```

The Next.js MVP may consume `scenario_predictions.json` directly for replay reliability. The Python model artifact remains available to prove that predictions come from a trained local AI model.

## Application Modules

### Types

Create shared TypeScript types for:

- `VehicleEvent`
- `ZoneContext`
- `DerivedFeatures`
- `RiskAssessment`
- `RiskBand`
- `VehicleCase`
- `ToolCall`
- `ApprovalRequest`
- `SafetyCase`
- `TraceEvent`
- `Scenario`

Types should match the field names in `docs/design.md` and `docs/ai_and_data.md`.

### Agent Loop

Implement the agent as a deterministic state machine around model outputs:

1. Load the selected scenario and zone context.
2. Ingest the next event.
3. Validate and normalize the event.
4. Join zone context, or record missing context for the uncertainty scenario.
5. Calculate derived features.
6. Load the matching model prediction from `scenario_predictions.json`.
7. Derive or confirm risk band.
8. Apply deterministic safety policy.
9. Simulate selected tool calls.
10. Record trace events for every meaningful step.
11. Reassess after follow-up events.
12. Stabilize, escalate or create a safety case according to policy.

The replay flow should support step-by-step and auto-play modes.

### Policy Engine

Use the documented policy thresholds:

- Low: monitor.
- Medium: notify driver.
- High: notify driver and supervisor.
- Persistent High: request approval for zone advisory or stronger intervention.
- Critical / Low Confidence: urgent supervisor escalation or human review.

Policy must not allow the model to directly approve or execute disruptive actions.

### Tool Simulation

Implement these local simulated tools:

- `get_vehicle_state`
- `get_zone_risk`
- `notify_driver`
- `notify_supervisor`
- `fallback_notify_supervisor`
- `request_human_approval`
- `recommend_zone_advisory`
- `create_safety_case`

For the PM-27 scenario, the first `notify_supervisor` call must fail with `timeout`, then `fallback_notify_supervisor` must succeed.

For the telemetry uncertainty scenario, one zone lookup step must fail or return unavailable context, reducing confidence and triggering human review.

### Dashboard

The first screen should be the usable supervisor dashboard, not a landing page.

Required dashboard areas:

- scenario selector and replay controls
- active Prime Movers / active cases list
- selected case detail
- current event and zone context
- derived risk features
- risk score, risk band, confidence and uncertainty
- top risk reasons
- recommended action and authority class
- tool call statuses
- approval request panel
- safety case summary
- chronological execution trace

The dashboard should make the agentic loop visible without long explanatory text inside the app.

## AI Training Pipeline

Implement the Python pipeline as follows:

1. Generate synthetic rows from the four scenario families.
2. Use fixed random seeds for repeatability.
3. Calculate derived features.
4. Create synthetic labels using the weighted risk recipe from `docs/ai_and_data.md`.
5. Add light deterministic noise and clip labels to `0.0-1.0`.
6. Train a scikit-learn gradient boosting regressor inside a reproducible preprocessing pipeline.
7. Evaluate basic holdout metrics such as MAE and R2 for sanity, not production claims.
8. Export the trained model with joblib.
9. Run the documented scenario fixtures through the trained model.
10. Export deterministic scenario predictions for the web app.

Confidence and `uncertainty_reason` are computed deterministically after prediction from data quality and signal consistency.

Explanations are generated from active high-risk features and should produce at least three reasons for high-risk cases where available.

## API And State Contracts

Use local API routes or server actions with these minimum contracts:

- `GET /api/scenarios`: returns available scenario metadata.
- `POST /api/replay/start`: starts or resets a scenario replay.
- `POST /api/replay/step`: advances one event and returns updated app state.
- `POST /api/replay/approve`: records approval or rejection for a pending approval.

The replay state response should include:

- selected scenario
- current event index
- active cases
- selected case
- latest risk assessment
- tool calls
- pending approvals
- created safety cases
- trace events

For the hackathon MVP, API state may live in memory. A page refresh may reset replay state.

## Testing And Acceptance

Add tests for:

- schema validation rejects malformed events and records trace failure
- derived feature calculation for speed over limit and recent event counts
- risk band mapping at threshold boundaries
- policy decisions for Low, Medium, High, Persistent High and Critical / Low Confidence
- PM-27 end-to-end flow includes supervisor timeout, fallback, approval and safety case
- slow-down-zone scenario shows speed-limit risk and stabilization after speed normalizes
- wharf scenario shows pedestrian exposure as a top reason
- telemetry uncertainty lowers confidence and escalates to human review
- trace events remain chronological and include model outputs, policy decisions, tool calls, failures, approvals and results

Minimum acceptance before demo:

- training script runs and exports model artifacts
- app starts locally
- all four scenarios replay
- PM-27 flow reaches safety case creation
- telemetry uncertainty flow shows low confidence and human review
- dashboard displays at least three high-risk reasons where available
- final trace satisfies the demo checklist in `docs/demo_plan.md`

## Build Order

Implement in this order:

1. Scaffold the Next.js and Python project structure.
2. Add shared TypeScript types and JSON fixtures for zones and scenarios.
3. Build the Python synthetic data generator and training script.
4. Export model artifact and scenario predictions.
5. Implement derived feature utilities and policy engine.
6. Implement agent replay state machine and simulated tools.
7. Build the supervisor dashboard around replay state.
8. Add tests for features, policy and scenario flows.
9. Polish demo copy, trace labels and responsive layout.

## Assumptions

- The MVP prioritizes demo reliability over live model-serving complexity.
- The web app may consume exported prediction artifacts while keeping the trained model artifact in the repo for credibility.
- No real PSA credentials, driver identities, live telemetry or production systems are used.
- Worker reports remain future scope and should not be part of the first implementation unless explicitly reprioritized.
