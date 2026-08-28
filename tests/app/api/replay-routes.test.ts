import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approvePost } from "@/app/api/replay/approve/route";
import { POST as previousPost } from "@/app/api/replay/previous/route";
import { POST as reviewPost } from "@/app/api/replay/review/route";
import { POST as startPost } from "@/app/api/replay/start/route";
import { POST as stepPost } from "@/app/api/replay/step/route";
import { approveReplay, previousReplay, reviewReplay, startReplay, stepReplay } from "@/lib/agent/session-store";
import type { ReplayState } from "@/lib/types/domain";

function mockReplayState(route: string): ReplayState {
  return {
    selectedScenario: {
      scenario_id: route,
      name: route,
      description: route,
      primary_vehicle_id: "PM-TEST",
      highlights: [],
      events: []
    },
    currentEventIndex: 0,
    activeCases: [],
    selectedCase: null,
    currentEvent: null,
    currentZone: null,
    latestFeatures: null,
    latestRiskAssessment: null,
    toolCalls: [],
    pendingReviews: [],
    pendingApprovals: [],
    safetyCases: [],
    traceEvents: [],
    isComplete: true
  };
}

const mockApproveState = mockReplayState("approve");
const mockReviewState = mockReplayState("review");

vi.mock("@/app/api/replay/session", () => ({
  getReplaySessionId: vi.fn(() => "cookie-session")
}));

vi.mock("@/lib/agent/session-store", () => ({
  approveReplay: vi.fn(() => ({ ok: true, route: "approve" })),
  previousReplay: vi.fn(() => ({ ok: true, route: "previous" })),
  reviewReplay: vi.fn(() => ({ ok: true, route: "review" })),
  startReplay: vi.fn(() => ({ ok: true, route: "start" })),
  stepReplay: vi.fn(() => ({ ok: true, route: "step" }))
}));

describe("replay API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(approveReplay).mockReturnValue(mockApproveState);
    vi.mocked(reviewReplay).mockReturnValue(mockReviewState);
  });

  it("uses the explicit replay session id across replay actions", async () => {
    await startPost(
      new Request("http://localhost/api/replay/start", {
        method: "POST",
        body: JSON.stringify({ scenario_id: "pm27-persistent-high-risk", session_id: "dashboard-session" })
      })
    );
    await stepPost(
      new Request("http://localhost/api/replay/step", {
        method: "POST",
        body: JSON.stringify({ session_id: "dashboard-session" })
      })
    );
    await previousPost(
      new Request("http://localhost/api/replay/previous", {
        method: "POST",
        body: JSON.stringify({ session_id: "dashboard-session" })
      })
    );
    await approvePost(
      new Request("http://localhost/api/replay/approve", {
        method: "POST",
        body: JSON.stringify({ approval_id: "approval-case-PM-27", approved: true, session_id: "dashboard-session" })
      })
    );
    await reviewPost(
      new Request("http://localhost/api/replay/review", {
        method: "POST",
        body: JSON.stringify({ review_id: "review-risk-1", outcome: "continue_monitoring", session_id: "dashboard-session" })
      })
    );

    expect(startReplay).toHaveBeenCalledWith("pm27-persistent-high-risk", "dashboard-session");
    expect(stepReplay).toHaveBeenCalledWith("dashboard-session");
    expect(previousReplay).toHaveBeenCalledWith("dashboard-session");
    expect(approveReplay).toHaveBeenCalledWith("approval-case-PM-27", true, "dashboard-session");
    expect(reviewReplay).toHaveBeenCalledWith("review-risk-1", "continue_monitoring", "dashboard-session");
  });

  it("rejects malformed approval requests", async () => {
    const response = await approvePost(
      new Request("http://localhost/api/replay/approve", {
        method: "POST",
        body: JSON.stringify({ approval_id: "", approved: "yes", session_id: "dashboard-session" })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "approval_id and approved boolean are required" });
    expect(approveReplay).not.toHaveBeenCalled();
  });

  it("rejects approval ids that do not match a pending approval", async () => {
    vi.mocked(approveReplay).mockReturnValueOnce(null);

    const response = await approvePost(
      new Request("http://localhost/api/replay/approve", {
        method: "POST",
        body: JSON.stringify({ approval_id: "approval-missing", approved: true, session_id: "dashboard-session" })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "approval_id does not match a pending approval" });
    expect(approveReplay).toHaveBeenCalledWith("approval-missing", true, "dashboard-session");
  });
});
