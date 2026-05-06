import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  StatusSnapshot,
  WatcherState,
} from "../../application/dto/index-lifecycle.js";
import type {
  AcquireRunLockInput,
  CompleteIndexRunInput,
  FailIndexRunInput,
  IndexRunLock,
  IndexStatePort,
  ReleaseRunLockInput,
  RenewRunLockInput,
  RunIndexRecord,
  SaveProgressInput,
  SaveStatusSnapshotInput,
  StartIndexRunInput,
} from "../../application/ports/index-state-port.js";

const INDEX_RUN_LOCK_LEASE_MS = 30 * 60 * 1000;

export class FileIndexStateRepository implements IndexStatePort {
  constructor(private readonly options: { homeDir: string }) {}

  async acquireRunLock(
    input: AcquireRunLockInput,
  ): Promise<IndexRunLock | null> {
    const now = input.now ?? new Date();
    const lockPath = this.resolveLockPath(
      input.activeProjectIdentity,
      input.indexScope,
    );
    await mkdir(dirname(lockPath), { recursive: true });

    for (;;) {
      try {
        await mkdir(lockPath, { recursive: false });
        const lock: IndexRunLock = {
          acquiredAt: now.toISOString(),
          indexRunId: input.indexRunId,
          lastRenewedAt: now.toISOString(),
          leaseExpiresAt: new Date(
            now.getTime() + INDEX_RUN_LOCK_LEASE_MS,
          ).toISOString(),
          pid: process.pid,
        };
        await writeFile(
          resolve(lockPath, "owner.json"),
          `${JSON.stringify(lock, null, 2)}\n`,
          "utf8",
        );
        return lock;
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }

        const existing = await this.readRunLock(
          input.activeProjectIdentity,
          input.indexScope,
        );
        if (existing !== null && !isRunLockExpired(existing, now)) {
          return null;
        }

        await rm(lockPath, { force: true, recursive: true });
      }
    }
  }

  async releaseRunLock(input: ReleaseRunLockInput): Promise<void> {
    const existing = await this.readRunLock(
      input.activeProjectIdentity,
      input.indexScope,
    );
    if (existing?.indexRunId !== input.indexRunId) {
      return;
    }

    await rm(
      this.resolveLockPath(input.activeProjectIdentity, input.indexScope),
      { force: true, recursive: true },
    );
  }

  async renewRunLock(input: RenewRunLockInput): Promise<IndexRunLock | null> {
    const now = input.now ?? new Date();
    const existing = await this.readRunLock(
      input.activeProjectIdentity,
      input.indexScope,
    );
    if (existing?.indexRunId !== input.indexRunId) {
      return null;
    }

    const lock: IndexRunLock = {
      ...existing,
      lastRenewedAt: now.toISOString(),
      leaseExpiresAt: new Date(
        now.getTime() + INDEX_RUN_LOCK_LEASE_MS,
      ).toISOString(),
    };
    await writeFile(
      resolve(
        this.resolveLockPath(input.activeProjectIdentity, input.indexScope),
        "owner.json",
      ),
      `${JSON.stringify(lock, null, 2)}\n`,
      "utf8",
    );
    return lock;
  }

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
    const recovered = await this.recoverStaleRunState({
      activeProjectIdentity,
      indexScope,
    });
    return recovered;
  }

  async recoverStaleRunState(input: {
    activeProjectIdentity: string;
    indexScope: StatusSnapshot["indexScope"];
    now?: Date;
  }): Promise<StatusSnapshot | null> {
    const record = await this.readRecord(
      input.activeProjectIdentity,
      input.indexScope,
    );
    if (record === null) {
      return null;
    }

    if (record.status.state !== "running") {
      return record.status;
    }

    const runLock = await this.readRunLock(
      input.activeProjectIdentity,
      input.indexScope,
    );
    const now = input.now ?? new Date();
    if (runLock !== null && !isRunLockExpired(runLock, now)) {
      return record.status;
    }

    const status: StatusSnapshot = {
      ...record.status,
      lastError: {
        code: "INTERNAL_ERROR",
        message: "The previous index run lost its coordination state.",
        occurredAt: now.toISOString(),
      },
      needsReindex: true,
      state: "error",
    };

    await this.writeRecord(input.activeProjectIdentity, input.indexScope, {
      ...record,
      status,
    });

    return status;
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

  async saveProgress(input: SaveProgressInput): Promise<StatusSnapshot> {
    const existing = await this.readOrCreateDefault(
      input.activeProjectIdentity,
      input.indexScope,
      "disabled",
    );

    const record: RunIndexRecord = {
      configFingerprint: input.configFingerprint ?? existing.configFingerprint,
      status: {
        ...existing.status,
        counters: input.counters ?? existing.status.counters,
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

  private resolveLockPath(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): string {
    return resolve(
      this.options.homeDir,
      "state",
      activeProjectIdentity,
      `${indexScope}.run.lock`,
    );
  }

  private async readRunLock(
    activeProjectIdentity: string,
    indexScope: StatusSnapshot["indexScope"],
  ): Promise<IndexRunLock | null> {
    try {
      const content = await readFile(
        resolve(
          this.resolveLockPath(activeProjectIdentity, indexScope),
          "owner.json",
        ),
        "utf8",
      );
      return JSON.parse(content) as IndexRunLock;
    } catch {
      return null;
    }
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

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isRunLockExpired(lock: IndexRunLock, now: Date): boolean {
  return Date.parse(lock.leaseExpiresAt) <= now.getTime();
}
