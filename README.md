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

## Environment

The core dashboard, replay flow and exported prediction fallback run without external credentials.

Optional worker-report extraction uses Gemini. `GEMINI_API_KEY` is preferred, with `GOOGLE_API_KEY` as a fallback:

```text
GEMINI_API_KEY=
GOOGLE_API_KEY=
GEMINI_REPORT_MODEL=gemini-3.1-flash-lite
LLM_MODEL=
LLM_REQUEST_TIMEOUT_MS=30000
```

`LLM_MODEL` is a fallback for `GEMINI_REPORT_MODEL`; the implementation default is `gemini-2.5-flash`.

Optional live model inference uses:

```text
NEARGUARD_INFERENCE_URL=http://127.0.0.1:8001
```

If `NEARGUARD_INFERENCE_URL` is unset, the app calls `http://127.0.0.1:8001`. If that service is unavailable, live monitoring stays deterministic by falling back to checked-in exported predictions.

## Generate AI Model Artifacts

```powershell
npm.cmd run model:train
```

This writes:

- `data/synthetic_training_data.csv`
- `models/nearguard-risk-model.joblib`
- `models/scenario_predictions.json`
- `models/routine_live_predictions.json`

The web app uses `models/scenario_predictions.json` and `models/routine_live_predictions.json` for reliable scenario replay and routine live monitoring while keeping the trained `.joblib` artifact as the local AI model output.

For live runtime inference, start the optional Python model service:

```powershell
npm.cmd run model:serve
```

The dashboard calls this service once per live telemetry tick. If the service is not running, it falls back to `models/routine_live_predictions.json` so the demo remains deterministic.

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

## Optional Worker Report Extraction

`POST /api/worker-reports/extract` parses a plain-language worker safety observation into structured context using Gemini when an API key is configured. This is optional enrichment only: it does not set the final risk score, approve actions or replace deterministic policy and human review.

## Verify

```powershell
npm.cmd run lint
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
