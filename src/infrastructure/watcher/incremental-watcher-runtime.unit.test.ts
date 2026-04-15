import type { AsyncSubscription } from "@parcel/watcher";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusSnapshot } from "../../application/dto/index-lifecycle.js";
import type { IndexStatePort } from "../../application/ports/index-state-port.js";
import type { IngestionPipelinePort } from "../../application/ports/ingestion-pipeline-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import {
  createWatcherIndexRunner,
  IncrementalWatcherRuntime,
  type IndexRunner,
} from "../../infrastructure/watcher/incremental-watcher-runtime.js";
import { ERROR_CODES } from "../../shared/errors/lkg-error.js";

function createSubscription(): AsyncSubscription {
  return {
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  };
}

describe("IncrementalWatcherRuntime", () => {
  let originalSetTimeout: typeof global.setTimeout;
  let originalClearTimeout: typeof global.clearTimeout;
  let scheduledCallback: (() => void) | null;

  beforeEach(() => {
    originalSetTimeout = global.setTimeout;
    originalClearTimeout = global.clearTimeout;
    scheduledCallback = null;

    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    vi.restoreAllMocks();
  });

  it("coalesces file changes into a single incremental run", async () => {
    const markWatcherPending = vi.fn().mockResolvedValue({});
    const indexRunner: IndexRunner = {
      execute: vi.fn().mockResolvedValue({
        acceptedAt: "2026-05-03T00:00:00.000Z",
        indexRunId: "run-1",
        mode: "incremental",
        state: "idle",
      }),
    };
    const runtime = new IncrementalWatcherRuntime({
      cwd: "/repo/project",
      debounceMs: 25,
      indexRunner,
      indexStatePort: {
        getRecord: vi.fn(),
        getStatus: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
        markRunning: vi.fn(),
        markWatcherFailed: vi.fn(),
        markWatcherPending,
        saveProgress: vi.fn(),
        saveStatusSnapshot: vi.fn(),
      },
      logger: createLogger(),
      statusContext: {
        activeProjectIdentity: "project-a",
        indexScope: "shared",
      },
      watchFactory: () => Promise.resolve(createSubscription()),
    });

    await runtime.notifyPathsChanged(["src/a.ts"]);
    await runtime.notifyPathsChanged(["src/b.ts"]);
    scheduledCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(markWatcherPending).toHaveBeenCalledTimes(2);
    expect(indexRunner.execute).toHaveBeenCalledTimes(1);
    expect(indexRunner.execute).toHaveBeenCalledWith({ mode: "incremental" });

    await runtime.close();
  });

  it("schedules one follow-up run when changes arrive during an active run", async () => {
    let resolveRun: (() => void) | undefined;
    const indexRunner: IndexRunner = {
      execute: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRun = () =>
              resolve({
                acceptedAt: "2026-05-03T00:00:00.000Z",
                indexRunId: "run-2",
                mode: "incremental",
                state: "idle",
              });
          }),
      ),
    };
    const runtime = new IncrementalWatcherRuntime({
      cwd: "/repo/project",
      debounceMs: 25,
      indexRunner,
      indexStatePort: {
        getRecord: vi.fn(),
        getStatus: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
        markRunning: vi.fn(),
        markWatcherFailed: vi.fn(),
        markWatcherPending: vi.fn().mockResolvedValue({}),
        saveProgress: vi.fn(),
        saveStatusSnapshot: vi.fn(),
      },
      logger: createLogger(),
      statusContext: {
        activeProjectIdentity: "project-a",
        indexScope: "shared",
      },
      watchFactory: () => Promise.resolve(createSubscription()),
    });

    await runtime.notifyPathsChanged(["src/a.ts"]);
    scheduledCallback?.();
    await Promise.resolve();

    await runtime.notifyPathsChanged(["src/b.ts"]);
    resolveRun?.();
    await Promise.resolve();
    scheduledCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(indexRunner.execute).toHaveBeenCalledTimes(2);

    await runtime.close();
  });

  it("marks watcher failure without crashing", async () => {
    const markWatcherFailed = vi.fn().mockResolvedValue({});
    const logger = createLogger();
    const runtime = new IncrementalWatcherRuntime({
      cwd: "/repo/project",
      debounceMs: 25,
      indexRunner: {
        execute: vi.fn().mockRejectedValue(new Error("boom")),
      },
      indexStatePort: {
        getRecord: vi.fn(),
        getStatus: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
        markRunning: vi.fn(),
        markWatcherFailed,
        markWatcherPending: vi.fn().mockResolvedValue({}),
        saveProgress: vi.fn(),
        saveStatusSnapshot: vi.fn(),
      },
      logger,
      statusContext: {
        activeProjectIdentity: "project-a",
        indexScope: "shared",
      },
      watchFactory: () => Promise.resolve(createSubscription()),
    });

    await runtime.notifyPathsChanged(["src/a.ts"]);
    scheduledCallback?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(markWatcherFailed).toHaveBeenCalledTimes(1);
    expect(markWatcherFailed.mock.calls[0]?.[0]).toMatchObject({
      activeProjectIdentity: "project-a",
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "boom",
      },
      indexScope: "shared",
    });
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      "Watcher incremental index run failed",
      expect.objectContaining({
        error: "boom",
      }),
    );

    await runtime.close();
  });
});

describe("createWatcherIndexRunner", () => {
  it("reuses RunIndexUseCase for watcher-driven indexing", async () => {
    const markRunning = vi.fn().mockResolvedValue({
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
      } satisfies StatusSnapshot,
    });
    const indexStatePort: IndexStatePort = {
      getRecord: vi.fn(),
      getStatus: vi.fn().mockResolvedValue(null),
      markCompleted: vi.fn().mockResolvedValue({}),
      markFailed: vi.fn(),
      markRunning,
      markWatcherFailed: vi.fn(),
      markWatcherPending: vi.fn(),
      saveProgress: vi.fn(),
      saveStatusSnapshot: vi.fn(),
    };
    const run = vi.fn().mockResolvedValue({
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
    const ingestionPipeline: IngestionPipelinePort = { run };

    const runner = createWatcherIndexRunner({
      indexStatePort,
      ingestionPipeline,
      logger: createLogger(),
      statusContext: {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        indexScope: "shared",
        watcherState: "enabled",
      },
    });

    const result = await runner.execute({ mode: "incremental" });

    expect(result).toMatchObject({ state: "idle" });
    expect(markRunning).toHaveBeenCalled();
    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "incremental" }),
    );
  });
});

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
