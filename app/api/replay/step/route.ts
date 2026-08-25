import { getReplaySessionId } from "@/app/api/replay/session";
import { stepReplay } from "@/lib/agent/session-store";

export async function POST() {
  return Response.json(stepReplay(getReplaySessionId()));
}
