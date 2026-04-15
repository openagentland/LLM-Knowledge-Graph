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
    const indexStatePort = createIndexStatePort(
      createStatusSnapshot({
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        state: "running",
      }),
    );
    const ingestionPipeline: IngestionPipelinePort = {
      run: vi.fn(),
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
  });

  it("passes mode to ingestion and marks a run completed after ingestion succeeds", async () => {
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
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
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
    const indexStatePort: IndexStatePort = {
      ...createIndexStatePort(),
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
});
