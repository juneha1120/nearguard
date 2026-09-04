# NearGuard Docs

NearGuard is a human-in-the-loop safety agent prototype for Prime Mover operations in port and logistics environments. It observes synthetic telematics history, predicts synthetic near-miss risk within a future horizon, coordinates simulated tools, keeps humans in control for disruptive actions and records an auditable execution trace.

The project originated from the PSA Code Sprint 2.0 "Agentic AI in Action" challenge. It remains grounded in public PSA port-safety context, but it was not shortlisted and is not affiliated with, endorsed by, or connected to PSA operational systems.

## Reading Order

1. `product_context.md` - problem framing, product concept, users, public-context boundaries and non-goals.
2. `implementation_plan.md` - concrete build plan, repo layout, artifact contracts, APIs, tests and build order.
3. `design.md` - system architecture, agentic safety loop, tool design and safety boundaries.
4. `ai_and_data.md` - synthetic data, field provenance, scenarios, ML model methodology, features, labels, confidence and explanations.
5. `SAFETY.md` - hard safety boundaries, evidence authority, prototype assumptions and production validation gate.
6. `demo_plan.md` - demo flow, required screens, scripted trace and slide outline.

## Agentic AI Fit

NearGuard demonstrates an agentic safety workflow that can:

- analyze an input event or state change
- determine an appropriate course of action
- orchestrate tools, systems or workflows
- handle uncertainty, incomplete information and tool failures
- invoke human review, approval or escalation where appropriate
- produce a clear execution trace covering decisions, tool calls, approvals, actions, results and errors

## Docs Map

- `product_context.md` is the stable product framing: problem, users, non-goals and public-context boundaries.
- Use `implementation_plan.md` for implementation contracts and repo workflow.
- Use `ai_and_data.md` for synthetic scenarios, data provenance, risk features and model methodology.
- Use `design.md` for architecture and safety-policy boundaries.
- Use `SAFETY.md` for prototype safety boundaries and production validation requirements.
- Use `demo_plan.md` for presentation and judging flow.

Current-state handoff details live primarily in `implementation_plan.md` and `ai_and_data.md`. Presentation language lives in `demo_plan.md`; it should stay consistent with the safety boundaries rather than introduce new production claims.

The prototype uses synthetic data and public PSA materials as context only. It does not claim PSA production accuracy, use real PSA incident labels, connect to live PSA systems or implement internal PSA safety processes.
