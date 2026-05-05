import { describe, expect, it } from "vitest";

import { DefaultChunker } from "./default-chunker.js";
import type { ParsedDocument } from "../../application/dto/ingestion.js";

const chunker = new DefaultChunker();
const chunking = {
  chunkTokenOverlap: 8,
  embeddingContextLength: 64,
  embeddingTokenMargin: 16,
  maxChunkTokens: 16,
  maxSplitDepth: 3,
  oversizedSegmentPolicy: "split" as const,
};

describe("DefaultChunker", () => {
  it("splits oversized docs into multiple chunks with section provenance", async () => {
    const document: ParsedDocument = {
      artifactKind: "doc",
      content: `# Intro\n\n${"alpha ".repeat(80)}\n\n# Next\n\n${"beta ".repeat(80)}`,
      language: null,
      path: "README.md",
      sourceType: "doc",
    };

    const chunks = await chunker.chunk(document, {
      chunking,
      indexRunId: "run-1",
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
    expect(chunks.some((chunk) => chunk.docLocation?.section === "Intro")).toBe(
      true,
    );
    expect(
      chunks.some((chunk) => chunk.extractor.includes("token-window")),
    ).toBe(true);
  });

  it("splits oversized code while preserving code locations", async () => {
    const document: ParsedDocument = {
      artifactKind: "code",
      content: Array.from(
        { length: 80 },
        (_, index) => `const value${index} = ${index};`,
      ).join("\n"),
      language: "ts",
      path: "main.ts",
      sourceType: "code",
    };

    const chunks = await chunker.chunk(document, {
      chunking,
      indexRunId: "run-1",
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.codeLocation)).toBe(true);
    expect(chunks.every((chunk) => chunk.extractor.length > 0)).toBe(true);
  });

  it("uses the chunking context length provided by callers", async () => {
    const document: ParsedDocument = {
      artifactKind: "code",
      content: Array.from(
        { length: 12 },
        (_, index) => `const value${index} = ${index};`,
      ).join("\n"),
      language: "ts",
      path: "main.ts",
      sourceType: "code",
    };

    const resolvedChunks = await chunker.chunk(document, {
      chunking: {
        ...chunking,
        chunkTokenOverlap: 0,
        embeddingContextLength: 8,
        embeddingTokenMargin: 0,
        maxChunkTokens: null,
      },
      indexRunId: "run-1",
    });
    const fallbackChunks = await chunker.chunk(document, {
      chunking: {
        ...chunking,
        chunkTokenOverlap: 0,
        embeddingContextLength: null,
        embeddingTokenMargin: 0,
        maxChunkTokens: null,
      },
      indexRunId: "run-1",
    });

    expect(resolvedChunks.length).toBeGreaterThan(1);
    expect(fallbackChunks.length).toBe(1);
  });

  it("maps chunk partition provenance from matching code partitions", async () => {
    const document: ParsedDocument = {
      artifactKind: "test",
      content: ["const first = 1;", "const second = 2;"].join("\n"),
      language: "ts",
      partitions: [
        {
          content: "const first = 1;",
          index: 0,
          location: { endLine: 1, startLine: 1 },
          partitionId: "main.ts:0",
          status: "partial",
          total: 2,
        },
        {
          content: "const second = 2;",
          index: 1,
          location: { endLine: 2, startLine: 2 },
          partitionId: "main.ts:1",
          status: "complete",
          total: 2,
        },
      ],
      path: "main.test.ts",
      sourceType: "code",
      structuralBlocks: [
        {
          content: "const first = 1;",
          kind: "lexical_declaration",
          location: { endLine: 1, startLine: 1 },
        },
        {
          content: "const second = 2;",
          kind: "lexical_declaration",
          location: { endLine: 2, startLine: 2 },
        },
      ],
    };

    const chunks = await chunker.chunk(document, {
      chunking,
      indexRunId: "run-1",
    });

    expect(chunks).toEqual([
      expect.objectContaining({
        partitionId: "main.ts:0",
        partitionIndex: 0,
        partitionStatus: "partial",
        partitionTotal: 2,
      }),
      expect.objectContaining({
        partitionId: "main.ts:1",
        partitionIndex: 1,
        partitionStatus: "complete",
        partitionTotal: 2,
      }),
    ]);
  });
});
