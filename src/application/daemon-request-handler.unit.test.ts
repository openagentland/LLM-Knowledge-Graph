import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDaemonRequestHandler,
  createDaemonRuntime,
} from "../../src/application/daemon-request-handler.js";
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
    listEdgesByNode: vi.fn().mockResolvedValue([]),
    listNodesByPath: vi.fn().mockResolvedValue([]),
    readSnapshot: vi.fn().mockResolvedValue({ edges: [], nodes: [] }),
    replaceSnapshot: vi.fn(),
  };
}

describe("createDaemonRequestHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes watcher runtime through daemon runtime wrapper", async () => {
    const watcherRuntime = { close: vi.fn().mockResolvedValue(undefined) };

    await createDaemonRuntime({ watcherRuntime }).close();

    expect(watcherRuntime.close).toHaveBeenCalledTimes(1);
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

  it("passes Milestone 4.1 analysis commands through without presenter-specific transforms", async () => {
    const readyStatus = {
      activeProjectIdentity: "project-a",
      counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
      indexRunId: "run-4",
      indexScope: "shared" as const,
      lastError: null,
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle" as const,
      watcherState: "enabled" as const,
    } satisfies StatusSnapshot;
    const indexStatePort = createIndexStatePort({
      getStatus: vi.fn().mockResolvedValue(readyStatus),
    });

    const canonicalFactStore = createCanonicalFactStore();
    const canonicalFactList = vi.fn().mockResolvedValue([
      {
        confidence: 0.95,
        contentHash: "hash-1",
        evidenceId: "evidence-1",
        extractor: "artifact:repo-config",
        factId: "fact-1",
        fileFingerprint: "fp-1",
        indexRunId: "run-4",
        kind: "package_script",
        layer: "canonical",
        path: "package.json",
        payload: { command: "node dist/main.js", scriptName: "start" },
        sourceType: "code",
      },
    ]);
    canonicalFactStore.list = canonicalFactList;

    const derivedFactStore = createDerivedFactStore();
    const derivedFactList = vi
      .fn()
      .mockResolvedValueOnce([
        {
          confidence: 0.82,
          contentHash: "hash-entrypoint",
          derivedFactId: "derived-entrypoint",
          evidenceId: "evidence-entrypoint",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-4",
          kind: "script-references-symbol-candidate",
          layer: "derived",
          path: "package.json",
          payload: {
            fromId: "task:start",
            fromKind: "task",
            fromLabel: "start",
            toId: "symbol-main",
            toKind: "symbol",
            toLabel: "main",
          },
          sourceType: "code",
        },
      ])
      .mockResolvedValueOnce([
        {
          confidence: 0.8,
          contentHash: "hash-flow",
          derivedFactId: "derived-flow",
          evidenceId: "evidence-flow",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-4",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-main",
            fromKind: "symbol",
            fromLabel: "main",
            toId: "symbol-helper",
            toKind: "symbol",
            toLabel: "helper",
          },
          sourceType: "code",
        },
      ])
      .mockResolvedValueOnce([
        {
          confidence: 0.7,
          contentHash: "hash-impact",
          derivedFactId: "derived-impact",
          evidenceId: "evidence-impact",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-4",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-main",
            fromKind: "symbol",
            fromLabel: "main",
            toId: "symbol-leaf",
            toKind: "symbol",
            toLabel: "leaf",
          },
          sourceType: "code",
        },
      ])
      .mockResolvedValueOnce([
        {
          confidence: 0.6,
          contentHash: "hash-slice",
          derivedFactId: "derived-slice",
          evidenceId: "evidence-slice",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-4",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-main",
            fromKind: "symbol",
            fromLabel: "main",
            toId: "symbol-child",
            toKind: "symbol",
            toLabel: "child",
          },
          sourceType: "code",
        },
      ]);
    derivedFactStore.list = derivedFactList;

    const internalGraphStore = createInternalGraphStore();
    const listEdgesByNode = vi
      .fn()
      .mockResolvedValueOnce([
        {
          edgeId: "edge-1",
          fromNodeId: "symbol-main",
          kind: "calls",
          toNodeId: "symbol-helper",
        },
      ])
      .mockResolvedValueOnce([]);
    internalGraphStore.listEdgesByNode = listEdgesByNode;

    const symbolCandidateStore = createSymbolCandidateStore();
    const symbolCandidateList = vi.fn().mockResolvedValue([
      {
        codeLocation: { endLine: 3, startLine: 1 },
        confidence: 0.91,
        contentHash: "hash-main",
        evidenceId: "symbol-main",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-main",
        indexRunId: "run-4",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/main.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
    ]);
    symbolCandidateStore.list = symbolCandidateList;

    const handler = createDaemonRequestHandler({
      canonicalFactStore,
      derivedFactStore,
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore,
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore,
    });

    const entrypointCommand = {
      confidenceMin: 0.5,
      kind: "script" as const,
      limit: 1,
      package: "app",
      path: "package.json",
      query: "start",
    };
    const flowCommand = {
      confidenceMin: 0.4,
      direction: "both" as const,
      from: {
        kind: "symbol" as const,
        name: "main",
        path: "src/main.ts",
        sourceType: "code" as const,
      },
      include: ["calls", "workflow"] as const,
      maxDepth: 2,
      maxNodes: 5,
      timeBudgetMs: 900,
      to: {
        id: "symbol-helper",
        kind: "symbol" as const,
        name: "helper",
        path: "src/main.ts",
        sourceType: "code" as const,
      },
    };
    const impactCommand = {
      confidenceMin: 0.3,
      maxDepth: 2,
      maxResults: 1,
      mode: "callees" as const,
      target: {
        kind: "symbol" as const,
        name: "main",
        path: "src/main.ts",
        sourceType: "code" as const,
      },
    };
    const sliceCommand = {
      criterion: {
        kind: "symbol" as const,
        name: "main",
        path: "src/main.ts",
        sourceType: "code" as const,
      },
      direction: "backward" as const,
      include: ["calls"] as const,
      maxEvidence: 3,
      maxFiles: 2,
      maxNodes: 2,
    };

    await handler.handle({
      command: entrypointCommand,
      type: "entrypoints.list",
    });
    await handler.handle({ command: flowCommand, type: "flow.trace" });
    await handler.handle({ command: impactCommand, type: "impact.analyze" });
    await handler.handle({ command: sliceCommand, type: "slice.compute" });

    expect(canonicalFactList).toHaveBeenCalledWith();
    expect(derivedFactList).toHaveBeenNthCalledWith(1);
    expect(derivedFactList).toHaveBeenNthCalledWith(2);
    expect(derivedFactList).toHaveBeenNthCalledWith(3);
    expect(derivedFactList).toHaveBeenNthCalledWith(4);
    expect(listEdgesByNode).toHaveBeenCalledWith("symbol-main");
    expect(symbolCandidateList).toHaveBeenNthCalledWith(1, {
      path: "package.json",
    });
    expect(symbolCandidateList).toHaveBeenNthCalledWith(2, {
      kind: undefined,
      path: "src/main.ts",
      sourceType: "code",
    });
    expect(symbolCandidateList).toHaveBeenNthCalledWith(3, {
      kind: undefined,
      path: "src/main.ts",
      sourceType: "code",
    });
    expect(symbolCandidateList).toHaveBeenNthCalledWith(4, {
      kind: undefined,
      path: "src/main.ts",
      sourceType: "code",
    });
  });

  it("surfaces Milestone 4.1 readiness and anchor errors from use cases unchanged", async () => {
    const notReady = {
      activeProjectIdentity: "project-a",
      counters: { errors: 0, filesIndexed: 0, filesTotal: 0 },
      indexRunId: null,
      indexScope: "shared" as const,
      lastError: null,
      lastIndexedAt: null,
      needsReindex: false,
      pendingChanges: false,
      state: "running" as const,
      watcherState: "enabled" as const,
    } satisfies StatusSnapshot;
    const indexStatePort = createIndexStatePort({
      getStatus: vi.fn().mockResolvedValue(notReady),
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

    await expect(
      handler.handle({
        command: { query: "start" },
        type: "entrypoints.list",
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_READY" });

    indexStatePort.getStatus = vi.fn().mockResolvedValue({
      ...notReady,
      counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
      indexRunId: "run-5",
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      state: "idle" as const,
    });

    await expect(
      handler.handle({
        command: {
          target: {
            kind: "symbol",
            name: "missing",
            path: "src/main.ts",
            sourceType: "code",
          },
        },
        type: "impact.analyze",
      }),
    ).rejects.toMatchObject({ code: "ANCHOR_NOT_FOUND" });
  });

  it("routes Milestone 4.1 analysis requests through dedicated use cases", async () => {
    const indexStatePort = createIndexStatePort({
      getStatus: vi.fn().mockResolvedValue({
        activeProjectIdentity: "project-a",
        counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
        indexRunId: "run-4",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        pendingChanges: false,
        state: "idle",
        watcherState: "enabled",
      } satisfies StatusSnapshot),
    });
    const canonicalFactStore = createCanonicalFactStore();
    const canonicalFactList = vi.fn().mockResolvedValue([
      {
        confidence: 0.95,
        contentHash: "hash-1",
        evidenceId: "evidence-1",
        extractor: "artifact:repo-config",
        factId: "fact-1",
        fileFingerprint: "fp-1",
        indexRunId: "run-4",
        kind: "package_script",
        layer: "canonical",
        path: "package.json",
        payload: { command: "node dist/main.js", scriptName: "start" },
        sourceType: "code",
      },
    ]);
    canonicalFactStore.list = canonicalFactList;
    const derivedFactStore = createDerivedFactStore();
    const derivedFactList = vi.fn().mockResolvedValue([
      {
        confidence: 0.8,
        contentHash: "hash-2",
        derivedFactId: "derived-1",
        evidenceId: "evidence-2",
        extractor: "derived-fact",
        fileFingerprint: "fp-1",
        indexRunId: "run-4",
        kind: "caller-callee-candidate",
        layer: "derived",
        path: "src/main.ts",
        payload: {
          fromId: "symbol-main",
          fromLabel: "main",
          toId: "symbol-mcp",
          toLabel: "createMcpServer",
        },
        sourceType: "code",
      },
    ]);
    derivedFactStore.list = derivedFactList;

    const handler = createDaemonRequestHandler({
      canonicalFactStore,
      derivedFactStore,
      embedding: { embedChunks: vi.fn(), embedQuery: vi.fn() },
      indexStatePort,
      ingestionPipeline: { run: vi.fn() },
      internalGraphStore: createInternalGraphStore(),
      logger: createLogger(),
      retriever: { retrieve: vi.fn() },
      statusContext: createStatusContext(),
      symbolCandidateStore: createSymbolCandidateStore(),
    });

    const entrypoints = await handler.handle({
      command: { query: "start" },
      type: "entrypoints.list",
    });
    const flow = await handler.handle({
      command: {
        from: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
      },
      type: "flow.trace",
    });
    const impact = await handler.handle({
      command: {
        target: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
      },
      type: "impact.analyze",
    });
    const slice = await handler.handle({
      command: {
        criterion: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
      },
      type: "slice.compute",
    });

    expect(entrypoints.type).toBe("entrypoints.list");
    expect(flow.type).toBe("flow.trace");
    expect(impact.type).toBe("impact.analyze");
    expect(slice.type).toBe("slice.compute");
  });

  it("routes symbols.query to the symbol listing use case", async () => {
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
    const runtime = createDaemonRuntime({ watcherRuntime: { close } });

    await runtime.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
