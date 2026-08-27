import { describe, expect, it } from "vitest";
import { getReplayState, reviewReplay, startReplay, stepReplay } from "@/lib/agent/session-store";

describe("replay session store", () => {
  it("keeps replay state isolated by session id", () => {
    startReplay("pm27-persistent-high-risk", "session-a");
    startReplay("ppt-link-slow-down-zone", "session-b");

    const steppedA = stepReplay("session-a");
    const untouchedB = getReplayState("session-b");

    expect(steppedA.currentEvent?.event_id).toBe("pm27-002");
    expect(untouchedB.selectedScenario.scenario_id).toBe("ppt-link-slow-down-zone");
    expect(untouchedB.currentEvent).toBeNull();
    expect(untouchedB.traceEvents).toHaveLength(0);
  });

  it("rejects review decisions for unknown or already resolved reviews", () => {
    startReplay("telemetry-uncertainty", "session-review");
    stepReplay("session-review");
    const review = getReplayState("session-review").pendingReviews.find((item) => item.status === "pending");

    expect(reviewReplay("review-does-not-exist", "continue_monitoring", "session-review")).toBeNull();
    expect(reviewReplay(review!.review_id, "insufficient_evidence", "session-review")).not.toBeNull();
    expect(reviewReplay(review!.review_id, "escalate", "session-review")).toBeNull();

    const finalState = getReplayState("session-review");
    expect(finalState.pendingReviews.find((item) => item.review_id === review!.review_id)?.outcome).toBe("insufficient_evidence");
    expect(finalState.traceEvents.filter((trace) => trace.event_type === "review_decision")).toHaveLength(1);
  });
});
