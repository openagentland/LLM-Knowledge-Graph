import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemonRequestHandler } from "../../src/application/daemon-request-handler.js";
import type { StatusSnapshot } from "../../src/application/dto/index-lifecycle.js";
import type { CanonicalFactStorePort } from "../../src/application/ports/canonical-fact-store-port.js";
import type { DerivedFactStorePort } from "../../src/application/ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../../src/application/ports/index-state-port.js";
import type { InternalGraphStorePort } from "../../src/application/ports/internal-graph-store-port.js";
import type { LoggerPort } from "../../src/application/ports/logger-port.js";
import type { SymbolCandidateStorePort } from "../../src/application/ports/symbol-candidate-store-port.js";

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

function createSymbolCandidateStore(): SymbolCandidateStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
  };
}

function createCanonicalFactStore(): CanonicalFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
  };
}

function createDerivedFactStore(): DerivedFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
  };
}

function createInternalGraphStore(): InternalGraphStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    listByPath: vi.fn().mockResolvedValue({ edges: [], nodes: [] }),
    read: vi.fn().mockResolvedValue({ edges: [], nodes: [] }),
    replace: vi.fn(),
  };
}

describe("createDaemonRequestHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns daemon health-check payload", async () => {
    const handler = createDaemonRequestHandler({
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort: createIndexStatePort(),
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
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
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
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
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
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
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
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

  it("routes symbols.query to the symbol candidate store", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        codeLocation: { endLine: 2, startLine: 1 },
        contentHash: "hash-1",
        evidenceId: "evidence-1",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntry",
        path: "main.ts",
        scope: "file",
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
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: {
        clear: vi.fn(),
        deleteByPath: vi.fn(),
        list,
        upsert: vi.fn(),
      },
    });

    const response = await handler.handle({
      command: { path: "main.ts", query: "fixture", sourceType: "code" },
      type: "symbols.query",
    });

    expect(list).toHaveBeenCalledWith({
      kind: undefined,
      path: "main.ts",
      sourceType: "code",
    });
    expect(response.type).toBe("symbols.query");
    if (response.type !== "symbols.query") {
      throw new Error("unexpected response type");
    }
    expect(response.result.results).toHaveLength(1);
    expect(response.result.results[0]?.name).toBe("mcpFixtureEntry");
  });

  it("routes symbol.get to a resolved symbol payload for an exact unique match", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        codeLocation: { endLine: 2, startLine: 1 },
        confidence: 0.8,
        contentHash: "hash-1",
        evidenceId: "evidence-1",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntry",
        path: "main.ts",
        ranking: {
          exactNameMatch: true,
          exactPathMatch: true,
          kindMatch: false,
          score: 10,
        },
        scope: "file",
        sourceType: "code",
      },
      {
        codeLocation: { endLine: 4, startLine: 3 },
        contentHash: "hash-2",
        evidenceId: "evidence-2",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntryHelper",
        path: "main.ts",
        scope: "file",
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
      canonicalFactStore: {
        ...createCanonicalFactStore(),
        list: vi.fn().mockResolvedValue([]),
      },
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: {
        clear: vi.fn(),
        deleteByPath: vi.fn(),
        list,
        upsert: vi.fn(),
      },
    });

    const response = await handler.handle({
      command: { path: "main.ts", symbol: "mcpFixtureEntry" },
      type: "symbol.get",
    });

    expect(response.type).toBe("symbol.get");
    if (response.type !== "symbol.get") {
      throw new Error("unexpected response type");
    }
    expect(response.result.candidates).toHaveLength(1);
    expect(response.result.candidates[0]?.name).toBe("mcpFixtureEntry");
    expect("symbol" in response.result && response.result.symbol?.name).toBe(
      "mcpFixtureEntry",
    );
  });

  it("surfaces explicit ambiguity errors for duplicate top-ranked symbol matches", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        codeLocation: { endLine: 2, startLine: 1 },
        confidence: 0.8,
        contentHash: "hash-1",
        evidenceId: "evidence-1",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntry",
        path: "main.ts",
        ranking: {
          exactNameMatch: true,
          exactPathMatch: true,
          kindMatch: false,
          score: 10,
        },
        scope: "file",
        sourceType: "code",
      },
      {
        codeLocation: { endLine: 6, startLine: 5 },
        confidence: 0.8,
        contentHash: "hash-2",
        evidenceId: "evidence-2",
        extractor: "ts-js:semantic",
        fileFingerprint: "fp-2",
        indexRunId: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntry",
        path: "main.ts",
        ranking: {
          exactNameMatch: true,
          exactPathMatch: true,
          kindMatch: false,
          score: 10,
        },
        scope: "file",
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
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: {
        clear: vi.fn(),
        deleteByPath: vi.fn(),
        list,
        upsert: vi.fn(),
      },
    });

    await expect(
      handler.handle({
        command: { path: "main.ts", symbol: "mcpFixtureEntry" },
        type: "symbol.get",
      }),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_SYMBOL",
      details: {
        candidates: [
          { evidence: { evidenceId: "evidence-1" }, name: "mcpFixtureEntry" },
          { evidence: { evidenceId: "evidence-2" }, name: "mcpFixtureEntry" },
        ],
      },
    });
  });

  it("closes watcher runtime when present", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const handler = createDaemonRequestHandler({
      canonicalFactStore: createCanonicalFactStore(),
      derivedFactStore: createDerivedFactStore(),
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort: createIndexStatePort(),
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
      watcherRuntime: { close },
    });

    await handler.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
