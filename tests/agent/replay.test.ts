import { describe, expect, it } from "vitest";
import { advanceReplay, createInitialReplayState, decideApproval, decideReview, isDecisionPointEvent, rewindReplay, validateEvent } from "@/lib/agent/replay";
import { scenarios } from "@/lib/data/repository";
import type { ReplayState, ReviewRequest, ToolCall } from "@/lib/types/domain";

function resolvedEscalation(caseId: string): ReviewRequest {
  return {
    review_id: `review-${caseId}-prior`,
    case_id: caseId,
    requested_at: "2026-08-19T09:14:50+08:00",
    reason: "Prior evidence review escalated by a supervisor.",
    reason_codes: ["ELEVATED_RISK"],
    evidence: ["Prior review evidence."],
    status: "resolved",
    reviewer: "Safety Supervisor",
    outcome: "escalate",
    decision_time: "2026-08-19T09:14:50+08:00"
  };
}

function runScenario(scenarioId: string): ReplayState {
  let state = createInitialReplayState(scenarioId);
  while (!state.isComplete) {
    state = advanceReplay(state);
  }
  return state;
}

describe("agent replay", () => {
  it("rejects malformed events", () => {
    const errors = validateEvent({
      event_id: "",
      timestamp: "not-a-date",
      vehicle_id: "",
      zone_id: "",
      event_type: "normal_update",
      speed: 99,
      speed_limit: 25,
      gps_freshness: "fresh"
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it("runs PM-27 through timeout, fallback, approval and safety case", () => {
    const scenario = scenarios.find((item) => item.scenario_id === "pm27-persistent-high-risk");
    expect(scenario?.tool_outcomes?.some((outcome) => outcome.event_id === "pm27-003" && outcome.tool_name === "notify_supervisor")).toBe(true);

    const state = runScenario("pm27-persistent-high-risk");
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor" && tool.status === "failed")).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "fallback_notify_supervisor" && tool.status === "delivered")).toBe(true);

    expect(state.pendingApprovals.some((approval) => approval.status === "approved")).toBe(true);
    expect(state.pendingApprovals.find((approval) => approval.status === "approved")?.rationale).toMatch(/Zone operational risk/);
    expect(state.pendingApprovals.find((approval) => approval.status === "approved")?.reason_codes).toContain("ZONE_RISK_CORROBORATED");
    expect(state.toolCalls.some((tool) => tool.tool_name === "recommend_zone_advisory")).toBe(true);
    expect(state.safetyCases).toHaveLength(1);
    expect(state.traceEvents.some((trace) => trace.event_type === "safety_case_created")).toBe(true);
  });

  it("keeps manual PM-27 approval in scenario time and creates the safety case", () => {
    let state = createInitialReplayState("pm27-persistent-high-risk");
    while (!state.pendingApprovals.some((approval) => approval.status === "pending")) {
      state = advanceReplay(state);
    }
    const approval = state.pendingApprovals.find((item) => item.status === "pending");
    expect(approval).toBeDefined();

    const approved = decideApproval(state, approval!.approval_id, true);
    const safetyCaseTrace = approved.traceEvents.find((trace) => trace.event_type === "safety_case_created");

    expect(approved.selectedScenario.scenario_id).toBe("pm27-persistent-high-risk");
    expect(approved.currentEvent?.event_id).toBe("pm27-004");
    expect(approved.pendingApprovals.find((item) => item.approval_id === approval!.approval_id)?.status).toBe("approved");
    expect(approved.selectedCase?.authority_class).toBe("Zone action approved");
    expect(approved.selectedCase?.recommended_action).toBe("Zone advisory approved and recorded.");
    expect(approved.safetyCases).toHaveLength(1);
    expect(safetyCaseTrace?.timestamp).toBe(new Date(new Date(approved.currentEvent!.timestamp).getTime() + 16_000).toISOString());
  });

  it("steps to the next decision point instead of tracing every normal telemetry sample", () => {
    const initial = createInitialReplayState("ppt-link-slow-down-zone");
    const state = advanceReplay(initial);

    expect(state.currentEvent?.event_id).toBe("ppt-002");
    expect(state.currentEvent?.event_type).toBe("speeding");
    expect(state.traceEvents.some((trace) => trace.message.includes("normal_update"))).toBe(false);
    expect(initial.selectedScenario.events.filter(isDecisionPointEvent).map((event) => event.event_id)).toEqual(["ppt-002", "ppt-003"]);
  });

  it("rewinds to the previous decision point", () => {
    let state = createInitialReplayState("ppt-link-slow-down-zone");
    state = advanceReplay(state);
    state = advanceReplay(state);

    expect(state.currentEvent?.event_id).toBe("ppt-003");

    const rewinded = rewindReplay(state);

    expect(rewinded.currentEvent?.event_id).toBe("ppt-002");
    expect(rewinded.currentEvent?.event_type).toBe("speeding");
  });

  it("preserves completed approvals and safety cases when rewinding", () => {
    let state = runScenario("pm27-persistent-high-risk");
    const approval = state.pendingApprovals.find((item) => item.status === "approved");
    expect(approval).toBeDefined();

    const rewinded = rewindReplay(state);

    expect(rewinded.pendingApprovals.find((item) => item.approval_id === approval!.approval_id)?.status).toBe("approved");
    expect(rewinded.selectedCase?.status).toBe("escalated");
    expect(rewinded.selectedCase?.pending_approval).toBe(false);
    expect(rewinded.safetyCases).toHaveLength(1);
    expect(rewinded.toolCalls.some((tool) => tool.tool_name === "recommend_zone_advisory")).toBe(true);
    expect(rewinded.traceEvents.some((trace) => trace.event_type === "safety_case_created")).toBe(true);
  });

  it("stabilizes the slow-down-zone scenario after speed normalizes", () => {
    const state = runScenario("ppt-link-slow-down-zone");
    expect(state.selectedCase?.status).toBe("stabilized");
    expect(state.latestRiskAssessment?.risk_band).toBe("Low");
    expect(state.latestRiskAssessment?.top_risk_reasons.join(" ")).toMatch(/Speed normalized/);
  });

  it("triggers the PPT slow-down-zone advisory only on the elevated-risk speeding decision", () => {
    let state = createInitialReplayState("ppt-link-slow-down-zone");
    state = advanceReplay(state);

    expect(state.currentEvent?.event_id).toBe("ppt-002");
    expect(state.latestRiskAssessment?.risk_band).toBe("Medium");
    expect(state.latestRiskAssessment?.safety_incident_risk_score).toBeGreaterThanOrEqual(0.4);
    expect(state.latestRiskAssessment?.safety_incident_risk_score).toBeLessThan(0.65);
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_driver")).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor")).toBe(false);

    state = advanceReplay(state);
    expect(state.currentEvent?.event_id).toBe("ppt-003");
    expect(state.latestRiskAssessment?.risk_band).toBe("Low");
  });

  it("includes pedestrian exposure as a wharf risk reason", () => {
    const state = runScenario("wharf-pedestrian-exposure");
    const traceReasons = state.traceEvents
      .filter((trace) => trace.event_type === "risk_assessed")
      .map((trace) => JSON.stringify(trace.metadata));
    expect(traceReasons.join(" ")).toMatch(/Pedestrian-exposure feature is high/);
    expect(state.latestRiskAssessment?.confidence).toBe("high");
    expect(state.latestRiskAssessment?.risk_band).toBe("Low");
    expect(state.latestRiskAssessment?.top_risk_reasons.join(" ")).toMatch(/Speed normalized/);
  });

  it("handles telemetry uncertainty with signal review separate from zone approval", () => {
    let state = runScenario("telemetry-uncertainty");
    expect(state.traceEvents.some((trace) => trace.event_type === "context_missing")).toBe(true);
    expect(state.traceEvents.some((trace) => trace.event_type === "review_requested")).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor")).toBe(true);
    expect(state.pendingApprovals).toHaveLength(0);

    const review = state.pendingReviews.find((item) => item.status === "pending");
    expect(review).toBeDefined();
    expect(review?.reason_codes).toEqual(expect.arrayContaining(["LOW_MODEL_CONFIDENCE", "STALE_GPS", "MISSING_ZONE_CONTEXT"]));
    expect(state.selectedCase?.status).toBe("pending_review");

    state = decideReview(state, review!.review_id, "insufficient_evidence", "Safety Supervisor");

    expect(state.pendingReviews.find((item) => item.review_id === review!.review_id)?.outcome).toBe("insufficient_evidence");
    expect(state.selectedCase?.status).toBe("monitoring");
    expect(state.toolCalls.some((tool) => tool.tool_name === "recommend_zone_advisory")).toBe(false);
    expect(state.safetyCases).toHaveLength(0);
    expect(state.traceEvents.some((trace) => trace.event_type === "review_decision")).toBe(true);
  });

  it("does not stabilize a case that human review left unresolved", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const review = state.pendingReviews.find((item) => item.status === "pending");
    state = decideReview(state, review!.review_id, "insufficient_evidence");

    state = advanceReplay(state);

    expect(state.selectedCase?.status).toBe("monitoring");
    expect(state.selectedCase?.authority_class).toBe("Signal weak");
    expect(state.selectedCase?.recommended_action).toBe("Signal marked weak; keep the case open for better telemetry.");
    expect(state.traceEvents.some((trace) => trace.event_type === "case_stabilized")).toBe(false);
  });

  it("sends one supervisor signal when human review escalates, without authorizing any action", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const supervisorCallsBefore = state.toolCalls.filter((tool) => tool.tool_name === "notify_supervisor").length;
    const review = state.pendingReviews.find((item) => item.status === "pending");

    state = decideReview(state, review!.review_id, "escalate");

    expect(state.selectedCase?.status).toBe("escalated");
    expect(state.toolCalls.filter((tool) => tool.tool_name === "notify_supervisor")).toHaveLength(supervisorCallsBefore + 1);
    expect(
      state.traceEvents.some(
        (trace) => trace.event_type === "tool_call" && (trace.metadata as { toolCall?: ToolCall }).toolCall?.tool_name === "notify_supervisor"
      )
    ).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "recommend_zone_advisory")).toBe(false);
    expect(state.pendingApprovals).toHaveLength(0);
    expect(state.safetyCases).toHaveLength(0);
  });

  it("keeps an escalated case escalated and does not repeat the supervisor signal", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const review = state.pendingReviews.find((item) => item.status === "pending");
    state = decideReview(state, review!.review_id, "escalate");
    const supervisorCalls = state.toolCalls.filter((tool) => tool.tool_name === "notify_supervisor").length;

    state = advanceReplay(state);
    expect(state.selectedCase?.status).toBe("escalated");
    expect(state.traceEvents.some((trace) => trace.event_type === "case_stabilized")).toBe(false);

    state = decideReview(state, review!.review_id, "escalate");
    expect(state.toolCalls.filter((tool) => tool.tool_name === "notify_supervisor")).toHaveLength(supervisorCalls);
    expect(state.selectedCase?.status).toBe("escalated");
  });

  it("keeps the escalation supervisor tool call after rewinding", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const review = state.pendingReviews.find((item) => item.status === "pending");
    state = decideReview(state, review!.review_id, "escalate");
    const escalationCall = state.toolCalls.find((tool) => tool.tool_call_id.startsWith("tool-review-escalation-"));
    expect(escalationCall).toBeDefined();
    state = advanceReplay(state);

    const rewinded = rewindReplay(state);

    expect(rewinded.toolCalls.filter((tool) => tool.tool_call_id === escalationCall!.tool_call_id)).toHaveLength(1);
    const toolCallIds = rewinded.toolCalls.map((tool) => tool.tool_call_id);
    expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
    expect(rewinded.traceEvents.some((trace) => trace.event_type === "review_decision")).toBe(true);
    expect(
      rewinded.traceEvents.filter(
        (trace) => (trace.metadata as { toolCall?: ToolCall }).toolCall?.tool_call_id === escalationCall!.tool_call_id
      )
    ).toHaveLength(1);
  });

  it("lets a pending_approval policy transition win over a sticky human review escalation", () => {
    let state = createInitialReplayState("pm27-persistent-high-risk");
    state = advanceReplay(state);
    state = advanceReplay(state);
    const caseId = state.selectedCase!.case_id;
    state = {
      ...state,
      pendingReviews: [resolvedEscalation(caseId)],
      activeCases: state.activeCases.map((item) => (item.case_id === caseId ? { ...item, status: "escalated" } : item))
    };

    state = advanceReplay(state);

    expect(state.currentEvent?.event_id).toBe("pm27-004");
    expect(state.selectedCase?.status).toBe("pending_approval");
    expect(state.pendingApprovals.some((approval) => approval.status === "pending")).toBe(true);
  });

  it("lets a pending_review policy transition win over a sticky human review escalation", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = { ...state, pendingReviews: [resolvedEscalation("case-PM-09")] };

    state = advanceReplay(state);

    expect(state.latestRiskAssessment?.risk_band).toBe("High");
    expect(state.selectedCase?.case_id).toBe("case-PM-09");
    expect(state.selectedCase?.status).toBe("pending_review");
  });

  it("still stabilizes once human review returns the case to monitoring", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const review = state.pendingReviews.find((item) => item.status === "pending");
    state = decideReview(state, review!.review_id, "continue_monitoring");

    state = advanceReplay(state);

    expect(state.selectedCase?.status).toBe("stabilized");
    expect(state.traceEvents.some((trace) => trace.event_type === "case_stabilized")).toBe(true);
  });

  it("preserves review traces once when rewinding past a resolved review", () => {
    let state = createInitialReplayState("telemetry-uncertainty");
    state = advanceReplay(state);
    const review = state.pendingReviews.find((item) => item.status === "pending");
    state = decideReview(state, review!.review_id, "continue_monitoring");
    state = advanceReplay(state);

    const rewinded = rewindReplay(state);

    expect(rewinded.traceEvents.filter((trace) => trace.event_type === "review_requested")).toHaveLength(1);
    expect(rewinded.traceEvents.filter((trace) => trace.event_type === "review_decision")).toHaveLength(1);
    const traceIds = rewinded.traceEvents.map((trace) => trace.trace_id);
    expect(new Set(traceIds).size).toBe(traceIds.length);
    expect(rewinded.pendingReviews.find((item) => item.review_id === review!.review_id)?.status).toBe("resolved");
  });

  it("keeps trace events chronological", () => {
    const state = runScenario("pm27-persistent-high-risk");
    const timestamps = state.traceEvents.map((trace) => new Date(trace.timestamp).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("spaces generated timeline rows realistically across every scenario", () => {
    for (const scenario of scenarios) {
      const state = runScenario(scenario.scenario_id);
      const visibleSeconds = state.traceEvents.map((trace) => Math.floor(new Date(trace.timestamp).getTime() / 1000));

      for (let index = 1; index < visibleSeconds.length; index += 1) {
        expect(visibleSeconds[index], `${scenario.scenario_id} trace ${index}`).toBeGreaterThan(visibleSeconds[index - 1]);
      }
    }
  });
});
