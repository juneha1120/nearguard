import { getReplaySessionId } from "@/app/api/replay/session";
import { approveReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json()) as { approval_id: string; approved: boolean };
  return Response.json(approveReplay(body.approval_id, body.approved, getReplaySessionId()));
}
