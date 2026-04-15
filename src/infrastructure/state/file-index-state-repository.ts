import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  StatusSnapshot,
  WatcherState,
} from "../../application/dto/index-lifecycle.js";
import type {
  CompleteIndexRunInput,
  FailIndexRunInput,
  IndexStatePort,
  RunIndexRecord,
  SaveStatusSnapshotInput,
  StartIndexRunInput,
} from "../../application/ports/index-state-port.js";

export class FileIndexStateRepository implements IndexStatePort {
  constructor(private readonly options: { homeDir: string }) {}

  async getRecord(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<RunIndexRecord | null> {
    return this.readRecord(activeProjectIdentity, indexScope);
  }

  async getStatus(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<StatusSnapshot | null> {
    const record = await this.readRecord(activeProjectIdentity, indexScope);
    return record?.status ?? null;
  }

  async markCompleted(input: CompleteIndexRunInput): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const status: StatusSnapshot = {
      ...existing.status,
      counters: input.counters,
      indexRunId: input.indexRunId,
      lastError: null,
      lastIndexedAt: input.completedAt,
      needsReindex: false,
      pendingChanges: false,
      progress: existing.status.progress,
      state: "idle",
    };

    await this.writeRecord(input.activeProjectIdentity, input.indexScope, {
      ...existing,
      status,
    });

    return status;
  }

  async markFailed(input: FailIndexRunInput): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const status: StatusSnapshot = {
      ...existing.status,
      counters: input.counters,
      indexRunId: input.indexRunId,
      lastError: input.error,
      needsReindex: true,
      pendingChanges: false,
      progress: existing.status.progress,
      state: "error",
    };

    await this.writeRecord(input.activeProjectIdentity, input.indexScope, {
      ...existing,
      status,
    });

    return status;
  }

  async markRunning(input: StartIndexRunInput): Promise<RunIndexRecord> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const status: StatusSnapshot = {
      ...existing.status,
      indexRunId: input.indexRunId,
      lastError: null,
      needsReindex: false,
      pendingChanges: false,
      progress: {
        batchIndex: 0,
        batchTotal: 0,
        checkpointWrittenAt: null,
        chunksWritten: 0,
        filesProcessed: 0,
      },
      state: "running",
    };

    const record: RunIndexRecord = {
      configFingerprint: existing.configFingerprint,
      status,
    };

    await this.writeRecord(
      input.activeProjectIdentity,
      input.indexScope,
      record,
    );
    return record;
  }

  async markWatcherFailed(input: {
    activeProjectIdentity: string;
    error: StatusSnapshot["lastError"] extends infer T
      ? Exclude<T, null>
      : never;
    indexScope: StatusSnapshot["indexScope"];
  }): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const status: StatusSnapshot = {
      ...existing.status,
      lastError: input.error,
      needsReindex: true,
      pendingChanges: true,
    };

    await this.writeRecord(input.activeProjectIdentity, input.indexScope, {
      ...existing,
      status,
    });

    return status;
  }

  async markWatcherPending(input: {
    activeProjectIdentity: string;
    indexScope: StatusSnapshot["indexScope"];
  }): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const status: StatusSnapshot = {
      ...existing.status,
      needsReindex: true,
      pendingChanges: true,
    };

    await this.writeRecord(input.activeProjectIdentity, input.indexScope, {
      ...existing,
      status,
    });

    return status;
  }

  async saveStatusSnapshot(
    input: SaveStatusSnapshotInput,
  ): Promise<StatusSnapshot> {
    const record: RunIndexRecord = {
      configFingerprint: input.configFingerprint,
      status: {
        activeProjectIdentity: input.activeProjectIdentity,
        counters: input.counters,
        indexRunId: input.indexRunId,
        indexScope: input.indexScope,
        lastError: input.lastError,
        lastIndexedAt: input.lastIndexedAt,
        needsReindex: input.needsReindex,
        pendingChanges: input.pendingChanges,
        progress: input.progress,
        state: input.state,
        watcherState: input.watcherState,
      },
    };

    await this.writeRecord(
      input.activeProjectIdentity,
      input.indexScope,
      record,
    );
    return record.status;
  }

  async saveProgress(input: {
    activeProjectIdentity: string;
    configFingerprint?: string | null;
    indexRunId: string;
    indexScope: StatusSnapshot["indexScope"];
    progress: NonNullable<StatusSnapshot["progress"]>;
  }): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const record: RunIndexRecord = {
      configFingerprint: input.configFingerprint ?? existing.configFingerprint,
      status: {
        ...existing.status,
        indexRunId: input.indexRunId,
        progress: input.progress,
      },
    };

    await this.writeRecord(
      input.activeProjectIdentity,
      input.indexScope,
      record,
    );
    return record.status;
  }

  private async readOrCreateDefault(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
    watcherState: WatcherState,
  ): Promise<RunIndexRecord> {
    const record = await this.readRecord(activeProjectIdentity, indexScope);
    if (record) {
      return {
        ...record,
        status: {
          ...record.status,
          pendingChanges: record.status.pendingChanges,
          progress: record.status.progress,
        },
      };
    }

    return {
      configFingerprint: null,
      status: {
        activeProjectIdentity,
        counters: {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        indexRunId: null,
        indexScope,
        lastError: null,
        lastIndexedAt: null,
        needsReindex: true,
        pendingChanges: false,
        progress: undefined,
        state: "idle",
        watcherState,
      },
    };
  }

  private async readRecord(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<RunIndexRecord | null> {
    try {
      const content = await readFile(
        this.resolvePath(activeProjectIdentity, indexScope),
        "utf8",
      );
      const record = JSON.parse(content) as RunIndexRecord;
      return {
        ...record,
        status: {
          ...record.status,
          pendingChanges: record.status.pendingChanges,
          progress: record.status.progress,
        },
      };
    } catch {
      return null;
    }
  }

  private resolvePath(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): string {
    return resolve(
      this.options.homeDir,
      "state",
      activeProjectIdentity,
      `${indexScope}.json`,
    );
  }

  private async writeRecord(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
    record: RunIndexRecord,
  ): Promise<void> {
    const filePath = this.resolvePath(activeProjectIdentity, indexScope);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
}
