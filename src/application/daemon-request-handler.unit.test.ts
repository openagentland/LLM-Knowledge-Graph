import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemonRequestHandler } from "../../src/application/daemon-request-handler.js";
import type { StatusSnapshot } from "../../src/application/dto/index-lifecycle.js";
import type { IndexStatePort } from "../../src/application/ports/index-state-port.js";
import type { LoggerPort } from "../../src/application/ports/logger-port.js";

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

function createStatusContext() {
  return {
    activeProjectIdentity: "project-a",
    configFingerprint: "fingerprint-a",
    indexScope: "shared" as StatusSnapshot["indexScope"],
    watcherState: "enabled" as StatusSnapshot["watcherState"],
  };
}

function createIndexStatePort(
  overrides: Partial<IndexStatePort> = {},
): IndexStatePort {
  return {
    getRecord: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(null),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markRunning: vi.fn(),
    markWatcherFailed: vi.fn(),
    markWatcherPending: vi.fn(),
    saveProgress: vi.fn(),
    saveStatusSnapshot: vi.fn(),
    ...overrides,
  };
}

describe("createDaemonRequestHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns daemon health-check payload", async () => {
    const handler = createDaemonRequestHandler({
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort: createIndexStatePort(),
      ingestionPipeline: { run: vi.fn() },
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
    });

    const response = await handler.handle({ type: "health.check" });

    expect(response).toEqual({
      runtimeState: "ready",
      type: "health.check",
    });
  });

  it("returns daemon-ready status payload", async () => {
    const indexStatePort = createIndexStatePort({
      getRecord: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: {
          activeProjectIdentity: "project-a",
          counters: { errors: 0, filesIndexed: 1, filesTotal: 2 },
          indexRunId: "run-1",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: "2026-05-03T00:00:00.000Z",
          needsReindex: false,
          pendingChanges: false,
          state: "idle",
          watcherState: "enabled",
        } satisfies StatusSnapshot,
      }),
    });

    const handler = createDaemonRequestHandler({
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
    });

    const response = await handler.handle({ type: "status" });

    expect(response.type).toBe("status");
    if (response.type !== "status") {
      throw new Error("unexpected response type");
    }
    expect(response.status.daemonState).toBe("ready");
    expect(response.status.runtimeState).toBe("ready");
    expect(response.status.activeProjectIdentity).toBe("project-a");
  });

  it("delegates index.start to the index use case path", async () => {
    const indexStatePort = createIndexStatePort({
      getStatus: vi.fn().mockResolvedValue(null),
      markRunning: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: {
          activeProjectIdentity: "project-a",
          counters: { errors: 0, filesIndexed: 0, filesTotal: 0 },
          indexRunId: "run-2",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: null,
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
          watcherState: "enabled",
        } satisfies StatusSnapshot,
      }),
      markCompleted: vi.fn().mockResolvedValue({}),
      saveProgress: vi.fn().mockResolvedValue({}),
      saveStatusSnapshot: vi.fn().mockResolvedValue({}),
    });
    const run = vi.fn().mockResolvedValue({
      chunks: [],
      chunksEmbedded: 0,
      chunksPurged: 0,
      chunksWritten: 0,
      counters: { errors: 0, filesIndexed: 0, filesTotal: 0 },
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

    const handler = createDaemonRequestHandler({
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run },
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
    });

    const response = await handler.handle({
      command: { mode: "incremental" },
      type: "index.start",
    });

    expect(response.type).toBe("index.start");
    if (response.type !== "index.start") {
      throw new Error("unexpected response type");
    }
    expect(response.result.state).toBe("idle");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "incremental" }),
    );
  });

  it("delegates search.query to embedding and retriever", async () => {
    const embedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const retrieve = vi.fn().mockResolvedValue([
      {
        chunkKey: "chunk-1",
        codeLocation: { endLine: 12, startLine: 10 },
        content: "search hit",
        contentHash: "hash-1",
        embedding: [0.1, 0.2, 0.3],
        evidenceId: "evidence-1",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-3",
        path: "src/main.ts",
        score: 0.9,
        sourceType: "code",
      },
    ]);
    const indexStatePort = createIndexStatePort({
      getStatus: vi.fn().mockResolvedValue({
        activeProjectIdentity: "project-a",
        counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
        indexRunId: "run-3",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        pendingChanges: false,
        state: "idle",
        watcherState: "enabled",
      } satisfies StatusSnapshot),
    });

    const handler = createDaemonRequestHandler({
      embedding: { embedChunks: vi.fn(), embedQuery },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      logger: createLogger(),
      retriever: { retrieve },
      statusContext: createStatusContext(),
    });

    const response = await handler.handle({
      command: { query: "search hit", topK: 1 },
      type: "search.query",
    });

    expect(embedQuery).toHaveBeenCalledWith("search hit");
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: "search hit", topK: 1 }),
    );
    expect(response.type).toBe("search.query");
  });

  it("closes watcher runtime when present", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const handler = createDaemonRequestHandler({
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort: createIndexStatePort(),
      ingestionPipeline: { run: vi.fn() },
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      watcherRuntime: { close },
    });

    await handler.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
