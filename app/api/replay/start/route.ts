import { getReplaySessionId } from "@/app/api/replay/session";
import { startReplay } from "@/lib/agent/session-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { scenario_id?: string; session_id?: string };
  return Response.json(startReplay(body.scenario_id, body.session_id ?? getReplaySessionId()));
}
