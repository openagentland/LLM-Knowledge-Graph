import { describe, expect, it, vi } from "vitest";

import type { RetrievedChunk } from "../../application/dto/retrieval.js";
import type { PersistedChunkRecord } from "../../application/dto/storage.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";
import { HybridRetriever } from "../../infrastructure/retrieval/hybrid-retriever.js";

function createRecord(
  overrides: Partial<PersistedChunkRecord> &
    Pick<
      PersistedChunkRecord,
      | "chunkKey"
      | "content"
      | "embedding"
      | "evidenceId"
      | "extractor"
      | "fileFingerprint"
      | "indexRunId"
      | "path"
      | "sourceType"
    >,
): PersistedChunkRecord {
  return {
    chunkKey: overrides.chunkKey,
    content: overrides.content,
    contentHash: overrides.contentHash ?? `${overrides.chunkKey}-hash`,
    embedding: overrides.embedding,
    evidenceId: overrides.evidenceId,
    extractor: overrides.extractor,
    fileFingerprint: overrides.fileFingerprint,
    indexRunId: overrides.indexRunId,
    path: overrides.path,
    sourceType: overrides.sourceType,
    codeLocation: overrides.codeLocation,
    docLocation: overrides.docLocation,
  };
}

function createRetrievedChunk(
  overrides: Partial<RetrievedChunk> &
    Pick<
      RetrievedChunk,
      | "chunkKey"
      | "content"
      | "embedding"
      | "evidenceId"
      | "extractor"
      | "fileFingerprint"
      | "indexRunId"
      | "path"
      | "sourceType"
      | "score"
    >,
): RetrievedChunk {
  return {
    ...createRecord(overrides),
    score: overrides.score,
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
        chunkKey: "chunk-a",
        content: "totally unrelated words",
        embedding: [1, 0],
        evidenceId: "e1",
        extractor: "test",
        fileFingerprint: "fp1",
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
        chunkKey: "chunk-b",
        content: "beta",
        embedding: [1, 0],
        evidenceId: "e2",
        extractor: "test",
        fileFingerprint: "fp2",
        indexRunId: "run1",
        path: "b.ts",
        sourceType: "code",
        score: 0.8,
      }),
      createRetrievedChunk({
        chunkKey: "chunk-a",
        content: "alpha",
        embedding: [1, 0],
        evidenceId: "e1",
        extractor: "test",
        fileFingerprint: "fp1",
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
