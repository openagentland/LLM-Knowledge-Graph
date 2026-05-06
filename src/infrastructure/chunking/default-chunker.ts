import { createHash } from "node:crypto";

import type {
  ChunkingOptions,
  CodeLocation,
  DocLocation,
  DocumentChunk,
  ParsedDocument,
} from "../../application/dto/ingestion.js";
import type { ChunkerPort } from "../../application/ports/chunker-port.js";

const DEFAULT_CONTEXT_WINDOW = 2048;
const APPROX_CHARS_PER_TOKEN = 2.5;

export class DefaultChunker implements ChunkerPort {
  chunk(
    document: ParsedDocument,
    context: { chunking: ChunkingOptions; indexRunId: string },
  ): Promise<DocumentChunk[]> {
    const chunking = normalizeChunkingOptions(context.chunking);
    return Promise.resolve(
      document.sourceType === "code"
        ? chunkCodeDocument(document, context.indexRunId, chunking)
        : chunkDocDocument(document, context.indexRunId, chunking),
    );
  }
}

function chunkCodeDocument(
  document: ParsedDocument,
  indexRunId: string,
  options: NormalizedChunkingOptions,
): DocumentChunk[] {
  if (document.structuralBlocks && document.structuralBlocks.length > 0) {
    return flattenChunks(
      document.structuralBlocks.flatMap((block) =>
        splitSegment({
          baseCodeLocation: block.location,
          content: block.content,
          depth: 0,
          docLocation: undefined,
          document,
          extractor: `ast-grep:${block.kind}`,
          indexRunId,
          options,
        }),
      ),
    );
  }

  const lines = document.content.split(/\r?\n/);
  return flattenChunks(
    splitCodeByLineWindows(
      lines,
      options.maxChars,
      options.overlapChars,
    ).flatMap((segment) =>
      splitSegment({
        baseCodeLocation: segment.location,
        content: segment.content,
        depth: 0,
        docLocation: undefined,
        document,
        extractor: "fallback-code-chunker",
        indexRunId,
        options,
      }),
    ),
  );
}

function chunkDocDocument(
  document: ParsedDocument,
  indexRunId: string,
  options: NormalizedChunkingOptions,
): DocumentChunk[] {
  const sections = splitMarkdownSections(document.content);
  const contentSections =
    sections.length > 0 ? sections : [document.content.trim()];

  return flattenChunks(
    contentSections.filter(Boolean).flatMap((content, index) =>
      splitSegment({
        content,
        depth: 0,
        docLocation: {
          offset: index,
          section: readSectionTitle(content),
        },
        document,
        extractor: "markdown-section-chunker",
        indexRunId,
        options,
      }),
    ),
  );
}

type NormalizedChunkingOptions = {
  maxChars: number;
  overlapChars: number;
  oversizedSegmentPolicy: "split" | "skip";
  maxSplitDepth: number;
};

function normalizeChunkingOptions(
  options: ChunkingOptions,
): NormalizedChunkingOptions {
  const contextWindow =
    options.embeddingContextLength ?? DEFAULT_CONTEXT_WINDOW;
  const tokenMargin = Math.min(options.embeddingTokenMargin, contextWindow - 1);
  const maxTokens =
    options.maxChunkTokens ?? Math.max(1, contextWindow - tokenMargin);
  const overlapTokens = Math.min(
    options.chunkTokenOverlap,
    Math.max(0, maxTokens - 1),
  );

  return {
    maxChars: Math.max(1, maxTokens * APPROX_CHARS_PER_TOKEN),
    maxSplitDepth: options.maxSplitDepth,
    overlapChars: Math.max(0, overlapTokens * APPROX_CHARS_PER_TOKEN),
    oversizedSegmentPolicy: options.oversizedSegmentPolicy,
  };
}

function splitSegment(input: {
  baseCodeLocation?: CodeLocation;
  content: string;
  depth: number;
  docLocation?: DocLocation;
  document: ParsedDocument;
  extractor: string;
  indexRunId: string;
  options: NormalizedChunkingOptions;
}): DocumentChunk[] {
  const content = input.content.trim();
  if (!content) {
    return [];
  }

  if (content.length <= input.options.maxChars) {
    return [
      buildChunk(
        input.document,
        input.indexRunId,
        content,
        input.baseCodeLocation,
        input.docLocation,
        input.extractor,
      ),
    ];
  }

  if (input.options.oversizedSegmentPolicy === "skip") {
    return [];
  }

  if (input.depth >= input.options.maxSplitDepth) {
    return splitByCharacterWindow(
      content,
      input.options.maxChars,
      input.options.overlapChars,
    ).map((segment, index) =>
      buildChunk(
        input.document,
        input.indexRunId,
        segment,
        input.baseCodeLocation,
        augmentDocLocation(input.docLocation, index),
        `${input.extractor}:token-window`,
      ),
    );
  }

  if (input.document.sourceType === "code") {
    return splitCodeContent(
      content,
      input.baseCodeLocation,
      input.options,
    ).flatMap((segment) =>
      splitSegment({
        baseCodeLocation: segment.codeLocation,
        content: segment.content,
        depth: input.depth + 1,
        docLocation: undefined,
        document: input.document,
        extractor: `${input.extractor}:${segment.kind}`,
        indexRunId: input.indexRunId,
        options: input.options,
      }),
    );
  }

  return splitDocContent(content, input.docLocation, input.options).flatMap(
    (segment) =>
      splitSegment({
        baseCodeLocation: undefined,
        content: segment.content,
        depth: input.depth + 1,
        docLocation: segment.docLocation,
        document: input.document,
        extractor: `${input.extractor}:${segment.kind}`,
        indexRunId: input.indexRunId,
        options: input.options,
      }),
  );
}

function splitCodeContent(
  content: string,
  codeLocation: CodeLocation | undefined,
  options: NormalizedChunkingOptions,
): Array<{ codeLocation?: CodeLocation; content: string; kind: string }> {
  const paragraphs = splitByBlankLines(content);
  if (paragraphs.length > 1) {
    return paragraphs.map((segment) => ({
      codeLocation,
      content: segment,
      kind: "paragraph",
    }));
  }

  const lines = content.split(/\r?\n/);
  return splitCodeByLineWindows(
    lines,
    options.maxChars,
    options.overlapChars,
  ).map((segment) => ({
    codeLocation,
    content: segment.content,
    kind: "line-window",
  }));
}

function splitDocContent(
  content: string,
  docLocation: DocLocation | undefined,
  options: NormalizedChunkingOptions,
): Array<{ content: string; docLocation?: DocLocation; kind: string }> {
  const sectionParts = splitMarkdownSections(content);
  if (sectionParts.length > 1) {
    return sectionParts.map((segment, index) => ({
      content: segment,
      docLocation: augmentDocLocation(
        docLocation,
        index,
        readSectionTitle(segment),
      ),
      kind: "section",
    }));
  }

  const paragraphs = splitByBlankLines(content);
  if (paragraphs.length > 1) {
    return paragraphs.map((segment, index) => ({
      content: segment,
      docLocation: augmentDocLocation(docLocation, index),
      kind: "paragraph",
    }));
  }

  return splitByCharacterWindow(
    content,
    options.maxChars,
    options.overlapChars,
  ).map((segment, index) => ({
    content: segment,
    docLocation: augmentDocLocation(docLocation, index),
    kind: "token-window",
  }));
}

function splitByBlankLines(content: string): string[] {
  return content
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitMarkdownSections(content: string): string[] {
  return content
    .split(/\n(?=# )/g)
    .map((section) => section.trim())
    .filter(Boolean);
}

function splitCodeByLineWindows(
  lines: string[],
  maxChars: number,
  overlapChars: number,
): Array<{ content: string; location: CodeLocation }> {
  const segments: Array<{ content: string; location: CodeLocation }> = [];
  let startIndex = 0;

  while (startIndex < lines.length) {
    let endIndex = startIndex;
    let currentLength = 0;

    while (endIndex < lines.length) {
      const nextLength = currentLength + lines[endIndex].length + 1;
      if (currentLength > 0 && nextLength > maxChars) {
        break;
      }
      currentLength = nextLength;
      endIndex += 1;
    }

    if (endIndex === startIndex) {
      endIndex = startIndex + 1;
    }

    const content = lines.slice(startIndex, endIndex).join("\n").trim();
    if (content) {
      segments.push({
        content,
        location: {
          endLine: endIndex,
          startLine: startIndex + 1,
        },
      });
    }

    if (endIndex >= lines.length) {
      break;
    }

    const nextStartIndex = computeOverlappedLineStart(
      lines,
      endIndex,
      overlapChars,
    );
    startIndex = Math.max(startIndex + 1, nextStartIndex);
  }

  return segments;
}

function computeOverlappedLineStart(
  lines: string[],
  endIndex: number,
  overlapChars: number,
): number {
  if (overlapChars <= 0) {
    return endIndex;
  }

  let overlap = 0;
  let start = endIndex;
  while (start > 0) {
    const previousLineLength = lines[start - 1]?.length ?? 0;
    if (overlap > 0 && overlap + previousLineLength > overlapChars) {
      break;
    }
    start -= 1;
    overlap += previousLineLength;
  }

  return start;
}

function splitByCharacterWindow(
  content: string,
  maxChars: number,
  overlapChars: number,
): string[] {
  const segments: string[] = [];
  let start = 0;

  while (start < content.length) {
    const end = Math.min(content.length, start + maxChars);
    const chunk = content.slice(start, end).trim();
    if (chunk) {
      segments.push(chunk);
    }
    if (end >= content.length) {
      break;
    }
    start = Math.max(start + 1, end - overlapChars);
  }

  return segments;
}

function buildChunk(
  document: ParsedDocument,
  indexRunId: string,
  content: string,
  codeLocation: CodeLocation | undefined,
  docLocation: DocLocation | undefined,
  extractor: string,
): DocumentChunk {
  const contentHash = createHash("sha256").update(content).digest("hex");
  const locationKey = codeLocation
    ? `${codeLocation.startLine}:${codeLocation.endLine}`
    : `${docLocation?.section ?? "section"}:${docLocation?.offset ?? 0}`;
  const partition = resolvePartition(document, codeLocation, docLocation);

  return {
    artifactKind: document.artifactKind,
    codeLocation,
    content,
    contentHash,
    docLocation,
    evidenceId: createHash("sha256")
      .update(`${document.path}:${locationKey}:${contentHash}`)
      .digest("hex")
      .slice(0, 24),
    extractor,
    indexRunId,
    partitionId: partition?.partitionId,
    partitionIndex: partition?.index,
    partitionStatus: partition?.status,
    partitionTotal: partition?.total,
    path: document.path,
    sourceType: document.sourceType,
  };
}

function resolvePartition(
  document: ParsedDocument,
  codeLocation: CodeLocation | undefined,
  docLocation: DocLocation | undefined,
) {
  const partitions = document.partitions ?? [];
  if (partitions.length <= 1) {
    return partitions[0];
  }

  if (codeLocation) {
    return partitions.find((partition) => {
      if (!partition.location || !("startLine" in partition.location)) {
        return false;
      }

      return (
        codeLocation.startLine >= partition.location.startLine &&
        codeLocation.endLine <= partition.location.endLine
      );
    });
  }

  if (docLocation) {
    return partitions.find((partition) => {
      if (!partition.location || !("offset" in partition.location)) {
        return false;
      }

      const sameSection =
        docLocation.section === undefined ||
        partition.location.section === undefined ||
        partition.location.section === docLocation.section;
      const partitionOffset = partition.location.offset ?? 0;
      const chunkOffset = docLocation.offset ?? 0;
      return sameSection && partitionOffset <= chunkOffset;
    });
  }

  return partitions[0];
}

function augmentDocLocation(
  base: DocLocation | undefined,
  offset: number,
  section?: string,
): DocLocation | undefined {
  if (!base && section === undefined && offset === 0) {
    return undefined;
  }

  return {
    offset: (base?.offset ?? 0) + offset,
    section: section ?? base?.section,
  };
}

function flattenChunks(chunks: DocumentChunk[]): DocumentChunk[] {
  return chunks.filter((chunk) => chunk.content.trim().length > 0);
}

function readSectionTitle(content: string): string | undefined {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}
