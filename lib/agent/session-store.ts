import { advanceReplay, createInitialReplayState, decideApproval, decideReview, rewindReplay } from "@/lib/agent/replay";
import type { ReplayState, ReviewOutcome } from "@/lib/types/domain";

const DEFAULT_REPLAY_SESSION_ID = "default";
const replayStates = new Map<string, ReplayState>();

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
  const replayState = decideReview(getReplayState(key), reviewId, outcome);
  replayStates.set(key, replayState);
  return replayState;
}

export function approveReplay(approvalId: string, approved: boolean, sessionId?: string) {
  const key = sessionKey(sessionId);
  const replayState = decideApproval(getReplayState(key), approvalId, approved);
  replayStates.set(key, replayState);
  return replayState;
}
