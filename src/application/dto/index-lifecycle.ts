export type IndexLifecycleState = "idle" | "running" | "error";

export type IndexScope = "shared" | "branch";

export type WatcherState = "enabled" | "disabled";

export type DaemonState = "starting" | "ready" | "degraded" | "stopped";

export type RuntimeState = "cold" | "warming" | "ready" | "error";

export type IndexMode = "full" | "incremental" | "rebuild";

export type IndexCounters = {
  errors: number;
  filesIndexed: number;
  filesTotal: number;
};

export type IndexProgress = {
  batchIndex: number;
  batchTotal: number;
  checkpointWrittenAt: string | null;
  chunksWritten: number;
  filesProcessed: number;
};

export type IndexErrorInfo = {
  code: string;
  message: string;
  occurredAt: string;
};

export type StatusSnapshot = {
  activeProjectIdentity: string;
  counters: IndexCounters;
  daemonState?: DaemonState;
  indexRunId: string | null;
  indexScope: IndexScope;
  lastError: IndexErrorInfo | null;
  lastIndexedAt: string | null;
  needsReindex: boolean;
  pendingChanges: boolean;
  progress?: IndexProgress;
  runtimeState?: RuntimeState;
  state: IndexLifecycleState;
  watcherState: WatcherState;
};

export type RunIndexCommand = {
  mode: IndexMode;
};

export type RunIndexResult = {
  acceptedAt: string;
  indexRunId: string;
  mode: IndexMode;
  state: Extract<IndexLifecycleState, "idle">;
};
