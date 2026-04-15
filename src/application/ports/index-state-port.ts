import type {
  IndexErrorInfo,
  IndexMode,
  IndexProgress,
  StatusSnapshot,
} from "../dto/index-lifecycle.js";

export type StartIndexRunInput = {
  activeProjectIdentity: string;
  indexRunId: string;
  indexScope: StatusSnapshot["indexScope"];
  mode: IndexMode;
  requestedAt: string;
};

export type CompleteIndexRunInput = {
  activeProjectIdentity: string;
  completedAt: string;
  counters: StatusSnapshot["counters"];
  indexRunId: string;
  indexScope: StatusSnapshot["indexScope"];
};

export type FailIndexRunInput = {
  activeProjectIdentity: string;
  counters: StatusSnapshot["counters"];
  error: IndexErrorInfo;
  indexRunId: string;
  indexScope: StatusSnapshot["indexScope"];
};

export type SaveStatusSnapshotInput = StatusSnapshot & {
  configFingerprint: string;
};

export type RunIndexRecord = {
  configFingerprint: string | null;
  status: StatusSnapshot;
};

export interface IndexStatePort {
  getRecord(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<RunIndexRecord | null>;
  getStatus(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<StatusSnapshot | null>;
  markCompleted(input: CompleteIndexRunInput): Promise<StatusSnapshot>;
  markFailed(input: FailIndexRunInput): Promise<StatusSnapshot>;
  markRunning(input: StartIndexRunInput): Promise<RunIndexRecord>;
  markWatcherFailed(input: {
    activeProjectIdentity: string;
    error: IndexErrorInfo;
    indexScope: StatusSnapshot["indexScope"];
  }): Promise<StatusSnapshot>;
  markWatcherPending(input: {
    activeProjectIdentity: string;
    indexScope: StatusSnapshot["indexScope"];
  }): Promise<StatusSnapshot>;
  saveStatusSnapshot(input: SaveStatusSnapshotInput): Promise<StatusSnapshot>;
  saveProgress(input: {
    activeProjectIdentity: string;
    configFingerprint?: string | null;
    indexRunId: string;
    indexScope: StatusSnapshot["indexScope"];
    progress: IndexProgress;
  }): Promise<StatusSnapshot>;
}
