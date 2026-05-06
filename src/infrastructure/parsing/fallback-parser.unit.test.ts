import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FallbackParser } from "./fallback-parser.js";
import type {
  DocumentPartition,
  ParsedDocument,
  ScanCandidate,
} from "../../application/dto/ingestion.js";

class TestFallbackParser extends FallbackParser {
  constructor(private readonly outcomes: Map<string, "success" | "fail">) {
    super();
  }

  override parsePartition(
    candidate: ScanCandidate,
    partition: DocumentPartition,
  ): Promise<ParsedDocument> {
    if (this.outcomes.get(partition.partitionId) === "fail") {
      throw new Error(`partition failed: ${partition.partitionId}`);
    }

    return {
      artifactKind: candidate.artifactKind,
      content: partition.content,
      language: "ts",
      partitions: [
        {
          ...partition,
          status: "complete",
        },
      ],
      path: candidate.path,
      sourceType: candidate.sourceType,
      structuralBlocks: [
        {
          content: partition.content,
          kind: "lexical_declaration",
          location:
            partition.location && "startLine" in partition.location
              ? partition.location
              : { startLine: 1, endLine: 1 },
        },
      ],
    };
  }
}

function createCandidate(content: string): ScanCandidate {
  const directory = mkdtempSync(join(tmpdir(), "fallback-parser-"));
  const absolutePath = join(directory, "large.ts");
  writeFileSync(absolutePath, content, "utf8");

  return {
    absolutePath,
    artifactKind: "code",
    path: "src/large.ts",
    sizeBytes: Buffer.byteLength(content),
    sourceType: "code",
  };
}

describe("FallbackParser", () => {
  it("returns a parsed document when one partition fails but others succeed", async () => {
    const content = [
      "const first = 1;",
      "",
      "x".repeat(8_200),
      "",
      "const third = 3;",
    ].join("\n");
    const candidate = createCandidate(content);
    const parser = new TestFallbackParser(
      new Map([[`${candidate.path}:1`, "fail"]]),
    );

    const document = await parser.parse(candidate);

    expect(document.partitions).toEqual([
      expect.objectContaining({
        partitionId: `${candidate.path}:0`,
        status: "complete",
      }),
      expect.objectContaining({
        partitionId: `${candidate.path}:1`,
        status: "failed",
      }),
      expect.objectContaining({
        partitionId: `${candidate.path}:2`,
        status: "complete",
      }),
    ]);
    expect(document.structuralBlocks).toHaveLength(2);
    expect(document.structuralBlocks?.map((block) => block.content)).toEqual([
      "const first = 1;",
      "const third = 3;",
    ]);
  });

  it("returns a degraded document when all valuable partitions fail", async () => {
    const content = ["const first = 1;", "", "x".repeat(8_200)].join("\n");
    const candidate = createCandidate(content);
    const parser = new TestFallbackParser(
      new Map([
        [`${candidate.path}:0`, "fail"],
        [`${candidate.path}:1`, "fail"],
      ]),
    );

    const document = await parser.parse(candidate);

    expect(document.partitions).toEqual([
      expect.objectContaining({
        partitionId: `${candidate.path}:0`,
        status: "degraded",
      }),
      expect.objectContaining({
        partitionId: `${candidate.path}:1`,
        status: "degraded",
      }),
    ]);
    expect(document.content).toBe(content);
    expect(document.structuralBlocks).toBeUndefined();
  });

  it("preserves inferred metadata when degradation falls back to whole-document parsing", async () => {
    const content = JSON.stringify(
      {
        name: "@openagentland/lkg",
        scripts: {
          lint: "eslint .",
        },
      },
      null,
      2,
    );
    const candidate = {
      ...createCandidate(content),
      artifactKind: "config" as const,
      path: "package.json",
      sourceType: "doc" as const,
    };
    const parser = new TestFallbackParser(
      new Map([[`${candidate.path}:0`, "fail"]]),
    );

    const document = await parser.parse(candidate);

    expect(document.language).toBe("json");
    expect(document.packageName).toBe("@openagentland/lkg");
    expect(document.packageScripts).toEqual([
      {
        command: "eslint .",
        name: "lint",
      },
    ]);
    expect(document.qualityGates).toEqual([
      {
        command: "eslint .",
        scriptName: "lint",
        tool: "package-script",
      },
    ]);
    expect(document.partitions).toEqual([
      expect.objectContaining({
        partitionId: `${candidate.path}:0`,
        status: "degraded",
      }),
    ]);
  });

  it("throws when all lockfile partitions fail", async () => {
    const content = ["{", `  \"lock\": \"${"x".repeat(8_200)}\"`, "}"].join(
      "\n",
    );
    const candidate = {
      ...createCandidate(content),
      artifactKind: "lockfile" as const,
      path: "package-lock.json",
    };
    const parser = new TestFallbackParser(
      new Map([
        [`${candidate.path}:0`, "fail"],
        [`${candidate.path}:1`, "fail"],
        [`${candidate.path}:2`, "fail"],
      ]),
    );

    await expect(parser.parse(candidate)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Failed to parse all partitions for candidate.",
    });
  });
});
