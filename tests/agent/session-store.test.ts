import { describe, expect, it } from "vitest";
import { approveReplay, getReplayState, reviewReplay, startReplay, stepReplay } from "@/lib/agent/session-store";

describe("replay session store", () => {
  it("approves against the session that owns the approval id", () => {
    const ownerSession = `owner-${Date.now()}`;
    const staleSession = `stale-${Date.now()}`;
    startReplay("pm27-persistent-high-risk", ownerSession);
    startReplay("ppt-link-slow-down-zone", staleSession);

    let state = stepReplay(ownerSession);
    while (!state.pendingApprovals.some((approval) => approval.status === "pending")) {
      state = stepReplay(ownerSession);
    }

    const approval = state.pendingApprovals.find((item) => item.status === "pending");
    expect(approval).toBeDefined();

    const approved = approveReplay(approval!.approval_id, true, staleSession);

    expect(approved.selectedScenario.scenario_id).toBe("pm27-persistent-high-risk");
    expect(approved.currentEvent?.event_id).toBe("pm27-004");
    expect(approved.safetyCases).toHaveLength(1);
    expect(approved.traceEvents.some((trace) => trace.event_type === "safety_case_created")).toBe(true);
  });

  it("rejects review decisions for unknown or already resolved reviews", () => {
    startReplay("telemetry-uncertainty", "session-review");
    stepReplay("session-review");
    const review = getReplayState("session-review").pendingReviews.find((item) => item.status === "pending");

    expect(review).toBeDefined();
    expect(reviewReplay("review-does-not-exist", "continue_monitoring", "session-review")).toBeNull();
    expect(reviewReplay(review!.review_id, "insufficient_evidence", "session-review")).not.toBeNull();
    expect(reviewReplay(review!.review_id, "escalate", "session-review")).toBeNull();

    const finalState = getReplayState("session-review");
    expect(finalState.pendingReviews.find((item) => item.review_id === review!.review_id)?.outcome).toBe("insufficient_evidence");
    expect(finalState.traceEvents.filter((trace) => trace.event_type === "review_decision")).toHaveLength(1);
  });
});
