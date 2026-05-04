import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { DocumentChunk } from "../../src/application/dto/ingestion.js";
import {
  createIntegrationPipeline,
  createTempHomeDir,
  readCanonicalFacts,
  readDerivedFacts,
  readInternalGraph,
  readManifest,
  readStructuredObservations,
  readSymbols,
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
      const symbols = await readSymbols(homeDir);
      const observations = await readStructuredObservations(homeDir);

      expect(summary.counters.filesTotal).toBe(2);
      expect(summary.counters.filesIndexed).toBe(2);
      expect(summary.filesUnchanged).toBe(0);
      expect(summary.chunksWritten).toBe(summary.chunks.length);
      expect(summary.chunksEmbedded).toBe(summary.chunks.length);
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
      expect(summary.observations.length).toBeGreaterThan(0);
      expect(
        observations.some(
          (observation) =>
            observation.kind === "file" && observation.path === "main.ts",
        ),
      ).toBe(true);
      expect(
        observations.some(
          (observation) =>
            observation.kind === "module" && observation.path === "main.ts",
        ),
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
      expect(symbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "variable",
            name: "answer",
            path: "main.ts",
          }),
          expect.objectContaining({
            kind: "function",
            name: "greet",
            path: "main.ts",
          }),
        ]),
      );
      expect(manifest.some((entry) => entry.path === "main.ts")).toBe(true);
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
      const symbols = await readSymbols(homeDir);

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
      expect(
        symbols
          .filter((record) => record.path === "main.ts")
          .every((record) => record.indexRunId === "run-2"),
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
      const symbols = await readSymbols(homeDir);

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
      expect(symbols.some((record) => record.path === "README.md")).toBe(false);
      expect(symbols.some((record) => record.path === "main.ts")).toBe(false);
      expect(symbols.some((record) => record.path === "renamed.ts")).toBe(true);
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

  describe("structured fact and graph persistence", () => {
    it("persists canonical facts, derived facts, and graph nodes for package tasks", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify(
          {
            name: "fixture-app",
            scripts: {
              lint: "eslint .",
              check: "npm run lint",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      await pipeline.run({ indexRunId: "run-structured-graph", mode: "full" });

      const canonicalFacts = await readCanonicalFacts(homeDir);
      const derivedFacts = await readDerivedFacts(homeDir);
      const graph = await readInternalGraph(homeDir);

      expect(canonicalFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "config_artifact", path: "package.json" }),
          expect.objectContaining({ kind: "workspace_task", path: "package.json" }),
          expect.objectContaining({ kind: "package_script", path: "package.json" }),
        ]),
      );
      expect(derivedFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "task-runs-command", path: "package.json" }),
          expect.objectContaining({ kind: "quality-gate-runs-script-candidate", path: "package.json" }),
        ]),
      );
      expect(graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "ConfigArtifact", path: "package.json" }),
          expect.objectContaining({ kind: "Task", path: "package.json" }),
          expect.objectContaining({ kind: "PackageScript", path: "package.json" }),
          expect.objectContaining({ kind: "Command", path: "package.json" }),
        ]),
      );
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "REPRESENTS", path: "package.json" }),
          expect.objectContaining({ kind: "task-runs-command", path: "package.json" }),
          expect.objectContaining({ kind: "quality-gate-runs-script-candidate", path: "package.json" }),
        ]),
      );
    });
  });

  describe("structured analysis fail-soft behavior", () => {
    it("does not crash indexing for unsupported languages", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      await writeFile(join(cwd, "script.unknownlang"), "print('hello')\n", "utf8");
      const pipeline = createIntegrationPipeline(cwd, homeDir);

      const summary = await pipeline.run({ indexRunId: "run-unsupported", mode: "full" });
      const observations = await readStructuredObservations(homeDir);

      expect(summary.counters.errors).toBe(0);
      expect(summary.chunks.length).toBeGreaterThan(0);
      expect(summary.chunks.some((chunk) => chunk.path === "script.unknownlang")).toBe(true);
      expect(observations.every((observation) => observation.language !== null)).toBe(true);
    });

    it("continues text indexing when structured analyzers fail", async () => {
      const cwd = await materializeFixtureProject("ingestion-basic");
      const homeDir = await createTempHomeDir();
      await writeFile(
        join(cwd, "broken.ts"),
        "export const broken = 1;\nfunction invoke() {\n  return broken;\n}\n",
        "utf8",
      );
      const pipeline = createIntegrationPipeline(cwd, homeDir);
      const originalAnalyze = pipeline["structuredAnalyzers"].select.bind(
        pipeline["structuredAnalyzers"],
      );
      pipeline["structuredAnalyzers"].select = (document) => {
        const analyzers = originalAnalyze(document);
        if (document.path === "broken.ts") {
          return [
            {
              analyze: async () => {
                await Promise.resolve();
                throw new Error("structured analyzer failed");
              },
              supports: () => true,
            },
            ...analyzers,
          ];
        }

        return analyzers;
      };

      const summary = await pipeline.run({ indexRunId: "run-fail-soft", mode: "full" });
      const storedRecords = await readVectorStore(homeDir);

      expect(summary.counters.errors).toBe(0);
      expect(storedRecords.some((record) => record.path === "broken.ts")).toBe(true);
      expect(summary.chunks.some((chunk) => chunk.path === "broken.ts")).toBe(true);
    });
  });
});
