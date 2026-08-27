# NearGuard Safety Boundary

## Prototype Status

NearGuard is a local hackathon MVP. It uses synthetic Prime Mover telemetry, synthetic labels, public-PSA-inspired context and simulated operational tools. It does not use live PSA telemetry, real driver identities, real near-miss records, production CCTV, RTLS, wearables or internal PSA safety policy.

## Hard Safety Rules

- LLM is not the Safety Authority.
- ML output is evidence only.
- Deterministic safety policy controls action class.
- Human approval is required for disruptive interventions.
- `UNKNOWN != SUCCESS`.
- Missing data must reduce confidence; it must not be hallucinated.
- Tool failure must remain visible in the trace and must not be marked as resolved risk.
- Unsafe residual risk must not be marked stabilized or closed.
- Unsafe telemetry inside the 10-second MVP reaction window after a driver warning must not be counted as post-intervention noncompliance.
- Successful intervention windows with residual risk signals must not be treated as ordinary safe negative training examples.
- All prototype interventions are simulation-only.

## Evidence Authority

NearGuard separates evidence sources:

| Evidence | Authority |
| --- | --- |
| Synthetic telemetry model score | `SYNTHETIC_DATA` |
| Public PSA safety context | Public source context only |
| Worker report extraction | Optional LLM-derived context only |
| Policy thresholds and rule weights | Representative prototype assumptions |
| Human approval in demo | Simulated approval |

The served `safety_incident_risk_score` means synthetic near-miss risk evidence within the next 15 minutes. It must not be described as a PSA production probability, collision probability or validated accident forecast.

## Prototype Assumptions

Current assumptions include risk-band thresholds, synthetic zone risk values, synthetic traffic/weather context, intervention thresholds, confidence rules and simulated tool outcomes. These assumptions are centrally documented here and in `docs/ai_and_data.md`; they are not PSA-approved production thresholds.

Reaction-window and intervention-contamination handling are MVP-level bias controls. They are not production counterfactual modeling or causal proof that an intervention prevented an incident.

Real-time vehicle-person interaction risk is not part of the MVP authority path. A future version may add deterministic distance, TTC, trajectory conflict and stopping-margin calculations only if approved person-position data is available.

Optional Gemini worker-report extraction is not a safety authority. Missing API keys, extraction timeouts, provider errors and low-confidence extracted context must remain visible and must not be treated as resolved risk. Extracted context can support review or later enrichment only after deterministic policy and human oversight boundaries are preserved.

## Production Validation Gate

Before production use, NearGuard would require approved operational data and validation:

- reviewed near-miss, incident and safe-operation labels
- matched normal/safe windows sampled from comparable operating conditions
- batch retraining, not immediate online learning from raw incident reports
- documented label definitions and review workflow
- train/test split by time, vehicle and zone where appropriate
- ROC/PR threshold analysis
- recall/sensitivity, precision and false-negative/false-alarm rates
- intervention lead-time evaluation
- subgroup checks across zones, shifts, weather, traffic and vehicle groups
- confidence calibration and drift monitoring
- approved mapping into the organization's safety policy and authorization model

Until that validation exists, NearGuard remains a prototype workflow demonstration.
