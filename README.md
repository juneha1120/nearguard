# NearGuard

NearGuard is a local hackathon MVP for Prime Mover safety incident risk prevention. It replays synthetic telematics scenarios, uses a local scikit-learn risk model pipeline, runs an agentic safety loop, simulates tool calls and approvals, and shows an auditable supervisor dashboard.

## Prerequisites

- Node.js 20+ or 22+
- npm
- Python 3.11+ recommended

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by execution policy.

## Install

```powershell
npm.cmd install
python -m pip install -r requirements.txt
```

## Generate AI Model Artifacts

```powershell
python scripts\train_model.py
```

This writes:

- `data/synthetic_training_data.csv`
- `models/nearguard-risk-model.joblib`
- `models/scenario_predictions.json`

The web app uses `models/scenario_predictions.json` for reliable demo replay while keeping the trained `.joblib` artifact as the local AI model output.

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

Use the scenario selector in the dashboard, then click `Step` or `Play`.

Recommended first demo:

```text
PM-27 Persistent High Risk
```

This demonstrates speeding, harsh braking, supervisor notification timeout, fallback notification, persistent high risk, human approval and safety case creation.

## Docs

Start with `docs/README.md` for the project document map.
