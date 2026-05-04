import { describe, expect, it, vi } from "vitest";

import { ListSymbolsUseCase } from "./list-symbols-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
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

function createSymbolCandidateStore(
  records: Awaited<ReturnType<SymbolCandidateStorePort["list"]>> = [],
): SymbolCandidateStorePort & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn().mockResolvedValue(records);

  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list,
    upsert: vi.fn(),
  };
}

describe("ListSymbolsUseCase", () => {
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

  it("rejects symbol queries when the index is not ready", async () => {
    const useCase = new ListSymbolsUseCase(
      createIndexStatePort(null),
      createSymbolCandidateStore(),
      context,
    );

    await expect(useCase.execute({ query: "fixture" })).rejects.toMatchObject({
      code: ERROR_CODES.INDEX_NOT_READY,
    } satisfies Partial<LkgError>);
  });

  it("filters by query and maps candidate-first symbol results", async () => {
    const store = createSymbolCandidateStore([
      {
        codeLocation: { endLine: 4, startLine: 1 },
        containerName: "exports",
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
        signature: "function mcpFixtureEntry()",
        sourceType: "code",
      },
      {
        codeLocation: { endLine: 8, startLine: 6 },
        contentHash: "hash-2",
        evidenceId: "evidence-2",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-1",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "otherSymbol",
        path: "main.ts",
        scope: "file",
        sourceType: "code",
      },
    ]);
    const useCase = new ListSymbolsUseCase(
      createIndexStatePort(readyStatus),
      store,
      context,
    );

    const result = await useCase.execute({
      path: "main.ts",
      query: "fixture",
      sourceType: "code",
    });

    expect(store.list).toHaveBeenCalledWith({
      kind: undefined,
      path: "main.ts",
      sourceType: "code",
    });
    expect(result).toEqual({
      results: [
        {
          confidence: 0.95,
          containerName: "exports",
          evidence: {
            codeLocation: { endLine: 4, startLine: 1 },
            contentHash: "hash-1",
            evidenceId: "evidence-1",
            extractor: "ast-grep:function_declaration",
            path: "main.ts",
          },
          indexRunId: "run-1",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: {
            exactNameMatch: false,
            exactPathMatch: true,
            kindMatch: false,
            score: 100.95,
          },
          scope: "file",
          signature: "function mcpFixtureEntry()",
          sourceType: "code",
        },
      ],
    });
  });

  it("rejects blank query path and kind filters", async () => {
    const useCase = new ListSymbolsUseCase(
      createIndexStatePort(readyStatus),
      createSymbolCandidateStore(),
      context,
    );

    await expect(useCase.execute({ query: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(useCase.execute({ path: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(useCase.execute({ kind: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });
});
