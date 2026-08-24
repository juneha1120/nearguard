import { describe, expect, it } from "vitest";
import { advanceReplay, createInitialReplayState, decideApproval, isEvidenceEvent, validateEvent } from "@/lib/agent/replay";
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
    let state = runScenario("pm27-persistent-high-risk");
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor" && tool.status === "failed")).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "fallback_notify_supervisor" && tool.status === "delivered")).toBe(true);
    expect(state.pendingApprovals.some((approval) => approval.status === "pending")).toBe(true);

    const approval = state.pendingApprovals.find((item) => item.status === "pending");
    expect(approval).toBeDefined();
    state = decideApproval(state, approval!.approval_id, true);

    expect(state.safetyCases).toHaveLength(1);
    expect(state.traceEvents.some((trace) => trace.event_type === "safety_case_created")).toBe(true);
  });

  it("steps to the next evidence event instead of tracing normal telemetry", () => {
    const initial = createInitialReplayState("ppt-link-slow-down-zone");
    const state = advanceReplay(initial);

    expect(state.currentEvent?.event_id).toBe("ppt-002");
    expect(state.currentEvent?.event_type).toBe("speeding");
    expect(state.traceEvents.some((trace) => trace.message.includes("normal_update"))).toBe(false);
    expect(initial.selectedScenario.events.filter(isEvidenceEvent).map((event) => event.event_id)).toEqual(["ppt-002", "ppt-003"]);
  });

  it("stabilizes the slow-down-zone scenario after speed normalizes", () => {
    const state = runScenario("ppt-link-slow-down-zone");
    expect(state.selectedCase?.status).toBe("stabilized");
    expect(state.latestRiskAssessment?.risk_band).toBe("Low");
    expect(state.latestRiskAssessment?.top_risk_reasons.join(" ")).toMatch(/Speed normalized/);
  });

  it("includes pedestrian exposure as a wharf risk reason", () => {
    const state = runScenario("wharf-pedestrian-exposure");
    const traceReasons = state.traceEvents
      .filter((trace) => trace.event_type === "risk_assessed")
      .map((trace) => JSON.stringify(trace.metadata));
    expect(traceReasons.join(" ")).toMatch(/Pedestrian exposure is high/);
    expect(state.latestRiskAssessment?.confidence).toBe("high");
    expect(state.latestRiskAssessment?.risk_band).toBe("Low");
    expect(state.latestRiskAssessment?.top_risk_reasons.join(" ")).toMatch(/Speed normalized/);
  });

  it("handles telemetry uncertainty with low confidence and human review", () => {
    const state = runScenario("telemetry-uncertainty");
    expect(state.traceEvents.some((trace) => trace.event_type === "context_missing")).toBe(true);
    expect(state.traceEvents.some((trace) => trace.message.includes("human review"))).toBe(true);
    expect(state.toolCalls.some((tool) => tool.tool_name === "notify_supervisor")).toBe(true);
  });

  it("keeps trace events chronological", () => {
    const state = runScenario("pm27-persistent-high-risk");
    const timestamps = state.traceEvents.map((trace) => new Date(trace.timestamp).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});
