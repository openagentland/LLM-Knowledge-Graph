import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("recreates the table when mergeInsert hits artifactKind schema drift", async () => {
    const mergeExecute = vi
      .fn()
      .mockRejectedValueOnce(new Error("artifactKind schema mismatch"));
    const mergeInsert = vi.fn().mockReturnValue({
      whenMatchedUpdateAll: () => ({
        whenNotMatchedInsertAll: () => ({
          execute: mergeExecute,
        }),
      }),
    });
    const existingTable = {
      mergeInsert,
    };
    const recreatedTable = { kind: "recreated" };
    const store = new LanceDbVectorStore({
      indexScope: "shared",
      projectIdentity: "project-a",
      vectorDbUri: "/tmp/lancedb",
    });
    const getExistingTable = vi
      .fn()
      .mockResolvedValueOnce(existingTable)
      .mockResolvedValueOnce(existingTable);
    const recreateTable = vi.fn().mockResolvedValue(recreatedTable);

    (store as { getExistingTable: typeof getExistingTable }).getExistingTable =
      getExistingTable;
    (store as { recreateTable: typeof recreateTable }).recreateTable =
      recreateTable;

    await store.upsert([
      createRecord({
        artifactKind: "workflow",
        chunkKey: "chunk-a",
        content: "workflow",
        embedding: [1, 0],
        evidenceId: "e1",
        extractor: "test",
        fileFingerprint: "fp1",
        indexRunId: "run1",
        path: "workflow.yml",
        sourceType: "doc",
      }),
    ]);

    expect(mergeExecute).toHaveBeenCalledTimes(1);
    expect(recreateTable).toHaveBeenCalledTimes(1);
    expect(recreateTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ artifactKind: "workflow" }),
      ]),
    );
  });
});
