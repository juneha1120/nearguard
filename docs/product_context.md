# NearGuard Product Context

## Purpose

This document preserves the core product context for NearGuard so future design, implementation and presentation work stays aligned. Use it with `docs/design.md`, `docs/ai_and_data.md`, `docs/implementation_plan.md` and `docs/demo_plan.md`.

## One-Sentence Concept

NearGuard is a human-in-the-loop safety agent for PSA Prime Mover operations that observes rolling telematics patterns, predicts elevated synthetic near-miss risk within a future horizon, chooses the least disruptive effective intervention, coordinates tools and people, handles failures and records an auditable execution trace.

## Problem Context

Prime Movers operate in dense, time-sensitive port environments. Safety incident risk can emerge from combinations of driver behaviour, vehicle state, traffic density, zone risk, weather, shift duration, recent alerts and public safety constraints such as speed limits or wharf movement rules. A simple rule such as "speeding detected" does not capture these interacting risk signals or decide what should happen next.

NearGuard adds a predictive and agentic intervention layer on top of telematics and safety workflows. The prototype demonstrates proactive prevention rather than post-incident reporting. Its MVP model target is a synthetic future near-miss label generated from rolling telemetry and context. Broader safety incident handling remains part of the workflow through deterministic policy, human approval and safety cases.

## Public PSA Context

NearGuard uses public PSA Singapore materials as context and scenario inspiration, not as internal PSA production policy or private operational data. Referenced materials include:

- PSA Singapore Guidelines & Circulars: https://www.singaporepsa.com/resources/port-users/guidelines/
- PSA Singapore Health Safety & Security: https://www.singaporepsa.com/our-commitment/health-safety-security/
- HSS Rules for Port Users.
- Slow Down Zone (25km/h) along Pasir Panjang Terminal Link circular.
- Review of PSA Safety Infringements circular.
- Review of Pedestrian Movement at Wharf circular.

These sources support the design focus on driver safety, speed-limit awareness, pedestrian exposure, safety hazard reporting, responsible driving and auditability. The prototype does not claim access to PSA internal systems, proprietary risk matrices, production enforcement workflows or real incident records.

## Product Principles

- Prevention over reporting: intervene before an accident where possible.
- Telematics first: use synthetic Prime Mover event streams as the MVP live input.
- Advisory first: do not make safety-critical operational actions fully autonomous in the prototype.
- Human approval for disruptive actions: zone advisories, rerouting or operational changes require supervisor involvement.
- Explainability by default: each recommendation should include top risk reasons.
- Trace everything: every decision, tool call, approval, error and result should be inspectable.
- Honest prototype claims: synthetic data demonstrates workflow mechanics, not real PSA production accuracy.

## How NearGuard Uses AI

- A tabular ML model predicts synthetic near-miss risk within the next 15 minutes from Prime Mover telemetry windows and structured context.
- Explainability outputs identify top risk reasons, such as speeding ratio, repeated harsh braking, speed volatility, high traffic, wharf exposure or stale GPS.
- A deterministic safety policy maps risk, confidence, uncertainty and operational impact to allowed actions.
- A large language model is used only for bounded support tasks, such as parsing worker-written risk reports into structured context or summarising safety cases.
- The LLM does not make final safety policy decisions or approve disruptive actions.

## Primary Users

- Safety supervisor: reviews high-risk cases, approves disruptive interventions and follows up on safety cases.
- Operations supervisor: monitors active Prime Mover safety incident risk and responds to alerts that may affect operations.
- Prime Mover driver: receives timely, targeted advisories or warnings.

## Non-Goals For The Prototype

- Do not claim production-grade safety incident prediction accuracy.
- Do not claim the model is trained on real PSA near-miss or incident labels.
- Do not describe the synthetic score as a PSA production accident probability.
- Do not integrate with real PSA operational systems.
- Do not implement or claim PSA's internal RAM, HEMP or ALARP process.
- Do not perform fully autonomous rerouting or shutdown.
- Do not make the LLM responsible for safety policy decisions.
- Do not build a general-purpose fleet management platform.
