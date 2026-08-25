import { getReplaySessionId } from "@/app/api/replay/session";
import { previousReplay } from "@/lib/agent/session-store";

export async function POST() {
  return Response.json(previousReplay(getReplaySessionId()));
}
