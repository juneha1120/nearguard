# NearGuard

NearGuard is a human-in-the-loop safety agent prototype for Prime Mover operations in port and logistics environments. It replays synthetic telematics scenarios, uses a local scikit-learn risk model pipeline, runs an agentic safety loop, simulates tool calls and approvals, and shows an auditable supervisor dashboard.

The model uses rolling telemetry windows and context to estimate synthetic near-miss risk within the next 15 minutes; it is not a single-event alert or a validated production accident predictor.

The project originated from the PSA Code Sprint 2.0 "Agentic AI in Action" challenge. It remains related to PSA through public port-safety context and Prime Mover operating themes, but it was not shortlisted and is not affiliated with, endorsed by, or connected to PSA operational systems.

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

The core dashboard and replay flow require generated model artifacts. Run model training before starting the app or model service.

Worker-report extraction is part of the workflow. The implementation uses Gemini for ease of local setup; configure the same values as `.env.example`:

```text
GEMINI_API_KEY=
GEMINI_REPORT_MODEL=gemini-3.1-flash-lite
LLM_REQUEST_TIMEOUT_MS=30000
```

`GEMINI_REPORT_MODEL` is set to `gemini-3.1-flash-lite`. No alternate Gemini API key or model fallback is required.

Live model inference uses:

```text
NEARGUARD_INFERENCE_URL=http://127.0.0.1:8001
```

If `NEARGUARD_INFERENCE_URL` is unset, the app calls `http://127.0.0.1:8001`. Live monitoring predictions require the Python inference service.

## Generate AI Model Artifacts

```powershell
npm.cmd run model:train
```

This writes:

- `data/synthetic_training_data.csv`
- `models/nearguard-risk-model.joblib`
- `models/scenario_predictions.json`
- `models/routine_live_predictions.json`

The app scripts run `npm run model:check` before startup and fail if these artifacts are missing or invalid. The web app uses `models/scenario_predictions.json` for scenario replay. Live monitoring uses the Python inference service backed by `models/nearguard-risk-model.joblib`; `models/routine_live_predictions.json` is retained as an exported artifact for inspection and model checks.

For live runtime inference, start the Python model service:

```powershell
npm.cmd run model:serve
```

The dashboard calls this service once per live telemetry tick. If the service is unavailable, the live prediction API returns an error instead of using checked-in predictions.

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

## Worker Report Extraction

`POST /api/worker-reports/extract` parses a plain-language worker safety observation into structured context. Gemini is the current provider for ease of use. Report extraction supports context review only: it does not set the final risk score, approve actions or replace deterministic policy and human review.

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
