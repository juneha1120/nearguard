import { getReplaySessionId } from "@/app/api/replay/session";
import { previousReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { session_id?: string };
  return Response.json(previousReplay(body.session_id ?? getReplaySessionId()));
}
