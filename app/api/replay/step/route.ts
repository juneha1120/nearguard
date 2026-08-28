import { getReplaySessionId } from "@/app/api/replay/session";
import { stepReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { session_id?: string };
  return Response.json(stepReplay(body.session_id ?? getReplaySessionId()));
}
