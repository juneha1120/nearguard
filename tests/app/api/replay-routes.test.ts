import { describe, expect, it, vi } from "vitest";
import { POST as approvePost } from "@/app/api/replay/approve/route";
import { POST as previousPost } from "@/app/api/replay/previous/route";
import { POST as startPost } from "@/app/api/replay/start/route";
import { POST as stepPost } from "@/app/api/replay/step/route";
import { approveReplay, previousReplay, startReplay, stepReplay } from "@/lib/agent/session-store";

vi.mock("@/app/api/replay/session", () => ({
  getReplaySessionId: vi.fn(() => "cookie-session")
}));

vi.mock("@/lib/agent/session-store", () => ({
  approveReplay: vi.fn(() => ({ ok: true, route: "approve" })),
  previousReplay: vi.fn(() => ({ ok: true, route: "previous" })),
  startReplay: vi.fn(() => ({ ok: true, route: "start" })),
  stepReplay: vi.fn(() => ({ ok: true, route: "step" }))
}));

describe("replay API routes", () => {
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

    expect(startReplay).toHaveBeenCalledWith("pm27-persistent-high-risk", "dashboard-session");
    expect(stepReplay).toHaveBeenCalledWith("dashboard-session");
    expect(previousReplay).toHaveBeenCalledWith("dashboard-session");
    expect(approveReplay).toHaveBeenCalledWith("approval-case-PM-27", true, "dashboard-session");
  });
});
