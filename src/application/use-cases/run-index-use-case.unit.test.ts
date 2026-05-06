import { describe, expect, it, vi } from "vitest";

import type { StatusSnapshot } from "../../application/dto/index-lifecycle.js";
import type { IndexStatePort } from "../../application/ports/index-state-port.js";
import type { IngestionPipelinePort } from "../../application/ports/ingestion-pipeline-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { RunIndexUseCase } from "../../application/use-cases/run-index-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";

function createLogger(): LoggerPort & {
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const logger = {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function createIndexStatePort(
  status: Awaited<ReturnType<IndexStatePort["getStatus"]>> = null,
): IndexStatePort {
  return {
    getRecord: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(status),
    recoverStaleRunState: vi.fn().mockResolvedValue(status),
    acquireRunLock: vi.fn().mockResolvedValue({
      acquiredAt: "2026-05-05T00:00:00.000Z",
      indexRunId: "run-lock",
      lastRenewedAt: "2026-05-05T00:00:00.000Z",
      leaseExpiresAt: "2026-05-05T00:30:00.000Z",
      pid: 123,
    }),
    releaseRunLock: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markRunning: vi.fn(),
    markWatcherFailed: vi.fn(),
    markWatcherPending: vi.fn(),
    saveProgress: vi.fn(),
    saveStatusSnapshot: vi.fn(),
  };
}

function createStatusSnapshot(
  overrides: Partial<StatusSnapshot> = {},
): StatusSnapshot {
  return {
    activeProjectIdentity: "project-a",
    counters: {
      errors: 0,
      filesIndexed: 0,
      filesTotal: 0,
    },
    indexRunId: "run-default",
    indexScope: "shared",
    lastError: null,
    lastIndexedAt: null,
    needsReindex: false,
    pendingChanges: false,
    state: "idle",
    watcherState: "enabled",
    ...overrides,
  };
}

describe("RunIndexUseCase", () => {
  it("rejects a concurrent run for the same project scope", async () => {
    const existingStatus = createStatusSnapshot({
      counters: {
        errors: 0,
        filesIndexed: 1,
        filesTotal: 1,
      },
      indexRunId: "run-1",
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      state: "running",
    });
    const recoverStaleRunState = vi.fn().mockResolvedValue(existingStatus);
    const indexStatePort = {
      ...createIndexStatePort(existingStatus),
      acquireRunLock: vi.fn().mockResolvedValue(null),
      recoverStaleRunState,
    };
    const run = vi.fn();
    const ingestionPipeline: IngestionPipelinePort = {
      run,
    };
    const logger = createLogger();

    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    await expect(useCase.execute({ mode: "full" })).rejects.toMatchObject({
      code: ERROR_CODES.ALREADY_RUNNING,
    } satisfies Partial<LkgError>);
    expect(indexStatePort.acquireRunLock).toHaveBeenCalledTimes(2);
    expect(recoverStaleRunState).toHaveBeenCalledWith({
      activeProjectIdentity: "project-a",
      indexScope: "shared",
    });
    expect(indexStatePort.acquireRunLock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectIdentity: "project-a",
        indexScope: "shared",
      }),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("retries after stale-state recovery and starts the run", async () => {
    const staleStatus = createStatusSnapshot({
      indexRunId: "run-stale",
      needsReindex: true,
      pendingChanges: true,
      state: "error",
    });
    const acquireRunLock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        acquiredAt: "2026-05-05T00:00:00.000Z",
        indexRunId: "run-lock",
        lastRenewedAt: "2026-05-05T00:00:00.000Z",
        leaseExpiresAt: "2026-05-05T00:30:00.000Z",
        pid: 123,
      });
    const recoverStaleRunState = vi.fn().mockResolvedValue(staleStatus);
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(staleStatus),
      acquireRunLock,
      recoverStaleRunState,
      markCompleted: vi.fn().mockResolvedValue(createStatusSnapshot()),
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: createStatusSnapshot({
          indexRunId: "run-recovered",
          state: "running",
        }),
      }),
    };
    const ingestionPipeline: IngestionPipelinePort = {
      run: vi.fn().mockResolvedValue({
        chunks: [],
        chunksEmbedded: 0,
        chunksPurged: 0,
        chunksWritten: 0,
        counters: {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        filesPurged: 0,
        filesUnchanged: 0,
        progress: {
          batchIndex: 1,
          batchTotal: 1,
          checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
          chunksWritten: 0,
          filesProcessed: 0,
        },
        skipped: [],
      }),
    };

    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      createLogger(),
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    await expect(useCase.execute({ mode: "full" })).resolves.toMatchObject({
      mode: "full",
      state: "idle",
    });
    expect(recoverStaleRunState).toHaveBeenCalledWith({
      activeProjectIdentity: "project-a",
      indexScope: "shared",
    });
    expect(acquireRunLock).toHaveBeenCalledTimes(2);
  });

  it("completes incremental runs and persists progress", async () => {
    const markCompleted = vi.fn().mockResolvedValue({
      activeProjectIdentity: "project-a",
      counters: {
        errors: 0,
        filesIndexed: 2,
        filesTotal: 3,
      },
      indexRunId: "run-2",
      indexScope: "shared",
      lastError: null,
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle",
      watcherState: "enabled",
    });
    const saveProgress = vi.fn();
    const releaseRunLock = vi.fn().mockResolvedValue(undefined);
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
      releaseRunLock,
      markCompleted,
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: {
          activeProjectIdentity: "project-a",
          counters: {
            errors: 0,
            filesIndexed: 0,
            filesTotal: 0,
          },
          indexRunId: "run-2",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: null,
          needsReindex: false,
          pendingChanges: false,
          state: "running",
          watcherState: "enabled",
        },
      }),
      saveProgress,
    };
    const run = vi.fn().mockResolvedValue({
      chunks: [
        {
          content: "export const a = 1;",
          contentHash: "hash",
          evidenceId: "evidence",
          extractor: "ast-grep:lexical_declaration",
          indexRunId: "run-2",
          path: "src/a.ts",
          sourceType: "code",
          codeLocation: {
            endLine: 1,
            startLine: 1,
          },
        },
      ],
      chunksEmbedded: 1,
      chunksPurged: 0,
      chunksWritten: 1,
      counters: {
        errors: 0,
        filesIndexed: 2,
        filesTotal: 3,
      },
      progress: {
        batchIndex: 1,
        batchTotal: 1,
        checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
        chunksWritten: 1,
        filesProcessed: 2,
      },
      skipped: [],
    });
    const ingestionPipeline: IngestionPipelinePort = { run };
    const logger = createLogger();
    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    const result = await useCase.execute({ mode: "incremental" });
    const resultRecord = result as Record<string, unknown>;

    expect(typeof result.acceptedAt).toBe("string");
    expect(result.acceptedAt.length).toBeGreaterThan(0);
    expect(typeof result.indexRunId).toBe("string");
    expect(result.indexRunId.length).toBeGreaterThan(0);
    expect(result.mode).toBe("incremental");
    expect(result.state).toBe("idle");
    expect(run).toHaveBeenCalledTimes(1);
    expect(saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        counters: {
          errors: 0,
          filesIndexed: 2,
          filesTotal: 3,
        },
        indexRunId: resultRecord.indexRunId,
        indexScope: "shared",
      }),
    );
    expect(markCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 2,
          filesTotal: 3,
        },
        indexScope: "shared",
      }),
    );
    expect(releaseRunLock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectIdentity: "project-a",
        indexRunId: result.indexRunId,
        indexScope: "shared",
      }),
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      "Accepted index run",
      expect.objectContaining({
        event: "index.accepted",
        trigger: "manual",
        watcherState: "enabled",
      }),
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      "Completed index run",
      expect.objectContaining({
        event: "index.completed",
        trigger: "manual",
        watcherState: "enabled",
      }),
    );
  });

  it("logs lifecycle metadata for successful runs", async () => {
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
      markCompleted: vi.fn().mockResolvedValue(createStatusSnapshot()),
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: createStatusSnapshot({
          indexRunId: "run-9",
          state: "running",
        }),
      }),
    };
    const ingestionPipeline: IngestionPipelinePort = {
      run: vi.fn().mockResolvedValue({
        chunks: [],
        chunksEmbedded: 0,
        chunksPurged: 0,
        chunksWritten: 0,
        counters: {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        filesPurged: 0,
        filesUnchanged: 0,
        progress: {
          batchIndex: 1,
          batchTotal: 1,
          checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
          chunksWritten: 0,
          filesProcessed: 0,
        },
        skipped: [],
      }),
    };
    const logger = createLogger();
    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    await useCase.execute({ mode: "full" });

    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      "Accepted index run",
      expect.objectContaining({
        event: "index.accepted",
        trigger: "manual",
        watcherState: "enabled",
      }),
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      "Completed index run",
      expect.objectContaining({
        event: "index.completed",
        trigger: "manual",
        watcherState: "enabled",
      }),
    );
  });

  it("preserves the previous status snapshot before marking a run active", async () => {
    const saveStatusSnapshot = vi.fn();
    const previousStatus = createStatusSnapshot({
      indexRunId: "run-previous",
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      needsReindex: true,
      pendingChanges: true,
      state: "idle",
    });
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(previousStatus),
      markCompleted: vi.fn().mockResolvedValue(createStatusSnapshot()),
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: createStatusSnapshot({
          indexRunId: "run-next",
          state: "running",
        }),
      }),
      saveStatusSnapshot,
    };
    const ingestionPipeline: IngestionPipelinePort = {
      run: vi.fn().mockResolvedValue({
        chunks: [],
        chunksEmbedded: 0,
        chunksPurged: 0,
        chunksWritten: 0,
        counters: {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        filesPurged: 0,
        filesUnchanged: 0,
        progress: {
          batchIndex: 1,
          batchTotal: 1,
          checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
          chunksWritten: 0,
          filesProcessed: 0,
        },
        skipped: [],
      }),
    };
    const logger = createLogger();
    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    await useCase.execute({ mode: "full" });

    expect(saveStatusSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        indexRunId: "run-previous",
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: true,
        pendingChanges: true,
        state: "idle",
      }),
    );
    expect(saveStatusSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        needsReindex: false,
        pendingChanges: false,
        state: "running",
      }),
    );
  });

  it("marks a run failed when ingestion throws", async () => {
    const markFailed = vi.fn().mockResolvedValue({
      activeProjectIdentity: "project-a",
      counters: {
        errors: 1,
        filesIndexed: 0,
        filesTotal: 0,
      },
      indexRunId: "run-3",
      indexScope: "shared",
      lastError: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "boom",
        occurredAt: "2026-05-03T00:00:00.000Z",
      },
      lastIndexedAt: null,
      needsReindex: true,
      pendingChanges: false,
      state: "error",
      watcherState: "enabled",
    });
    const releaseRunLock = vi.fn().mockResolvedValue(undefined);
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
      releaseRunLock,
      markFailed,
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: {
          activeProjectIdentity: "project-a",
          counters: {
            errors: 0,
            filesIndexed: 0,
            filesTotal: 0,
          },
          indexRunId: "run-3",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: null,
          needsReindex: false,
          pendingChanges: false,
          state: "running",
          watcherState: "enabled",
        },
      }),
    };
    const ingestionPipeline: IngestionPipelinePort = {
      run: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const logger = createLogger();

    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    await expect(useCase.execute({ mode: "full" })).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    } satisfies Partial<LkgError>);
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 1,
          filesIndexed: 0,
          filesTotal: 0,
        },
        indexScope: "shared",
      }),
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      "Failed index run",
      expect.objectContaining({
        error: "boom",
        event: "index.failed",
        trigger: "manual",
        watcherState: "enabled",
      }),
    );
  });

  it("renews the run lock while ingestion is active", async () => {
    vi.useFakeTimers();
    const markCompleted = vi.fn().mockResolvedValue(createStatusSnapshot());
    const releaseRunLock = vi.fn().mockResolvedValue(undefined);
    const renewRunLock = vi.fn().mockResolvedValue({
      acquiredAt: "2026-05-05T00:00:00.000Z",
      indexRunId: "run-lock",
      lastRenewedAt: "2026-05-05T00:10:00.000Z",
      leaseExpiresAt: "2026-05-05T00:40:00.000Z",
      pid: 123,
    });
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
      markCompleted,
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: createStatusSnapshot({
          indexRunId: "run-renewed",
          state: "running",
        }),
      }),
      releaseRunLock,
      renewRunLock,
    };
    let resolveRun:
      | ((value: Awaited<ReturnType<IngestionPipelinePort["run"]>>) => void)
      | undefined;
    const run = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<IngestionPipelinePort["run"]>>>(
          (resolve) => {
            resolveRun = resolve;
          },
        ),
    );
    const ingestionPipeline: IngestionPipelinePort = { run };
    const logger = createLogger();
    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    const execution = useCase.execute({ mode: "full" });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    resolveRun?.({
      chunks: [],
      chunksEmbedded: 0,
      chunksPurged: 0,
      chunksWritten: 0,
      counters: {
        errors: 0,
        filesIndexed: 0,
        filesTotal: 0,
      },
      filesPurged: 0,
      filesUnchanged: 0,
      progress: {
        batchIndex: 1,
        batchTotal: 1,
        checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
        chunksWritten: 0,
        filesProcessed: 0,
      },
      skipped: [],
    });
    await execution;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(renewRunLock).toHaveBeenCalledTimes(1);
    expect(releaseRunLock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fails deterministically when lock renewal loses ownership", async () => {
    vi.useFakeTimers();
    const markFailed = vi.fn().mockResolvedValue(
      createStatusSnapshot({
        state: "error",
      }),
    );
    const releaseRunLock = vi.fn().mockResolvedValue(undefined);
    const renewRunLock = vi.fn().mockResolvedValue(null);
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
      markFailed,
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: createStatusSnapshot({
          indexRunId: "run-lost",
          state: "running",
        }),
      }),
      releaseRunLock,
      renewRunLock,
    };
    let resolveRun:
      | ((value: Awaited<ReturnType<IngestionPipelinePort["run"]>>) => void)
      | undefined;
    const run = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<IngestionPipelinePort["run"]>>>(
          (resolve) => {
            resolveRun = resolve;
          },
        ),
    );
    const ingestionPipeline: IngestionPipelinePort = { run };
    const logger = createLogger();
    const useCase = new RunIndexUseCase(
      indexStatePort,
      ingestionPipeline,
      logger,
      {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    );

    const execution = useCase.execute({ mode: "full" });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    resolveRun?.({
      chunks: [],
      chunksEmbedded: 0,
      chunksPurged: 0,
      chunksWritten: 0,
      counters: {
        errors: 0,
        filesIndexed: 0,
        filesTotal: 0,
      },
      filesPurged: 0,
      filesUnchanged: 0,
      progress: {
        batchIndex: 1,
        batchTotal: 1,
        checkpointWrittenAt: "2026-05-03T00:00:00.000Z",
        chunksWritten: 0,
        filesProcessed: 0,
      },
      skipped: [],
    });

    await expect(execution).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    } satisfies Partial<LkgError>);
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Index run lost its coordination lock.",
          occurredAt: expect.any(String) as string,
        },
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Lost index run lock",
      expect.objectContaining({ event: "index.lock_lost" }),
    );
    expect(releaseRunLock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
