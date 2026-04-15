import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { DocumentChunk } from "../../src/application/dto/ingestion.js";
import {
  createIntegrationPipeline,
  createTempHomeDir,
  readManifest,
  readVectorStore,
  sortedPaths,
} from "../helpers/integration-runtime.js";
import { materializeFixtureProject } from "../helpers/materialize-fixture-project.js";

const numberMatcher = expect.any(Number) as number;
const stringMatcher = expect.any(String) as string;

describe("DefaultIngestionPipeline", () => {
  describe("full runs", () => {
    it("scans, parses, chunks, persists, and preserves provenance", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      const summary = await pipeline.run({ indexRunId: "run-1", mode: "full" });
      const codeChunks = summary.chunks.filter(
        (chunk) => chunk.sourceType === "code",
      );
      const docChunks = summary.chunks.filter(
        (chunk) => chunk.sourceType === "doc",
      );

      const firstCodeChunk = codeChunks[0] as DocumentChunk | undefined;
      const storedRecords = (await readVectorStore(homeDir)) as Array<{
        contentHash: string;
        indexRunId: string;
        path: string;
      }>;
      const manifest = (await readManifest(homeDir)) as Array<{ path: string }>;

      expect(summary.counters.filesTotal).toBe(2);
      expect(summary.counters.filesIndexed).toBe(2);
      expect(summary.filesUnchanged).toBe(0);
      expect(summary.chunksWritten).toBe(summary.chunks.length);
      expect(summary.chunksEmbedded).toBe(summary.chunks.length);
      expect(summary.skipped).toContainEqual({
        path: "ignored.ts",
        reason: "ignored",
      });
      expect(summary.skipped).toContainEqual({
        path: ".gitignore",
        reason: "unsupported",
      });
      expect(summary.chunks.length).toBeGreaterThan(0);
      expect(firstCodeChunk).toMatchObject({
        codeLocation: {
          endLine: numberMatcher,
          startLine: numberMatcher,
        },
        contentHash: stringMatcher,
        evidenceId: stringMatcher,
        indexRunId: "run-1",
        path: stringMatcher,
        sourceType: "code",
      });
      expect(
        codeChunks.some((chunk) => chunk.extractor.startsWith("ast-grep:")),
      ).toBe(true);
      expect(docChunks).toHaveLength(2);
      expect(docChunks.map((chunk) => chunk.path)).toEqual([
        "README.md",
        "README.md",
      ]);
      expect(docChunks.map((chunk) => chunk.docLocation?.section)).toEqual([
        "Intro",
        "Next",
      ]);
      expect(storedRecords).toHaveLength(summary.chunks.length);
      expect(
        storedRecords.every((record) => record.indexRunId === "run-1"),
      ).toBe(true);
      expect(
        storedRecords.every((record) => record.contentHash.length > 0),
      ).toBe(true);
      expect(sortedPaths(storedRecords)).toEqual(
        [
          ...Array.from({ length: docChunks.length }, () => "README.md"),
          ...Array.from({ length: codeChunks.length }, () => "main.ts"),
        ].sort(),
      );
      expect(sortedPaths(manifest)).toEqual(["README.md", "main.ts"]);
    });
  });

  describe("idempotency", () => {
    it("keeps writes idempotent across repeated full runs", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      const first = await pipeline.run({ indexRunId: "run-1", mode: "full" });
      const firstManifest = (await readManifest(homeDir)) as Array<{
        path: string;
      }>;
      const second = await pipeline.run({ indexRunId: "run-2", mode: "full" });
      const secondManifest = (await readManifest(homeDir)) as Array<{
        path: string;
      }>;
      const storedRecords = await readVectorStore(homeDir);

      expect(first.chunksWritten).toBeGreaterThan(0);
      expect(second.chunksWritten).toBe(0);
      expect(second.chunksEmbedded).toBe(0);
      expect(second.filesUnchanged).toBe(2);
      expect(storedRecords).toHaveLength(first.chunks.length);
      expect(sortedPaths(firstManifest)).toEqual(["README.md", "main.ts"]);
      expect(sortedPaths(secondManifest)).toEqual(sortedPaths(firstManifest));
    });
  });

  describe("incremental updates", () => {
    it("rewrites changed files during incremental runs", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      await pipeline.run({ indexRunId: "run-1", mode: "full" });
      await writeFile(
        join(cwd, "main.ts"),
        "export const answer = 43;\nfunction greet() {\n  return 'hello';\n}\n",
        "utf8",
      );

      const summary = await pipeline.run({
        indexRunId: "run-2",
        mode: "incremental",
      });
      const storedRecords = (await readVectorStore(homeDir)) as Array<{
        indexRunId: string;
        path: string;
      }>;

      expect(summary.counters.filesIndexed).toBe(2);
      expect(summary.filesUnchanged).toBe(1);
      expect(summary.chunksWritten).toBeGreaterThan(0);
      expect(summary.chunksPurged).toBeGreaterThan(0);
      expect(storedRecords.some((record) => record.path === "main.ts")).toBe(
        true,
      );
      expect(
        storedRecords
          .filter((record) => record.path === "main.ts")
          .every((record) => record.indexRunId === "run-2"),
      ).toBe(true);
      expect(
        storedRecords.some(
          (record) =>
            record.path === "README.md" && record.indexRunId === "run-1",
        ),
      ).toBe(true);
    });
  });

  describe("purge semantics", () => {
    it("purges stale records for deleted and renamed files", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      await pipeline.run({ indexRunId: "run-1", mode: "full" });
      await rm(join(cwd, "README.md"));
      await rename(join(cwd, "main.ts"), join(cwd, "renamed.ts"));

      const summary = await pipeline.run({
        indexRunId: "run-2",
        mode: "incremental",
      });
      const storedRecords = (await readVectorStore(homeDir)) as Array<{
        path: string;
      }>;
      const manifest = (await readManifest(homeDir)) as Array<{ path: string }>;

      expect(summary.filesPurged).toBeGreaterThanOrEqual(2);
      expect(summary.chunksPurged).toBeGreaterThan(0);
      expect(storedRecords.some((record) => record.path === "README.md")).toBe(
        false,
      );
      expect(storedRecords.some((record) => record.path === "main.ts")).toBe(
        false,
      );
      expect(storedRecords.some((record) => record.path === "renamed.ts")).toBe(
        true,
      );
      expect(manifest.some((entry) => entry.path === "README.md")).toBe(false);
      expect(manifest.some((entry) => entry.path === "main.ts")).toBe(false);
      expect(manifest.some((entry) => entry.path === "renamed.ts")).toBe(true);
      expect(sortedPaths(manifest)).toEqual(["renamed.ts"]);
    });
  });

  describe("oversized splitting", () => {
    it("splits oversized important docs instead of skipping them", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      await writeFile(
        join(cwd, "architecture.md"),
        `# Architecture\n\n${"systems ".repeat(200)}\n\n# Details\n\n${"details ".repeat(200)}`,
        "utf8",
      );
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      const summary = await pipeline.run({ indexRunId: "run-1", mode: "full" });
      const docChunks = summary.chunks.filter(
        (chunk) => chunk.path === "architecture.md",
      );

      expect(docChunks.length).toBeGreaterThan(1);
      expect(
        summary.skipped.some((entry) => entry.path === "architecture.md"),
      ).toBe(false);
      expect(docChunks.every((chunk) => chunk.sourceType === "doc")).toBe(true);
      expect(
        docChunks.some((chunk) => chunk.extractor.includes("token-window")),
      ).toBe(true);
      expect(
        docChunks.some(
          (chunk) => chunk.docLocation?.section === "Architecture",
        ),
      ).toBe(true);
      expect(
        docChunks.some((chunk) => chunk.docLocation?.section === "Details"),
      ).toBe(true);
    });
  });

  describe("progress/checkpoint", () => {
    it("tracks batch progress in the ingestion summary", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      await writeFile(
        join(cwd, "extra.md"),
        `# Extra\n\n${"context ".repeat(120)}`,
        "utf8",
      );
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      const summary = await pipeline.run({ indexRunId: "run-1", mode: "full" });

      expect(summary.progress.batchTotal).toBeGreaterThan(0);
      expect(summary.progress.batchIndex).toBe(summary.progress.batchTotal);
      expect(summary.progress.filesProcessed).toBe(
        summary.counters.filesIndexed + summary.counters.errors,
      );
    });
  });
});
