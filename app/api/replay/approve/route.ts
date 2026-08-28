import { getReplaySessionId } from "@/app/api/replay/session";
import { approveReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { approval_id: string; approved: boolean; session_id?: string };
  return Response.json(approveReplay(body.approval_id, body.approved, body.session_id ?? getReplaySessionId()));
}
