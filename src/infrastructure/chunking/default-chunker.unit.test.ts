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
});
