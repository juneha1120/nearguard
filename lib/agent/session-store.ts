import { advanceReplay, createInitialReplayState, decideApproval, decideReview, rewindReplay } from "@/lib/agent/replay";
import type { ReplayState, ReviewOutcome } from "@/lib/types/domain";

const DEFAULT_REPLAY_SESSION_ID = "default";
// Next dev bundles each route handler separately, so a module-level Map is not shared
// between /api/replay/* routes. Pin the store on globalThis so every route sees one session store.
const globalStore = globalThis as typeof globalThis & { __nearguardReplayStates?: Map<string, ReplayState> };
const replayStates = (globalStore.__nearguardReplayStates ??= new Map<string, ReplayState>());

function sessionKey(sessionId?: string) {
  return sessionId || DEFAULT_REPLAY_SESSION_ID;
}

export function startReplay(scenarioId?: string, sessionId?: string) {
  const key = sessionKey(sessionId);
  const replayState = createInitialReplayState(scenarioId);
  replayStates.set(key, replayState);
  return replayState;
}

export function getReplayState(sessionId?: string) {
  const key = sessionKey(sessionId);
  let replayState = replayStates.get(key) ?? null;
  if (!replayState) {
    replayState = createInitialReplayState();
    replayStates.set(key, replayState);
  }
  return replayState;
}

export function stepReplay(sessionId?: string) {
  const key = sessionKey(sessionId);
  const replayState = advanceReplay(getReplayState(key));
  replayStates.set(key, replayState);
  return replayState;
}

export function previousReplay(sessionId?: string) {
  const key = sessionKey(sessionId);
  const replayState = rewindReplay(getReplayState(key));
  replayStates.set(key, replayState);
  return replayState;
}

export function reviewReplay(reviewId: string, outcome: ReviewOutcome, sessionId?: string) {
  const key = sessionKey(sessionId);
  const current = getReplayState(key);
  if (!current.pendingReviews.some((review) => review.review_id === reviewId && review.status === "pending")) return null;

  const replayState = decideReview(current, reviewId, outcome);
  replayStates.set(key, replayState);
  return replayState;
}

export function approveReplay(approvalId: string, approved: boolean, sessionId?: string) {
  const key = sessionKey(sessionId);
  const replayState = decideApproval(getReplayState(key), approvalId, approved);
  replayStates.set(key, replayState);
  return replayState;
}
