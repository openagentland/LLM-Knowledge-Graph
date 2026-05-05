import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { PersistedChunkRecord } from "../../application/dto/storage.js";
import { LanceDbVectorStore } from "../../infrastructure/storage/lance-db-vector-store.js";

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
    artifactKind: overrides.artifactKind ?? "code",
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

describe("LanceDbVectorStore", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("returns an empty array when the table does not exist", async () => {
    const vectorDbUri = await mkdtemp(join(tmpdir(), "lkg-lancedb-"));
    directories.push(vectorDbUri);
    const store = new LanceDbVectorStore({
      indexScope: "shared",
      projectIdentity: "project-a",
      vectorDbUri,
    });

    await expect(store.searchByEmbedding([1, 0], 5)).resolves.toEqual([]);
  });

  it("returns nearest neighbors in LanceDB rank order and respects topK", async () => {
    const vectorDbUri = await mkdtemp(join(tmpdir(), "lkg-lancedb-"));
    directories.push(vectorDbUri);
    const store = new LanceDbVectorStore({
      indexScope: "shared",
      projectIdentity: "project-a",
      vectorDbUri,
    });

    await store.upsert([
      createRecord({
        chunkKey: "chunk-a",
        content: "closest",
        embedding: [1, 0],
        evidenceId: "e1",
        extractor: "test",
        fileFingerprint: "fp1",
        indexRunId: "run1",
        path: "src/a.ts",
        sourceType: "code",
        codeLocation: { startLine: 1, endLine: 1 },
      }),
      createRecord({
        chunkKey: "chunk-b",
        content: "middle",
        embedding: [0.5, 0.5],
        evidenceId: "e2",
        extractor: "test",
        fileFingerprint: "fp2",
        indexRunId: "run1",
        path: "src/b.ts",
        sourceType: "code",
        codeLocation: { startLine: 2, endLine: 2 },
      }),
      createRecord({
        chunkKey: "chunk-c",
        content: "farthest",
        embedding: [0, 1],
        evidenceId: "e3",
        extractor: "test",
        fileFingerprint: "fp3",
        indexRunId: "run1",
        path: "docs/c.md",
        sourceType: "doc",
        docLocation: { offset: 4, section: "intro" },
      }),
    ]);

    const results = await store.searchByEmbedding([1, 0], 2);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.chunkKey)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0]).toMatchObject({
      codeLocation: { startLine: 1, endLine: 1 },
      path: "src/a.ts",
      sourceType: "code",
    });
    expect(results[0]).not.toHaveProperty("embedding");
    expect(results[0]).not.toHaveProperty("fileFingerprint");
    expect(results[1]).toMatchObject({
      codeLocation: { startLine: 2, endLine: 2 },
      path: "src/b.ts",
      sourceType: "code",
    });
  });
});
