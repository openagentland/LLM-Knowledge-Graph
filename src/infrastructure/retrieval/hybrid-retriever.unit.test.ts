import { describe, expect, it, vi } from "vitest";

import type { RetrievedChunk } from "../../application/dto/retrieval.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";
import { HybridRetriever } from "../../infrastructure/retrieval/hybrid-retriever.js";

function createRetrievedChunk(
  overrides: Partial<RetrievedChunk> &
    Pick<
      RetrievedChunk,
      | "artifactKind"
      | "chunkKey"
      | "content"
      | "evidenceId"
      | "extractor"
      | "indexRunId"
      | "path"
      | "score"
      | "sourceType"
    >,
): RetrievedChunk {
  return {
    artifactKind: overrides.artifactKind,
    chunkKey: overrides.chunkKey,
    content: overrides.content,
    contentHash: overrides.contentHash ?? `${overrides.chunkKey}-hash`,
    evidenceId: overrides.evidenceId,
    extractor: overrides.extractor,
    indexRunId: overrides.indexRunId,
    path: overrides.path,
    score: overrides.score,
    sourceType: overrides.sourceType,
    codeLocation: overrides.codeLocation,
    docLocation: overrides.docLocation,
    partitionId: overrides.partitionId,
    partitionIndex: overrides.partitionIndex,
    partitionStatus: overrides.partitionStatus,
    partitionTotal: overrides.partitionTotal,
  };
}

describe("HybridRetriever", () => {
  it("delegates to vector-store search with the provided query embedding", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "code",
        chunkKey: "chunk-a",
        content: "totally unrelated words",
        evidenceId: "e1",
        extractor: "test",
        indexRunId: "run1",
        path: "b.ts",
        sourceType: "code",
        score: 0.9,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "alpha beta",
      queryEmbedding: [1, 0],
      topK: 5,
    });

    expect(embedQuery.mock.calls).toHaveLength(0);
    expect(searchByEmbedding).toHaveBeenNthCalledWith(1, [1, 0], 5);
    expect(results).toEqual([
      expect.objectContaining({
        chunkKey: "chunk-a",
        score: 0.9,
      }),
    ]);
  });

  it("embeds the query before searching when no query embedding is provided", async () => {
    const embedQuery = vi.fn().mockResolvedValue([0.1, 0.2]);
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "dependency graph",
      topK: 3,
    });

    expect(embedQuery).toHaveBeenNthCalledWith(1, "dependency graph");
    expect(searchByEmbedding).toHaveBeenNthCalledWith(1, [0.1, 0.2], 3);
    expect(results).toEqual([]);
  });

  it("stably reorders equal-score matches by chunk key", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "code",
        chunkKey: "chunk-b",
        content: "beta",
        evidenceId: "e2",
        extractor: "test",
        indexRunId: "run1",
        path: "b.ts",
        sourceType: "code",
        score: 0.8,
      }),
      createRetrievedChunk({
        artifactKind: "code",
        chunkKey: "chunk-a",
        content: "alpha",
        evidenceId: "e1",
        extractor: "test",
        indexRunId: "run1",
        path: "a.ts",
        sourceType: "code",
        score: 0.8,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);

    await expect(
      retriever.retrieve({
        query: "alpha beta",
        queryEmbedding: [1, 0],
        topK: 5,
      }),
    ).resolves.toMatchObject([
      { chunkKey: "chunk-a", score: 0.8 },
      { chunkKey: "chunk-b", score: 0.8 },
    ]);
    await expect(
      retriever.retrieve({
        query: "alpha beta",
        queryEmbedding: [1, 0],
        topK: 5,
      }),
    ).resolves.toMatchObject([
      { chunkKey: "chunk-a", score: 0.8 },
      { chunkKey: "chunk-b", score: 0.8 },
    ]);
  });

  it("prioritizes context artifacts over code when scores are tied", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "code",
        chunkKey: "chunk-code",
        content: "shared evidence implementation",
        evidenceId: "e-code",
        extractor: "test",
        indexRunId: "run1",
        path: "src/main.ts",
        sourceType: "code",
        score: 0.8,
      }),
      createRetrievedChunk({
        artifactKind: "workflow",
        chunkKey: "chunk-workflow",
        content: "shared evidence workflow",
        evidenceId: "e-workflow",
        extractor: "test",
        indexRunId: "run1",
        path: ".github/workflows/ci.yml",
        sourceType: "doc",
        score: 0.8,
      }),
      createRetrievedChunk({
        artifactKind: "doc",
        chunkKey: "chunk-doc",
        content: "shared evidence docs",
        evidenceId: "e-doc",
        extractor: "test",
        indexRunId: "run1",
        path: "README.md",
        sourceType: "doc",
        score: 0.8,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding: [1, 0],
      topK: 5,
    });

    expect(results.map((result) => result.artifactKind)).toEqual([
      "doc",
      "workflow",
      "code",
    ]);
  });

  it("keeps context ties deterministic by chunk key", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "workflow",
        chunkKey: "chunk-b",
        content: "workflow evidence",
        evidenceId: "e-workflow",
        extractor: "test",
        indexRunId: "run1",
        path: ".github/workflows/ci.yml",
        sourceType: "doc",
        score: 0.8,
      }),
      createRetrievedChunk({
        artifactKind: "doc",
        chunkKey: "chunk-a",
        content: "doc evidence",
        evidenceId: "e-doc",
        extractor: "test",
        indexRunId: "run1",
        path: "README.md",
        sourceType: "doc",
        score: 0.8,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding: [1, 0],
      topK: 5,
    });

    expect(results.map((result) => result.chunkKey)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
  });

  it("orders by score before context artifact priority", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "doc",
        chunkKey: "chunk-doc",
        content: "lower scoring docs",
        evidenceId: "e-doc",
        extractor: "test",
        indexRunId: "run1",
        path: "README.md",
        sourceType: "doc",
        score: 0.7,
      }),
      createRetrievedChunk({
        artifactKind: "code",
        chunkKey: "chunk-code",
        content: "higher scoring code",
        evidenceId: "e-code",
        extractor: "test",
        indexRunId: "run1",
        path: "src/main.ts",
        sourceType: "code",
        score: 0.9,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding: [1, 0],
      topK: 5,
    });

    expect(results.map((result) => result.chunkKey)).toEqual([
      "chunk-code",
      "chunk-doc",
    ]);
  });

  it("preserves retrieval mapping metadata after deterministic reordering", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn().mockResolvedValue([
      createRetrievedChunk({
        artifactKind: "doc",
        chunkKey: "chunk-b",
        content: "beta",
        docLocation: {
          offset: 2,
          section: "Beta",
        },
        evidenceId: "e-beta",
        extractor: "test",
        indexRunId: "run1",
        partitionId: "docs/a.md:1",
        partitionIndex: 1,
        partitionStatus: "partial",
        partitionTotal: 2,
        path: "docs/a.md",
        sourceType: "doc",
        score: 0.8,
      }),
      createRetrievedChunk({
        artifactKind: "doc",
        chunkKey: "chunk-a",
        content: "alpha",
        docLocation: {
          offset: 1,
          section: "Alpha",
        },
        evidenceId: "e-alpha",
        extractor: "test",
        indexRunId: "run1",
        partitionId: "docs/a.md:0",
        partitionIndex: 0,
        partitionStatus: "complete",
        partitionTotal: 2,
        path: "docs/a.md",
        sourceType: "doc",
        score: 0.8,
      }),
    ]);
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({
      query: "docs",
      queryEmbedding: [1, 0],
      topK: 5,
    });

    expect(results).toEqual([
      expect.objectContaining({
        chunkKey: "chunk-a",
        docLocation: {
          offset: 1,
          section: "Alpha",
        },
        partitionId: "docs/a.md:0",
        partitionIndex: 0,
        partitionStatus: "complete",
        partitionTotal: 2,
      }),
      expect.objectContaining({
        chunkKey: "chunk-b",
        docLocation: {
          offset: 2,
          section: "Beta",
        },
        partitionId: "docs/a.md:1",
        partitionIndex: 1,
        partitionStatus: "partial",
        partitionTotal: 2,
      }),
    ]);
  });

  it("returns an empty result without querying storage when topK is non-positive", async () => {
    const embedQuery = vi.fn();
    const embeddingPort: EmbeddingPort = {
      embedChunks: vi.fn(),
      embedQuery,
    };
    const searchByEmbedding = vi.fn();
    const vectorStorePort: VectorStorePort = {
      clear: vi.fn(),
      deleteByPath: vi.fn(),
      listRecords: vi.fn(),
      searchByEmbedding,
      upsert: vi.fn(),
    };

    const retriever = new HybridRetriever(embeddingPort, vectorStorePort);
    const results = await retriever.retrieve({ query: "search", topK: 0 });

    expect(results).toEqual([]);
    expect(embedQuery.mock.calls).toHaveLength(0);
    expect(searchByEmbedding).not.toHaveBeenCalled();
  });
});
