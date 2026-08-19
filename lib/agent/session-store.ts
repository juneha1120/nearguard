import { advanceReplay, createInitialReplayState, decideApproval } from "@/lib/agent/replay";
import type { ReplayState } from "@/lib/types/domain";

let replayState: ReplayState | null = null;

export function startReplay(scenarioId?: string) {
  replayState = createInitialReplayState(scenarioId);
  return replayState;
}

export function getReplayState() {
  if (!replayState) {
    replayState = createInitialReplayState();
  }
  return replayState;
}

export function stepReplay() {
  replayState = advanceReplay(getReplayState());
  return replayState;
}

export function approveReplay(approvalId: string, approved: boolean) {
  replayState = decideApproval(getReplayState(), approvalId, approved);
  return replayState;
}
