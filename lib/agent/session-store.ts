import { advanceReplay, createInitialReplayState, decideApproval, decideReview, rewindReplay } from "@/lib/agent/replay";
import type { ReplayState, ReviewOutcome } from "@/lib/types/domain";

const DEFAULT_REPLAY_SESSION_ID = "default";
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
  const requestedKey = sessionKey(sessionId);
  const existingState = replayStates.get(requestedKey);
  const matchingSession = Array.from(replayStates.entries()).find(([, state]) =>
    state.pendingApprovals.some((approval) => approval.approval_id === approvalId && approval.status === "pending")
  );
  const approvalSession =
    existingState?.pendingApprovals.some((approval) => approval.approval_id === approvalId && approval.status === "pending")
      ? { key: requestedKey, state: existingState }
      : matchingSession
        ? { key: matchingSession[0], state: matchingSession[1] }
        : null;
  if (!approvalSession) return null;

  const key = approvalSession.key;
  const baseState = approvalSession.state;
  const replayState = decideApproval(baseState, approvalId, approved);
  replayStates.set(key, replayState);
  return replayState;
}
