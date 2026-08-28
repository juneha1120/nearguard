import { advanceReplay, createInitialReplayState, decideApproval, rewindReplay } from "@/lib/agent/replay";
import type { ReplayState } from "@/lib/types/domain";

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

export function approveReplay(approvalId: string, approved: boolean, sessionId?: string) {
  const requestedKey = sessionKey(sessionId);
  const existingState = replayStates.get(requestedKey);
  const matchingSession = Array.from(replayStates.entries()).find(([, state]) =>
    state.pendingApprovals.some((approval) => approval.approval_id === approvalId)
  );
  const approvalSession =
    existingState?.pendingApprovals.some((approval) => approval.approval_id === approvalId)
      ? { key: requestedKey, state: existingState }
      : matchingSession
        ? { key: matchingSession[0], state: matchingSession[1] }
        : null;
  const key = approvalSession?.key ?? requestedKey;
  const baseState = approvalSession?.state ?? existingState ?? getReplayState(key);
  const replayState = decideApproval(baseState, approvalId, approved);
  replayStates.set(key, replayState);
  return replayState;
}
