import { describe, expect, it, vi } from "vitest";

import { TraceFlowUseCase } from "./trace-flow-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
import type { PersistedInternalGraphRecord } from "../dto/structured-records.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { InternalGraphStorePort } from "../ports/internal-graph-store-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

function createIndexStatePort(
  status: Awaited<ReturnType<IndexStatePort["getStatus"]>>,
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

function createDerivedFactStore(
  records: Awaited<ReturnType<DerivedFactStorePort["list"]>> = [],
): DerivedFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
  };
}

function createInternalGraphStore(
  graph: PersistedInternalGraphRecord,
): InternalGraphStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    listByPath: vi.fn().mockResolvedValue(graph),
    listEdgesByNode: vi
      .fn()
      .mockImplementation((nodeId: string) =>
        Promise.resolve(
          graph.edges.filter(
            (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId,
          ),
        ),
      ),
    listNodesByPath: vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(graph.nodes.filter((node) => node.path === path)),
      ),
    read: vi.fn().mockResolvedValue(graph),
    replace: vi.fn(),
  };
}

function createSymbolCandidateStore(
  records: Awaited<ReturnType<SymbolCandidateStorePort["list"]>> = [],
): SymbolCandidateStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
  };
}

describe("TraceFlowUseCase", () => {
  const context = {
    activeProjectIdentity: "project-a",
    indexScope: "shared" as const,
  };

  const readyStatus = {
    activeProjectIdentity: "project-a",
    counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
    indexRunId: "run-1",
    indexScope: "shared" as const,
    lastError: null,
    lastIndexedAt: "2026-05-03T00:00:00.000Z",
    needsReindex: false,
    pendingChanges: false,
    state: "idle" as const,
    watcherState: "enabled" as const,
  };

  it("returns bounded multi-hop flow segments from graph-backed relations", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.8,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-main",
            fromKind: "symbol",
            fromLabel: "main",
            toId: "symbol-handler",
            toKind: "symbol",
            toLabel: "createMcpServer",
          },
          sourceType: "code",
        },
        {
          confidence: 0.7,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/server.ts",
          payload: {
            fromId: "symbol-handler",
            fromKind: "symbol",
            fromLabel: "createMcpServer",
            toId: "symbol-tool",
            toKind: "symbol",
            toLabel: "registerTool",
          },
          sourceType: "code",
        },
      ]),
      createInternalGraphStore({
        edges: [
          {
            confidence: 0.8,
            contentHash: "hash-1",
            edgeId: "edge-1",
            evidenceId: "evidence-1",
            extractor: "graph",
            fromNodeId: "symbol-main",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/main.ts",
            properties: {
              fromId: "symbol-main",
              fromKind: "symbol",
              fromLabel: "main",
              toId: "symbol-handler",
              toKind: "symbol",
              toLabel: "createMcpServer",
            },
            sourceType: "code",
            toNodeId: "symbol-handler",
          },
          {
            confidence: 0.7,
            contentHash: "hash-2",
            edgeId: "edge-2",
            evidenceId: "evidence-2",
            extractor: "graph",
            fromNodeId: "symbol-handler",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/server.ts",
            properties: {
              fromId: "symbol-handler",
              fromKind: "symbol",
              fromLabel: "createMcpServer",
              toId: "symbol-tool",
              toKind: "symbol",
              toLabel: "registerTool",
            },
            sourceType: "code",
            toNodeId: "symbol-tool",
          },
        ],
        nodes: [],
      }),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      from: {
        id: "symbol-main",
        kind: "symbol",
        name: "main",
        path: "src/main.ts",
        sourceType: "code",
      },
      maxDepth: 4,
      maxNodes: 10,
    });

    expect(result.traces[0]).toMatchObject({
      completeness: "partial",
      confidence: 0.7,
      precisionTier: "derived",
      start: { name: "main" },
    });
    expect(result.traces[0].segments).toHaveLength(2);
    expect(result.traces[0].segments.map((segment) => segment.to.name)).toEqual(
      ["createMcpServer", "registerTool"],
    );
  });

  it("sorts traversal steps deterministically by anchor then edge id", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.7,
          contentHash: "hash-z",
          derivedFactId: "derived-z",
          evidenceId: "evidence-z",
          extractor: "derived-fact",
          fileFingerprint: "fp-z",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/z.ts",
          payload: {
            fromId: "symbol-root",
            fromLabel: "root",
            toId: "symbol-zeta",
            toLabel: "zeta",
          },
          sourceType: "code",
        },
        {
          confidence: 0.7,
          contentHash: "hash-a2",
          derivedFactId: "derived-a2",
          evidenceId: "evidence-a2",
          extractor: "derived-fact",
          fileFingerprint: "fp-a2",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/alpha-two.ts",
          payload: {
            fromId: "symbol-root",
            fromLabel: "root",
            toId: "symbol-alpha-2",
            toLabel: "alpha",
          },
          sourceType: "code",
        },
        {
          confidence: 0.7,
          contentHash: "hash-a1",
          derivedFactId: "derived-a1",
          evidenceId: "evidence-a1",
          extractor: "derived-fact",
          fileFingerprint: "fp-a1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/alpha-one.ts",
          payload: {
            fromId: "symbol-root",
            fromLabel: "root",
            toId: "symbol-alpha-1",
            toLabel: "alpha",
          },
          sourceType: "code",
        },
      ]),
      createInternalGraphStore({
        edges: [
          {
            confidence: 0.7,
            contentHash: "hash-z",
            edgeId: "edge-z",
            evidenceId: "evidence-z",
            extractor: "graph",
            fromNodeId: "symbol-root",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/z.ts",
            properties: {
              fromId: "symbol-root",
              fromLabel: "root",
              toId: "symbol-zeta",
              toLabel: "zeta",
            },
            sourceType: "code",
            toNodeId: "symbol-zeta",
          },
          {
            confidence: 0.7,
            contentHash: "hash-a2",
            edgeId: "edge-b",
            evidenceId: "evidence-a2",
            extractor: "graph",
            fromNodeId: "symbol-root",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/alpha-two.ts",
            properties: {
              fromId: "symbol-root",
              fromLabel: "root",
              toId: "symbol-alpha-2",
              toLabel: "alpha",
            },
            sourceType: "code",
            toNodeId: "symbol-alpha-2",
          },
          {
            confidence: 0.7,
            contentHash: "hash-a1",
            edgeId: "edge-a",
            evidenceId: "evidence-a1",
            extractor: "graph",
            fromNodeId: "symbol-root",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/alpha-one.ts",
            properties: {
              fromId: "symbol-root",
              fromLabel: "root",
              toId: "symbol-alpha-1",
              toLabel: "alpha",
            },
            sourceType: "code",
            toNodeId: "symbol-alpha-1",
          },
        ],
        nodes: [],
      }),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      from: {
        id: "symbol-root",
        kind: "symbol",
        name: "root",
        path: "src/root.ts",
        sourceType: "code",
      },
      maxDepth: 4,
      maxNodes: 10,
    });

    expect(
      result.traces[0]?.segments.map(
        (segment) => `${segment.to.name}:${segment.to.id}`,
      ),
    ).toEqual([
      "alpha:symbol-alpha-1",
      "alpha:symbol-alpha-2",
      "zeta:symbol-zeta",
    ]);
  });

  it("resolves symbol anchors without ids through candidate-first lookup", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.9,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "main.ts",
          payload: {
            fromId: "evidence-main",
            fromKind: "symbol",
            fromLabel: "mcpFixtureEntry",
            toId: "symbol-helper",
            toKind: "symbol",
            toLabel: "helper",
          },
          sourceType: "code",
        },
      ]),
      createInternalGraphStore({
        edges: [
          {
            confidence: 0.9,
            contentHash: "hash-1",
            edgeId: "edge-1",
            evidenceId: "evidence-1",
            extractor: "graph",
            fromNodeId: "evidence-main",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "main.ts",
            properties: {
              fromId: "evidence-main",
              fromKind: "symbol",
              fromLabel: "mcpFixtureEntry",
              toId: "symbol-helper",
              toKind: "symbol",
              toLabel: "helper",
            },
            sourceType: "code",
            toNodeId: "symbol-helper",
          },
        ],
        nodes: [],
      }),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 3, startLine: 1 },
          containerName: "exports",
          contentHash: "hash-main",
          evidenceId: "evidence-main",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-main",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          signature: "function mcpFixtureEntry()",
          sourceType: "code",
        },
      ]),
      context,
    );

    const result = await useCase.execute({
      from: {
        kind: "symbol",
        name: "mcpFixtureEntry",
        path: "main.ts",
        sourceType: "code",
      },
    });

    expect(result.traces[0]?.start.id).toBe("evidence-main");
    expect(result.traces[0]?.segments[0]?.from.id).toBe("evidence-main");
  });

  it("maps reverse graph matches to the opposite endpoint", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.8,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-caller",
            fromKind: "symbol",
            fromLabel: "caller",
            toId: "symbol-target",
            toKind: "symbol",
            toLabel: "target",
          },
          sourceType: "code",
        },
      ]),
      createInternalGraphStore({
        edges: [
          {
            confidence: 0.8,
            contentHash: "hash-1",
            edgeId: "edge-1",
            evidenceId: "evidence-1",
            extractor: "graph",
            fromNodeId: "symbol-caller",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/main.ts",
            properties: {
              fromId: "symbol-caller",
              fromKind: "symbol",
              fromLabel: "caller",
              toId: "symbol-target",
              toKind: "symbol",
              toLabel: "target",
            },
            sourceType: "code",
            toNodeId: "symbol-target",
          },
        ],
        nodes: [],
      }),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      direction: "backward",
      from: {
        id: "symbol-target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
    });

    expect(result.traces[0]?.segments[0]?.to).toMatchObject({
      id: "symbol-caller",
      name: "caller",
    });
  });

  it("stops at the requested target and marks the trace complete", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.8,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-main",
            fromLabel: "main",
            toId: "symbol-target",
            toLabel: "target",
          },
          sourceType: "code",
        },
      ]),
      createInternalGraphStore({
        edges: [
          {
            confidence: 0.8,
            contentHash: "hash-1",
            edgeId: "edge-1",
            evidenceId: "evidence-1",
            extractor: "graph",
            fromNodeId: "symbol-main",
            indexRunId: "run-1",
            kind: "caller-callee-candidate",
            layer: "graph",
            path: "src/main.ts",
            properties: {
              fromId: "symbol-main",
              fromLabel: "main",
              toId: "symbol-target",
              toLabel: "target",
            },
            sourceType: "code",
            toNodeId: "symbol-target",
          },
        ],
        nodes: [],
      }),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      from: {
        id: "symbol-main",
        kind: "symbol",
        name: "main",
        path: "src/main.ts",
        sourceType: "code",
      },
      to: {
        id: "symbol-target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
    });

    expect(result.traces[0]).toMatchObject({
      completeness: "complete",
      end: { id: "symbol-target", name: "target" },
    });
  });

  it("reports unsupported includes and bounded no-match semantics", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createInternalGraphStore({ edges: [], nodes: [] }),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      from: {
        id: "symbol-main",
        kind: "symbol",
        name: "main",
        path: "src/main.ts",
        sourceType: "code",
      },
      include: ["control", "data"],
    });

    expect(result.traces[0]?.completeness).toBe("partial");
    expect(result.limitations?.map((item) => item.kind)).toEqual([
      "unsupported-include",
      "no-match",
    ]);
  });

  it("rejects missing from anchors", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createInternalGraphStore({ edges: [], nodes: [] }),
      createSymbolCandidateStore(),
      context,
    );

    await expect(useCase.execute({})).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });

  it("rejects invalid budget values", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createInternalGraphStore({ edges: [], nodes: [] }),
      createSymbolCandidateStore(),
      context,
    );

    await expect(
      useCase.execute({
        from: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
        maxDepth: 0,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(
      useCase.execute({
        from: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
        maxNodes: 0,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(
      useCase.execute({
        from: {
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
        timeBudgetMs: 0,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });

  it("rejects ambiguous symbol anchors", async () => {
    const useCase = new TraceFlowUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createInternalGraphStore({ edges: [], nodes: [] }),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 3, startLine: 1 },
          contentHash: "hash-a",
          evidenceId: "evidence-a",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-a",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          signature: "function mcpFixtureEntry()",
          sourceType: "code",
        },
        {
          codeLocation: { endLine: 8, startLine: 6 },
          contentHash: "hash-b",
          evidenceId: "evidence-b",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-b",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          signature: "function mcpFixtureEntry()",
          sourceType: "code",
        },
      ]),
      context,
    );

    await expect(
      useCase.execute({
        from: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          sourceType: "code",
        },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.AMBIGUOUS_ANCHOR,
    } satisfies Partial<LkgError>);
  });
});
