import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { IndexStatePort } from "../../src/application/ports/index-state-port.js";
import { SearchKnowledgeUseCase } from "../../src/application/use-cases/search-knowledge-use-case.js";
import { HybridRetriever } from "../../src/infrastructure/retrieval/hybrid-retriever.js";
import { DeterministicEmbedding } from "../helpers/deterministic-embedding.js";
import {
  createIntegrationPipeline,
  createTempHomeDir,
  createVectorStore,
  TEST_SCOPE,
} from "../helpers/integration-runtime.js";
import { materializeFixtureProject } from "../helpers/materialize-fixture-project.js";

function createNotReadyStatePort(): IndexStatePort {
  const notUsed = (): never => {
    throw new Error("not used");
  };

  return {
    getRecord: () => Promise.resolve(null),
    getStatus: () => Promise.resolve(null),
    markCompleted: () => Promise.resolve(notUsed()),
    markFailed: () => Promise.resolve(notUsed()),
    markRunning: () => Promise.resolve(notUsed()),
    markWatcherFailed: () => Promise.resolve(notUsed()),
    markWatcherPending: () => Promise.resolve(notUsed()),
    saveProgress: () => Promise.resolve(notUsed()),
    saveStatusSnapshot: () => Promise.resolve(notUsed()),
  };
}

describe("Search knowledge integration", () => {
  it("blocks search when the index is not ready", async () => {
    const homeDir = await createTempHomeDir("lkg-search-state-");
    const embedding = new DeterministicEmbedding();
    const retriever = new HybridRetriever(
      embedding,
      createVectorStore(homeDir),
    );
    const useCase = new SearchKnowledgeUseCase(
      createNotReadyStatePort(),
      embedding,
      retriever,
      TEST_SCOPE,
    );

    await expect(
      useCase.execute({ query: "architecture" }),
    ).rejects.toMatchObject({
      code: "INDEX_NOT_READY",
    });
  });

  it("returns stable code and doc evidence with provenance after indexing", async () => {
    const cwd = await materializeFixtureProject("ingestion-basic");
    const homeDir = await createTempHomeDir("lkg-search-state-");
    await writeFile(
      join(cwd, "README.md"),
      "# Search Docs\n\nHybrid retrieval keeps evidence provenance\n\n## API\n\nSearch supports code and docs.\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "main.ts"),
      "export function searchEntry() {\n  return 'hybrid retrieval evidence';\n}\n",
      "utf8",
    );

    const pipeline = createIntegrationPipeline(cwd, homeDir);
    const first = await pipeline.run({ indexRunId: "run-1", mode: "full" });
    const second = await pipeline.run({ indexRunId: "run-2", mode: "full" });

    const embedding = new DeterministicEmbedding();
    const retriever = new HybridRetriever(
      embedding,
      createVectorStore(homeDir),
    );
    const queryEmbedding = await embedding.embedQuery(
      "hybrid retrieval evidence",
    );
    const results = await retriever.retrieve({
      query: "hybrid retrieval evidence",
      queryEmbedding,
      topK: 10,
    });

    const codeResult = results.find((result) => result.sourceType === "code");
    const docResult = results.find((result) => result.sourceType === "doc");

    expect(first.chunksWritten).toBeGreaterThan(0);
    expect(second.chunksWritten).toBe(0);
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results.map((result) => result.chunkKey)).size).toBe(
      results.length,
    );
    expect(codeResult).toBeDefined();
    expect(docResult).toBeDefined();

    expect(codeResult?.sourceType).toBe("code");
    expect(codeResult?.path).toEqual(expect.any(String));
    expect(codeResult?.evidenceId).toEqual(expect.any(String));
    expect(codeResult?.contentHash).toEqual(expect.any(String));
    expect(codeResult?.extractor).toEqual(expect.any(String));
    expect(codeResult?.indexRunId).toEqual(expect.any(String));
    expect(codeResult?.score).toEqual(expect.any(Number));
    expect(codeResult?.codeLocation?.startLine).toEqual(expect.any(Number));
    expect(codeResult?.codeLocation?.endLine).toEqual(expect.any(Number));
    expect(codeResult?.docLocation).toBeUndefined();

    expect(docResult?.sourceType).toBe("doc");
    expect(docResult?.path).toEqual(expect.any(String));
    expect(docResult?.evidenceId).toEqual(expect.any(String));
    expect(docResult?.contentHash).toEqual(expect.any(String));
    expect(docResult?.extractor).toEqual(expect.any(String));
    expect(docResult?.indexRunId).toEqual(expect.any(String));
    expect(docResult?.score).toEqual(expect.any(Number));
    expect(docResult?.docLocation?.section).toEqual(expect.any(String));
    expect(docResult?.codeLocation).toBeUndefined();
  });

  it("returns context artifacts ahead of code when scores tie across repeated queries", async () => {
    const homeDir = await createTempHomeDir("lkg-search-context-order-");
    const embedding = new DeterministicEmbedding();
    const vectorStore = createVectorStore(homeDir);
    const retriever = new HybridRetriever(embedding, vectorStore);
    const queryEmbedding = await embedding.embedQuery("shared evidence");

    await vectorStore.upsert([
      {
        artifactKind: "code",
        chunkKey: "chunk-code",
        content: "shared evidence implementation",
        contentHash: "hash-code",
        embedding: [...queryEmbedding],
        evidenceId: "evidence-code",
        extractor: "test",
        fileFingerprint: "fp-code",
        indexRunId: "run-stable",
        path: "src/main.ts",
        sourceType: "code",
        codeLocation: {
          startLine: 1,
          endLine: 1,
        },
      },
      {
        artifactKind: "workflow",
        chunkKey: "chunk-workflow",
        content: "shared evidence workflow",
        contentHash: "hash-workflow",
        embedding: [...queryEmbedding],
        evidenceId: "evidence-workflow",
        extractor: "test",
        fileFingerprint: "fp-workflow",
        indexRunId: "run-stable",
        path: ".github/workflows/ci.yml",
        sourceType: "doc",
        docLocation: {
          offset: 1,
          section: "CI",
        },
      },
      {
        artifactKind: "doc",
        chunkKey: "chunk-doc",
        content: "shared evidence docs",
        contentHash: "hash-doc",
        embedding: [...queryEmbedding],
        evidenceId: "evidence-doc",
        extractor: "test",
        fileFingerprint: "fp-doc",
        indexRunId: "run-stable",
        path: "README.md",
        sourceType: "doc",
        docLocation: {
          offset: 0,
          section: "Overview",
        },
      },
    ]);

    const first = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding,
      topK: 10,
    });
    const second = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding,
      topK: 10,
    });

    expect(first.map((result) => result.artifactKind)).toEqual([
      "doc",
      "workflow",
      "code",
    ]);
    expect(second.map((result) => result.artifactKind)).toEqual([
      "doc",
      "workflow",
      "code",
    ]);
  });

  it("returns stable results for repeated queries and breaks ties by chunk key", async () => {
    const homeDir = await createTempHomeDir("lkg-search-stability-");
    const embedding = new DeterministicEmbedding();
    const vectorStore = createVectorStore(homeDir);
    const retriever = new HybridRetriever(embedding, vectorStore);
    const queryEmbedding = await embedding.embedQuery("shared evidence");

    await vectorStore.upsert([
      {
        artifactKind: "code",
        chunkKey: "chunk-b",
        content: "shared evidence beta",
        contentHash: "hash-b",
        embedding: [...queryEmbedding],
        evidenceId: "evidence-b",
        extractor: "test",
        fileFingerprint: "fp-b",
        indexRunId: "run-stable",
        path: "src/b.ts",
        sourceType: "code",
        codeLocation: {
          startLine: 2,
          endLine: 2,
        },
      },
      {
        artifactKind: "code",
        chunkKey: "chunk-a",
        content: "shared evidence alpha",
        contentHash: "hash-a",
        embedding: [...queryEmbedding],
        evidenceId: "evidence-a",
        extractor: "test",
        fileFingerprint: "fp-a",
        indexRunId: "run-stable",
        path: "src/a.ts",
        sourceType: "code",
        codeLocation: {
          startLine: 1,
          endLine: 1,
        },
      },
    ]);

    const first = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding,
      topK: 10,
    });
    const second = await retriever.retrieve({
      query: "shared evidence",
      queryEmbedding,
      topK: 10,
    });

    expect(first.map((result) => result.chunkKey)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
    expect(second.map((result) => result.chunkKey)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
    expect(first.map((result) => result.score)).toEqual(
      second.map((result) => result.score),
    );
  });
});
