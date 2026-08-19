# NearGuard Docs

NearGuard is a hackathon MVP for PSA Code Sprint 2.0: an agentic AI safety system for Prime Mover operations. It observes synthetic telematics events, predicts safety incident risk, coordinates simulated tools, keeps humans in control for disruptive actions and records an auditable execution trace.

## Reading Order

1. `product_context.md` - problem framing, product concept, users, public-context boundaries and non-goals.
2. `implementation_plan.md` - concrete build plan, repo layout, artifact contracts, APIs, tests and build order.
3. `design.md` - system architecture, agentic safety loop, tool design and safety boundaries.
4. `ai_and_data.md` - synthetic data, scenarios, ML model methodology, features, labels, confidence and explanations.
5. `demo_plan.md` - demo flow, required screens, scripted trace and slide outline.

## Hackathon Fit

NearGuard is designed to satisfy the Code Sprint expectation that an agentic AI solution should:

- analyze an input event or state change
- determine an appropriate course of action
- orchestrate tools, systems or workflows
- handle uncertainty, incomplete information and tool failures
- invoke human review, approval or escalation where appropriate
- produce a clear execution trace covering decisions, tool calls, approvals, actions, results and errors

## Source-Of-Truth Boundaries

- Use `implementation_plan.md` for implementation decisions.
- Use `ai_and_data.md` for synthetic scenarios, risk features and AI model methodology.
- Use `design.md` for architecture and safety-policy boundaries.
- Use `demo_plan.md` for presentation and judging flow.

The prototype uses synthetic data and public PSA materials as context only. It does not claim PSA production accuracy, use real PSA incident labels, connect to live PSA systems or implement internal PSA safety processes.
