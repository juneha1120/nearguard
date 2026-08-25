import { describe, expect, it } from "vitest";
import { getReplayState, startReplay, stepReplay } from "@/lib/agent/session-store";

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
});
