import { describe, expect, it, vi } from "vitest";

import { GetSymbolUseCase } from "./get-symbol-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
import type { CanonicalFactStorePort } from "../ports/canonical-fact-store-port.js";
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

function createCanonicalFactStore(
  records: Awaited<ReturnType<CanonicalFactStorePort["list"]>> = [],
): CanonicalFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
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
  graph: Awaited<ReturnType<InternalGraphStorePort["readSnapshot"]>> = {
    edges: [],
    nodes: [],
  },
): InternalGraphStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    listByPath: vi.fn().mockResolvedValue(graph),
    listEdgesByNode: vi.fn().mockResolvedValue([]),
    listNodesByPath: vi.fn().mockResolvedValue([]),
    readSnapshot: vi.fn().mockResolvedValue(graph),
    replaceSnapshot: vi.fn(),
  };
}

describe("GetSymbolUseCase", () => {
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

  it("returns a resolved symbol payload for a unique exact-name match", async () => {
    const useCase = new GetSymbolUseCase(
      createIndexStatePort(readyStatus),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 2, startLine: 1 },
          contentHash: "hash-1",
          evidenceId: "evidence-1",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          sourceType: "code",
        },
        {
          codeLocation: { endLine: 6, startLine: 5 },
          contentHash: "hash-2",
          evidenceId: "evidence-2",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntryHelper",
          path: "main.ts",
          scope: "file",
          sourceType: "code",
        },
      ]),
      createCanonicalFactStore([
        {
          codeLocation: { endLine: 2, startLine: 1 },
          confidence: 1,
          contentHash: "hash-1",
          evidenceId: "evidence-1",
          extractor: "ast-grep:function_declaration",
          factId: "fact-1",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "symbol_definition",
          layer: "canonical",
          path: "main.ts",
          payload: { name: "mcpFixtureEntry", symbolCandidateId: "evidence-1" },
          sourceType: "code",
        },
      ]),
      createDerivedFactStore(),
      createInternalGraphStore(),
      context,
    );

    const result = await useCase.execute({
      path: " main.ts ",
      symbol: " mcpFixtureEntry ",
    });

    expect(result).toMatchObject({
      candidates: [
        {
          evidence: { path: "main.ts" },
          indexRunId: "run-1",
          name: "mcpFixtureEntry",
        },
      ],
      symbol: {
        evidence: { path: "main.ts" },
        indexRunId: "run-1",
        name: "mcpFixtureEntry",
      },
    });
  });

  it("returns an explicit ambiguity payload when exact-name matches are not unique", async () => {
    const useCase = new GetSymbolUseCase(
      createIndexStatePort(readyStatus),
      createSymbolCandidateStore([
        {
          codeLocation: { endLine: 2, startLine: 1 },
          contentHash: "hash-1",
          evidenceId: "evidence-1",
          extractor: "ast-grep:function_declaration",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          sourceType: "code",
        },
        {
          codeLocation: { endLine: 8, startLine: 7 },
          contentHash: "hash-2",
          evidenceId: "evidence-2",
          extractor: "ts-js:semantic",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          path: "main.ts",
          scope: "file",
          sourceType: "code",
        },
      ]),
      createCanonicalFactStore(),
      createDerivedFactStore(),
      createInternalGraphStore(),
      context,
    );

    await expect(
      useCase.execute({
        path: "main.ts",
        symbol: "mcpFixtureEntry",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.AMBIGUOUS_SYMBOL,
      details: {
        candidates: [
          { evidence: { evidenceId: "evidence-1" }, name: "mcpFixtureEntry" },
          { evidence: { evidenceId: "evidence-2" }, name: "mcpFixtureEntry" },
        ],
      },
    } satisfies Partial<LkgError>);
  });

  it("rejects blank path and symbol inputs", async () => {
    const useCase = new GetSymbolUseCase(
      createIndexStatePort(readyStatus),
      createSymbolCandidateStore(),
      createCanonicalFactStore(),
      createDerivedFactStore(),
      createInternalGraphStore(),
      context,
    );

    await expect(
      useCase.execute({ path: " ", symbol: "name" }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(
      useCase.execute({ path: "main.ts", symbol: " " }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });
});
