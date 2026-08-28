import { getReplaySessionId } from "@/app/api/replay/session";
import { approveReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { approval_id?: unknown; approved?: unknown; session_id?: string };
  const approvalId = typeof body.approval_id === "string" ? body.approval_id.trim() : "";
  if (!approvalId || typeof body.approved !== "boolean") {
    return Response.json({ error: "approval_id and approved boolean are required" }, { status: 400 });
  }

  const replayState = approveReplay(approvalId, body.approved, body.session_id ?? getReplaySessionId());
  if (!replayState) {
    return Response.json({ error: "approval_id does not match a pending approval" }, { status: 400 });
  }

  return Response.json(replayState);
}
