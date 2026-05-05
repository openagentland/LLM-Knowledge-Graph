import { describe, expect, it, vi } from "vitest";

import { SearchKnowledgeUseCase } from "./search-knowledge-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
import type { EmbeddingPort } from "../ports/embedding-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { RetrieverPort } from "../ports/retriever-port.js";

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

function createEmbeddingPort(): EmbeddingPort & {
  embedChunks: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
} {
  const embedChunks = vi.fn();
  const embedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

  return {
    embedChunks,
    embedQuery,
  };
}

function createRetrieverPort(): RetrieverPort & {
  retrieve: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn().mockResolvedValue([]);

  return {
    retrieve,
  };
}

describe("SearchKnowledgeUseCase", () => {
  const context = {
    activeProjectIdentity: "project-a",
    indexScope: "shared" as const,
  };

  it("rejects search when the index is not ready", async () => {
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort(null),
      createEmbeddingPort(),
      createRetrieverPort(),
      context,
    );

    await expect(
      useCase.execute({ query: "dependency graph" }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INDEX_NOT_READY,
    } satisfies Partial<LkgError>);
  });

  it("trims the query, defaults topK, and returns bounded evidence snippets", async () => {
    const embeddingPort = createEmbeddingPort();
    const retrieve = vi.fn().mockResolvedValue([
      {
        artifactKind: "code",
        chunkKey: "chunk-1",
        content: `${"a".repeat(550)}tail`,
        contentHash: "hash-1",
        embedding: [0.1],
        evidenceId: "evidence-1",
        extractor: "parser",
        fileFingerprint: "fingerprint-1",
        indexRunId: "run-1",
        path: "src/a.ts",
        sourceType: "code",
        codeLocation: {
          startLine: 10,
          endLine: 20,
        },
      },
    ]);
    const retrieverPort: RetrieverPort = { retrieve };
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        state: "idle",
        watcherState: "enabled",
      }),
      embeddingPort,
      retrieverPort,
      context,
    );

    const result = await useCase.execute({ query: "  dependency graph  " });

    expect(embeddingPort.embedQuery).toHaveBeenNthCalledWith(
      1,
      "dependency graph",
    );
    expect(retrieve).toHaveBeenNthCalledWith(1, {
      query: "dependency graph",
      queryEmbedding: [0.1, 0.2, 0.3],
      topK: 10,
    });
    expect(result).toEqual({
      results: [
        {
          artifactKind: "code",
          codeLocation: {
            endLine: 20,
            startLine: 10,
          },
          evidenceId: "evidence-1",
          path: "src/a.ts",
          provenance: {
            contentHash: "hash-1",
            extractor: "parser",
            indexRunId: "run-1",
          },
          score: undefined,
          snippet: `${"a".repeat(500)}`,
          sourceType: "code",
        },
      ],
    });
  });

  it("caps topK at 50", async () => {
    const retrieve = vi.fn().mockResolvedValue([]);
    const retrieverPort: RetrieverPort = { retrieve };
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        state: "idle",
        watcherState: "enabled",
      }),
      createEmbeddingPort(),
      retrieverPort,
      context,
    );

    const result = await useCase.execute({ query: "search", topK: 999 });

    expect(result.results).toEqual([]);
    expect(retrieve).toHaveBeenNthCalledWith(1, {
      query: "search",
      queryEmbedding: [0.1, 0.2, 0.3],
      topK: 50,
    });
  });

  it("rejects blank queries", async () => {
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        state: "idle",
        watcherState: "enabled",
      }),
      createEmbeddingPort(),
      createRetrieverPort(),
      context,
    );

    await expect(useCase.execute({ query: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });

  it("rejects code evidence without code location", async () => {
    const retrieverPort: RetrieverPort = {
      retrieve: vi.fn().mockResolvedValue([
        {
          artifactKind: "code",
          chunkKey: "chunk-1",
          content: "export const a = 1;",
          contentHash: "hash-1",
          embedding: [0.1],
          evidenceId: "evidence-1",
          extractor: "parser",
          fileFingerprint: "fingerprint-1",
          indexRunId: "run-1",
          path: "src/a.ts",
          sourceType: "code",
        },
      ]),
    };
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        state: "idle",
        watcherState: "enabled",
      }),
      createEmbeddingPort(),
      retrieverPort,
      context,
    );

    await expect(useCase.execute({ query: "search" })).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    } satisfies Partial<LkgError>);
  });

  it("rejects doc evidence without doc location", async () => {
    const retrieverPort: RetrieverPort = {
      retrieve: vi.fn().mockResolvedValue([
        {
          artifactKind: "doc",
          chunkKey: "chunk-1",
          content: "Architecture overview",
          contentHash: "hash-1",
          embedding: [0.1],
          evidenceId: "evidence-1",
          extractor: "parser",
          fileFingerprint: "fingerprint-1",
          indexRunId: "run-1",
          path: "docs/a.md",
          sourceType: "doc",
        },
      ]),
    };
    const useCase = new SearchKnowledgeUseCase(
      createIndexStatePort({
        activeProjectIdentity: "project-a",
        counters: {
          errors: 0,
          filesIndexed: 1,
          filesTotal: 1,
        },
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-03T00:00:00.000Z",
        needsReindex: false,
        state: "idle",
        watcherState: "enabled",
      }),
      createEmbeddingPort(),
      retrieverPort,
      context,
    );

    await expect(useCase.execute({ query: "search" })).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    } satisfies Partial<LkgError>);
  });
});
