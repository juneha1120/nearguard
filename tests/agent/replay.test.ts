import { describe, expect, it } from "vitest";
import { advanceReplay, createInitialReplayState, decideApproval, isDecisionPointEvent, rewindReplay, validateEvent } from "@/lib/agent/replay";
import { scenarios } from "@/lib/data/repository";
import type { ReplayState } from "@/lib/types/domain";

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

  it("handles telemetry uncertainty with low confidence and human review", () => {
    const state = runScenario("telemetry-uncertainty");
    expect(state.traceEvents.some((trace) => trace.event_type === "context_missing")).toBe(true);
    expect(state.traceEvents.some((trace) => trace.message.includes("Supervisor review request sent"))).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor")).toBe(true);
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
