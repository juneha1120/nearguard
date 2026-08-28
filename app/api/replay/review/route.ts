import { getReplaySessionId } from "@/app/api/replay/session";
import { reviewReplay } from "@/lib/agent/session-store";
import type { ReviewOutcome } from "@/lib/types/domain";

const allowedOutcomes = new Set<ReviewOutcome>(["continue_monitoring", "escalate", "insufficient_evidence"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { review_id?: unknown; outcome?: unknown; session_id?: string };
  if (typeof body.review_id !== "string" || typeof body.outcome !== "string" || !allowedOutcomes.has(body.outcome as ReviewOutcome)) {
    return Response.json({ error: "review_id and a valid review outcome are required" }, { status: 400 });
  }

  const replayState = reviewReplay(body.review_id, body.outcome as ReviewOutcome, body.session_id ?? getReplaySessionId());
  if (!replayState) {
    return Response.json({ error: "review_id does not match a pending review" }, { status: 400 });
  }

  return Response.json(replayState);
}
