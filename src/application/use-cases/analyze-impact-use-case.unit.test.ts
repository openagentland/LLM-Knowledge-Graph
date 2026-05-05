import { describe, expect, it, vi } from "vitest";

import { AnalyzeImpactUseCase } from "./analyze-impact-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
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

describe("AnalyzeImpactUseCase", () => {
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

  it("returns impact candidates with propagation reasons", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "symbol-mcp",
            toId: "symbol-daemon",
            toLabel: "createDaemonRequestHandler",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      target: {
        id: "symbol-mcp",
        kind: "symbol",
        name: "createMcpServer",
        path: "src/presentation/mcp-server.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts[0]).toMatchObject({
      classification: "direct",
      kind: "symbol",
      precisionTier: "derived",
    });
    expect(result.impacts[0].reasons[0].detail).toContain(
      "caller-callee-candidate",
    );
  });

  it("maps reverse matches to the opposite impacted anchor", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "symbol-mcp",
            fromLabel: "createMcpServer",
            toId: "symbol-daemon",
            toLabel: "createDaemonRequestHandler",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      target: {
        id: "symbol-daemon",
        kind: "symbol",
        name: "createDaemonRequestHandler",
        path: "src/presentation/mcp-server.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.anchor).toMatchObject({
      id: "symbol-mcp",
      name: "createMcpServer",
    });
    expect(result.impacts[0]?.paths[0]?.segments[0]).toMatchObject({
      from: { id: "symbol-daemon", name: "createDaemonRequestHandler" },
      to: { id: "symbol-mcp", name: "createMcpServer" },
    });
  });

  it("does not silently return empty results for schema-valid partial anchors", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "symbol-mcp",
            toId: "symbol-daemon",
            toLabel: "createDaemonRequestHandler",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 3, startLine: 1 },
          contentHash: "hash-main",
          evidenceId: "symbol-mcp",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-main",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "createMcpServer",
          path: "src/presentation/mcp-server.ts",
          scope: "file",
          signature: "function createMcpServer()",
          sourceType: "code",
        },
      ]),
      context,
    );

    const result = await useCase.execute({
      target: {
        kind: "symbol",
        name: "createMcpServer",
        path: "src/presentation/mcp-server.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts.length).toBeGreaterThan(0);
  });

  it("filters caller mode to reverse call edges only", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "caller-a",
            fromLabel: "callerA",
            toId: "target",
            toLabel: "target",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee-b",
            toLabel: "calleeB",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      mode: "callers",
      target: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/presentation/mcp-server.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.anchor.id).toBe("caller-a");
  });

  it("filters callees mode to outgoing call edges only", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee-a",
            toLabel: "calleeA",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/presentation/mcp-server.ts",
          payload: {
            fromId: "caller-b",
            fromLabel: "callerB",
            toId: "target",
            toLabel: "target",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      mode: "callees",
      target: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/presentation/mcp-server.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.anchor.id).toBe("callee-a");
  });

  it("filters dependents mode to reference and import relations", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-ref",
          derivedFactId: "derived-ref",
          evidenceId: "evidence-ref",
          extractor: "derived-fact",
          fileFingerprint: "fp-ref",
          indexRunId: "run-1",
          kind: "symbol-references-symbol-candidate",
          layer: "derived",
          path: "src/ref.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "symbol-ref",
            toLabel: "consumerRef",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-import",
          derivedFactId: "derived-import",
          evidenceId: "evidence-import",
          extractor: "derived-fact",
          fileFingerprint: "fp-import",
          indexRunId: "run-1",
          kind: "file-imports-file",
          layer: "derived",
          path: "src/importer.ts",
          payload: {
            fromId: "target",
            fromKind: "file",
            fromLabel: "src/target.ts",
            toId: "file:src/importer.ts",
            toKind: "file",
            toLabel: "src/importer.ts",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-call",
          derivedFactId: "derived-call",
          evidenceId: "evidence-call",
          extractor: "derived-fact",
          fileFingerprint: "fp-call",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/call.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee",
            toLabel: "callee",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      mode: "dependents",
      target: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/target.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(2);
    expect(result.impacts.map((impact) => impact.kind)).toEqual([
      "symbol",
      "file",
    ]);
  });

  it("filters runtime mode to forward runtime relations", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-workflow",
          derivedFactId: "derived-workflow",
          evidenceId: "evidence-workflow",
          extractor: "derived-fact",
          fileFingerprint: "fp-workflow",
          indexRunId: "run-1",
          kind: "workflow-runs-package-script-candidate",
          layer: "derived",
          path: ".github/workflows/ci.yml",
          payload: {
            fromId: "task:start",
            fromKind: "task",
            fromLabel: "start",
            toId: "workflow:ci",
            toKind: "workflow",
            toLabel: "ci",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-entrypoint",
          derivedFactId: "derived-entrypoint",
          evidenceId: "evidence-entrypoint",
          extractor: "derived-fact",
          fileFingerprint: "fp-entrypoint",
          indexRunId: "run-1",
          kind: "file-declares-entrypoint-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "task:start",
            fromKind: "task",
            fromLabel: "start",
            toId: "entrypoint:main",
            toKind: "entrypoint",
            toLabel: "main entry",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-test",
          derivedFactId: "derived-test",
          evidenceId: "evidence-test",
          extractor: "derived-fact",
          fileFingerprint: "fp-test",
          indexRunId: "run-1",
          kind: "quality-gate-runs-script-candidate",
          layer: "derived",
          path: ".github/workflows/test.yml",
          payload: {
            fromId: "task:start",
            fromKind: "task",
            fromLabel: "start",
            toId: "quality-gate:unit",
            toKind: "quality_gate",
            toLabel: "unit",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      mode: "runtime",
      target: {
        id: "task:start",
        kind: "task",
        name: "start",
        path: "package.json",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(2);
    expect(result.impacts.map((impact) => impact.kind)).toEqual([
      "workflow",
      "entrypoint",
    ]);
    expect(result.impacts.map((impact) => impact.precisionTier)).toEqual([
      "possible",
      "possible",
    ]);
  });

  it("filters tests mode to quality-gate relations", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.88,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "quality-gate-runs-script-candidate",
          layer: "derived",
          path: ".github/workflows/test.yml",
          payload: {
            fromId: "quality-gate:unit",
            fromKind: "quality_gate",
            fromLabel: "unit",
            toId: "task:test",
            toKind: "task",
            toLabel: "test",
          },
          sourceType: "code",
        },
        {
          confidence: 0.88,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "task-runs-command",
          layer: "derived",
          path: "package.json",
          payload: {
            fromId: "task:test",
            fromKind: "task",
            fromLabel: "test",
            toId: "command:npm-test",
            toLabel: "npm test",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      mode: "tests",
      target: {
        id: "quality-gate:unit",
        kind: "quality_gate",
        name: "unit",
        path: ".github/workflows/test.yml",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.kind).toBe("test");
    expect(result.impacts[0]?.classification).toBe("possible");
    expect(result.impacts[0]?.precisionTier).toBe("possible");
  });

  it("applies confidence and result budgets deterministically", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.9,
          contentHash: "hash-b",
          derivedFactId: "derived-b",
          evidenceId: "evidence-b",
          extractor: "derived-fact",
          fileFingerprint: "fp-b",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/b.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee-b",
            toLabel: "calleeB",
          },
          sourceType: "code",
        },
        {
          confidence: 0.96,
          contentHash: "hash-a",
          derivedFactId: "derived-a",
          evidenceId: "evidence-a",
          extractor: "derived-fact",
          fileFingerprint: "fp-a",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/a.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee-a",
            toLabel: "calleeA",
          },
          sourceType: "code",
        },
        {
          confidence: 0.7,
          contentHash: "hash-low",
          derivedFactId: "derived-low",
          evidenceId: "evidence-low",
          extractor: "derived-fact",
          fileFingerprint: "fp-low",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/low.ts",
          payload: {
            fromId: "target",
            fromLabel: "target",
            toId: "callee-low",
            toLabel: "calleeLow",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      confidenceMin: 0.8,
      maxResults: 1,
      target: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.anchor.id).toBe("callee-b");
    expect(result.summary.truncated).toBe(true);
  });

  it("reports bounded no-match limitations instead of implying safety", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      target: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
    });

    expect(result.impacts).toEqual([]);
    expect(result.limitations?.[0]?.kind).toBe("no-match");
    expect(result.limitations?.[0]?.detail).toContain(
      "bounded derived-relation analysis",
    );
  });

  it("rejects blank targets", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(
      useCase.execute({
        target: {
          kind: "symbol",
          name: " ",
          path: "src/main.ts",
          sourceType: "code",
        },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });

  it("rejects invalid confidence and result budgets", async () => {
    const useCase = new AnalyzeImpactUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(
      useCase.execute({
        confidenceMin: -0.1,
        target: {
          id: "target",
          kind: "symbol",
          name: "target",
          path: "src/main.ts",
          sourceType: "code",
        },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(
      useCase.execute({
        maxResults: 0,
        target: {
          id: "target",
          kind: "symbol",
          name: "target",
          path: "src/main.ts",
          sourceType: "code",
        },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });
});
