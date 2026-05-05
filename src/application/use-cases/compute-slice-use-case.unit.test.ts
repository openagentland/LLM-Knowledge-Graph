import { describe, expect, it, vi } from "vitest";

import { ComputeSliceUseCase } from "./compute-slice-use-case.js";
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

describe("ComputeSliceUseCase", () => {
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

  it("returns slice items with inclusion reasons", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "symbol-references-symbol-candidate",
          layer: "derived",
          path: "src/application/use-cases/get-symbol-use-case.ts",
          payload: {
            fromId: "symbol-root",
            toId: "symbol-ref",
            toLabel: "ListSymbolsUseCase",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      criterion: {
        id: "symbol-root",
        kind: "symbol",
        name: "GetSymbolUseCase",
        path: "src/application/use-cases/get-symbol-use-case.ts",
        sourceType: "code",
      },
    });

    expect(result.items[0]).toMatchObject({
      inclusionReason:
        "Included via relation symbol-references-symbol-candidate",
      precisionTier: "derived",
    });
    expect(result.completeness).toBe("partial");
  });

  it("maps reverse matches to the opposite slice anchor and relation path endpoint", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "symbol-references-symbol-candidate",
          layer: "derived",
          path: "src/application/use-cases/get-symbol-use-case.ts",
          payload: {
            fromId: "symbol-root",
            fromLabel: "GetSymbolUseCase",
            toId: "symbol-ref",
            toLabel: "ListSymbolsUseCase",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      criterion: {
        id: "symbol-ref",
        kind: "symbol",
        name: "ListSymbolsUseCase",
        path: "src/application/use-cases/get-symbol-use-case.ts",
        sourceType: "code",
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.anchor).toMatchObject({
      id: "symbol-root",
      name: "GetSymbolUseCase",
    });
    expect(result.items[0]?.relationPath).toHaveLength(1);
    expect(result.items[0]?.relationPath[0]).toMatchObject({
      from: { id: "symbol-ref", name: "ListSymbolsUseCase" },
      to: { id: "symbol-root", name: "GetSymbolUseCase" },
    });
  });

  it("does not silently return empty slice results for schema-valid partial anchors", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "symbol-references-symbol-candidate",
          layer: "derived",
          path: "src/application/use-cases/get-symbol-use-case.ts",
          payload: {
            fromId: "symbol-root",
            toId: "symbol-ref",
            toLabel: "ListSymbolsUseCase",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 3, startLine: 1 },
          contentHash: "hash-root",
          evidenceId: "symbol-root",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-root",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "GetSymbolUseCase",
          path: "src/application/use-cases/get-symbol-use-case.ts",
          scope: "file",
          signature: "function GetSymbolUseCase()",
          sourceType: "code",
        },
      ]),
      context,
    );

    const result = await useCase.execute({
      criterion: {
        kind: "symbol",
        name: "GetSymbolUseCase",
        path: "src/application/use-cases/get-symbol-use-case.ts",
        sourceType: "code",
      },
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  it("filters forward direction to outgoing relations only", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
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
            fromId: "target",
            fromLabel: "target",
            toId: "callee-a",
            toLabel: "calleeA",
          },
          sourceType: "code",
        },
        {
          confidence: 0.77,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
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
      criterion: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
      direction: "forward",
      include: ["calls"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.anchor.id).toBe("callee-a");
  });

  it("applies file and node budgets deterministically", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "file-imports-file",
          layer: "derived",
          path: "src/a.ts",
          payload: {
            fromId: "file:src/root.ts",
            fromKind: "file",
            fromLabel: "src/root.ts",
            toId: "file:src/a.ts",
            toKind: "file",
            toLabel: "src/a.ts",
          },
          sourceType: "code",
        },
        {
          confidence: 0.77,
          contentHash: "hash-2",
          derivedFactId: "derived-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "file-imports-file",
          layer: "derived",
          path: "src/b.ts",
          payload: {
            fromId: "file:src/root.ts",
            fromKind: "file",
            fromLabel: "src/root.ts",
            toId: "file:src/b.ts",
            toKind: "file",
            toLabel: "src/b.ts",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      criterion: {
        id: "file:src/root.ts",
        kind: "file",
        name: "src/root.ts",
        path: "src/root.ts",
        sourceType: "code",
      },
      include: ["imports"],
      maxFiles: 1,
      maxNodes: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.completeness).toBe("truncated");
  });

  it("treats unsupported control and data includes as bounded no-match coverage", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
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
            fromId: "target",
            fromLabel: "target",
            toId: "callee-a",
            toLabel: "calleeA",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      criterion: {
        id: "target",
        kind: "symbol",
        name: "target",
        path: "src/main.ts",
        sourceType: "code",
      },
      include: ["control", "data"],
    });

    expect(result.items).toEqual([]);
    expect(result.limitations?.[0]?.kind).toBe("no-match");
  });

  it("reports bounded no-match limitations when filters exclude all relations", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore([
        {
          confidence: 0.77,
          contentHash: "hash-1",
          derivedFactId: "derived-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact",
          fileFingerprint: "fp-1",
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
      criterion: {
        id: "task:test",
        kind: "task",
        name: "test",
        path: "package.json",
        sourceType: "code",
      },
      include: ["calls"],
    });

    expect(result.items).toEqual([]);
    expect(result.limitations?.[0]?.kind).toBe("no-match");
  });

  it("rejects blank criteria", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(
      useCase.execute({
        criterion: {
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

  it("rejects invalid slice budgets", async () => {
    const useCase = new ComputeSliceUseCase(
      createIndexStatePort(readyStatus),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(
      useCase.execute({
        criterion: {
          id: "target",
          kind: "symbol",
          name: "target",
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
        criterion: {
          id: "target",
          kind: "symbol",
          name: "target",
          path: "src/main.ts",
          sourceType: "code",
        },
        maxEvidence: 0,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(
      useCase.execute({
        criterion: {
          id: "target",
          kind: "symbol",
          name: "target",
          path: "src/main.ts",
          sourceType: "code",
        },
        maxFiles: 0,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });
});
