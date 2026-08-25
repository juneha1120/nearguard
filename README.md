# NearGuard

NearGuard is a local hackathon MVP for Prime Mover safety incident risk prevention. It replays synthetic telematics scenarios, uses a local scikit-learn risk model pipeline, runs an agentic safety loop, simulates tool calls and approvals, and shows an auditable supervisor dashboard.

The model uses rolling telemetry windows and context to estimate synthetic near-miss risk within the next 15 minutes; it is not a single-event alert or a validated production accident predictor.

## Prerequisites

- Node.js 20+ or 22+
- npm
- Python 3.11+ recommended

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by execution policy.

## Install

```powershell
npm.cmd install
py -m pip install -r requirements.txt
```

## Generate AI Model Artifacts

```powershell
py scripts\train_model.py
```

This writes:

- `data/synthetic_training_data.csv`
- `models/nearguard-risk-model.joblib`
- `models/scenario_predictions.json`

The web app uses `models/scenario_predictions.json` for reliable demo replay while keeping the trained `.joblib` artifact as the local AI model output.

## Demo Data Layout

- `data/routine_live_zone_telemetry.json` drives the routine 1-second zone monitoring stream.
- `data/routine_prime_mover_telemetry.json` is the matching routine 1-second Prime Mover snapshot stream.
- `data/scenario_decision_points/{scenario}.json` defines sparse decision anchors for replay and policy/tool steps.
- `data/scenario_prime_mover_telemetry/{scenario}.json` provides dense 1-second Prime Mover telemetry during a selected scenario.
- `data/scenario_live_zone_telemetry/{scenario}.json` provides matching 1-second live zone telemetry during a selected scenario.
- `data/zone_registry.json` is static zone registry data only: IDs, names, map geometry and `zone_historical_risk`. Weather, restrictions, pedestrian exposure and other operating context live in telemetry files.

## Run The App

```powershell
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Verify

```powershell
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run build
```

## Demo Flow

Use the scenario selector in the dashboard, then click `Next Decision` or `Play`.

Recommended first demo:

```text
PM-27 Persistent High Risk
```

This demonstrates compound rolling telemetry risk, harsh braking, a sharp turn, supervisor notification timeout, fallback notification, persistent high risk, human approval and safety case creation.

## Docs

Start with `docs/README.md` for the project document map.
