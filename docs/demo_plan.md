# NearGuard Demo Plan

## Demo Goal

Show a complete agentic safety loop in under 10 minutes:

```text
observe -> normalize -> enrich -> validate -> predict -> decide -> act -> monitor -> reassess -> escalate or close -> show trace
```

The demo should make NearGuard feel like an intervention agent, not just a prediction dashboard.

## Target Audience Takeaway

NearGuard uses rolling Prime Mover telematics and operational context to detect elevated synthetic near-miss risk within a future horizon, coordinate the right safety interventions, keep humans in control for disruptive actions and produce an auditable trace.

Near-miss prevention is the headline use case. In the MVP, the model target is `near_miss_within_next_15m`, a synthetic future outcome used to demonstrate the supervised learning pipeline.

The demo is designed for PSA Code Sprint 2.0: Agentic AI in Action. It should make the evaluation criteria visible: agentic reasoning, decision-making, tool orchestration, uncertainty handling, human oversight, auditability, responsible AI and clear presentation.

NearGuard should be narrated as a continuous rolling-window risk predictor, not a single-event alert. The model keeps scoring vehicle risk from recent telemetry and context; deterministic policy opens interventions only when risk crosses configured thresholds, with human approval for disruptive actions.

## Demo Story

Vehicle `PM-27` enters a rainy high-risk zone during heavy traffic. Continuous scoring rises as near-limit speed, a sharp turn, repeated harsh braking and post-advisory persistence accumulate. NearGuard explains why the vehicle crossed intervention thresholds, warns the driver, notifies the supervisor, handles a supervisor notification timeout, reassesses risk, asks for approval for a zone advisory and creates a safety case.

The scenario is inspired by public PSA safety themes such as responsible driving, speed-limit compliance, pedestrian exposure, wharf movement caution and reporting of safety hazards. It does not use real PSA incident data or internal PSA policy.

## 10-Minute Run Of Show

| Time | Segment | What To Show |
| --- | --- | --- |
| 0:00-1:00 | Problem fit | Prime Mover safety incident risk, near-miss prevention and why threshold alerts are limited. |
| 1:00-2:00 | NearGuard concept | Agent loop, telematics-first input and human-in-the-loop positioning. |
| 2:00-3:00 | Event arrives | Dashboard receives `PM-27` sharp-turn and harsh-braking events in rainy high-traffic context. |
| 3:00-4:00 | Context and risk analysis | Zone context, freshness check, risk score, confidence and top reasons appear. |
| 4:00-5:00 | Agent decision | Agent compares response options and chooses driver warning plus supervisor notification. |
| 5:00-6:00 | Tool failure | Supervisor notification times out and fallback is triggered. |
| 6:00-7:00 | Monitoring and reassessment | New telemetry arrives and risk remains high after intervention. |
| 7:00-8:00 | Human approval | Agent requests approval for zone advisory because stronger action is disruptive. |
| 8:00-9:00 | Safety case | Approval is granted and safety case is created. |
| 9:00-10:00 | Trace and evaluation fit | Show complete trace, responsible AI boundaries, public-reference limits and how the demo meets Code Sprint criteria. |

Use 30-60 seconds in the Responsible AI or Human Oversight segment to say: `LLM is not the Safety Authority`. NearGuard can summarize context and orchestrate simulated tools, but deterministic policy and human approval decide whether disruptive safety actions are allowed.

## Required Demo Screens

- Active Prime Movers list with safety incident risk level.
- Selected case detail for `PM-27`.
- Raw event, zone context and derived risk features.
- Synthetic near-miss risk score, prediction horizon, confidence, uncertainty and explanation.
- Recommended action and authority class.
- Tool call status list.
- Approval request panel.
- Execution trace timeline.
- Created safety case summary.

## Scripted Trace Narration

```text
09:14:42  event_received: PM-27 sharp_turn event received
09:14:43  context_enriched: Zone context loaded with latest dynamic telemetry
09:14:44  features_derived: rolling telemetry and context features updated
09:14:45  risk_assessed: synthetic near-miss risk within next 15m remains below intervention threshold
09:15:26  event_received: PM-27 harsh_brake event received
09:15:29  risk_assessed: synthetic near-miss risk within next 15m = 0.65, High, high confidence
09:15:30  policy_decision: driver advisory and supervisor notification
09:15:31  tool_call: notify_driver delivered
09:15:34  tool_failure: notify_supervisor failed with timeout
09:15:35  tool_call: fallback_notify_supervisor delivered
09:16:05  risk_assessed: risk remains High at 0.82 after the earlier response
09:16:11  approval_requested: approval requested for zone advisory
09:18:30  risk_assessed: persistent risk remains High at 0.82
09:18:42  approval_decision: supervisor approved zone advisory
09:18:44  tool_call: recommend_zone_advisory recommended
09:18:46  safety_case_created: safety case SC-1007 created
```

## Scripted Scenarios

| Scenario | Purpose | Public Context Link |
| --- | --- | --- |
| `PM-27 Persistent High Risk` | Main end-to-end demo: rolling telemetry risk rises, supervisor notification intentionally times out, fallback succeeds, human approval is requested and a safety case is created. | Public PSA driver safety and safety infringement themes. |
| `PPT Link Slow Down Zone` | Successful intervention case: vehicle risk crosses the advisory threshold in a slow-down zone, speed normalizes and the case stabilizes. | PSA Slow Down Zone (25km/h) along Pasir Panjang Terminal Link circular. |
| `Wharf Pedestrian Exposure` | Context case: wharf and pedestrian-exposure context raise risk without claiming real-time person tracking. | PSA Review of Pedestrian Movement at Wharf circular and HSS Rules. |
| `Telemetry Uncertainty` | Responsible-AI case: stale GPS and missing context reduce confidence, avoid hallucinated certainty and trigger human review. | Responsible AI and safety-boundary requirement. |

## Failure Case To Include

Use a supervisor notification timeout in `PM-27 Persistent High Risk`. This is an intentional scripted failure, not a bug. It directly proves that NearGuard handles tool failure instead of stopping or marking the case successful.

Expected behaviour:

- record timeout in trace
- retry or use fallback channel
- keep case active
- continue monitoring

## Human Approval Case To Include

Use zone advisory approval.

Expected behaviour:

- agent recommends the action
- dashboard shows rationale
- supervisor approves
- trace records approver and decision
- safety case includes approval evidence

## Worker Report Mention

Worker daily potential-risk reports are implemented as a Gemini-backed extraction endpoint for ease of setup, not as the risk-scoring authority. In the pitch, present this as a context-enrichment workflow: worker-written safety observations can be parsed into structured zone or vehicle context, but the MVP remains telematics-first and no report directly triggers disruptive action without policy checks and human approval.

## Judge Question Defenses

If asked why the MVP uses tabular `HistGradientBoosting` instead of an LLM, foundation model or temporal transformer, answer:

> The safety signal is structured telemetry, not language. For this MVP we chose tabular gradient boosting because it is lightweight, fast, deterministic to serve locally and easier to explain with feature reasons. No LLM is called per telemetry tick, which keeps runtime cost and token usage bounded. The model is decision support; deterministic policy and human approval remain the safety authority.

If asked whether NearGuard is really agentic when the policy is deterministic, answer:

> We intentionally constrain the safety authority. The agentic value is the closed loop: observe telemetry, enrich context, assess risk, choose permitted tools, handle timeout failure with fallback, monitor new telemetry, reassess and escalate or close with a trace. It is agentic orchestration inside a deterministic safety envelope.

If asked how this compares with production fleet-safety systems, answer:

> The MVP+ is telematics-first and privacy-preserving, with a narrow V2V layer for nearby Prime Mover proximity and closing motion. Production extensions would add calibrated uncertainty, multi-horizon targets, richer topology-aware interaction features, reaction-window handling after warnings, chassis/laden-state physics proxies and edge alerts for immediate in-cab response. Those are roadmap items, not claims made by this prototype.

## Demo Success Checklist

- The audience sees a live or replayed synthetic event stream.
- Safety incident risk changes from medium to high.
- Near-miss is explained as a synthetic future label, not a production accident probability.
- At least three risk reasons are shown.
- At least two tools are called.
- One tool failure is visible and handled.
- One human approval is required.
- A safety case is created.
- The final trace clearly covers decisions, tools, approvals, results and errors.
- PSA public references and synthetic-data limitations are explicitly stated.
- Security, safety and scalability considerations are covered before the final slide ends.

## Slide Outline

| Slide | Title | Content |
| --- | --- | --- |
| 1 | NearGuard | One-line concept and safety incident risk problem. |
| 2 | Challenge Fit | How the solution addresses event logs, state changes, action selection, tool orchestration and human oversight. |
| 3 | Agentic Workflow | Observe, normalize, enrich, predict, decide, act, monitor, reassess, escalate. |
| 4 | Architecture | Components, state management and simulated tool orchestration. |
| 5 | Data And Features | Vehicle events, rolling windows, future synthetic labels and model outputs. |
| 6 | Risk Model | Tabular ML as decision-support tool for synthetic next-15m near-miss risk, with confidence and uncertainty. |
| 7 | Human Oversight | `LLM is not the Safety Authority`, approval boundaries and deterministic safety policy. |
| 8 | Demo Scenario | PM-27 story, failure handling and expected trace. |
| 9 | Responsible AI | Synthetic data limits, explainability, auditability and public-reference boundaries. |
| 10 | Impact And Next Steps | Potential safety value, scalability path, worker-report enrichment and approved pilot requirements. |
