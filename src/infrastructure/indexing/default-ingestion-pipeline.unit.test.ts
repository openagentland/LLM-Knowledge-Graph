import { describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/unbound-method */

import { DefaultIngestionPipeline } from "./default-ingestion-pipeline.js";
import type {
  DocumentChunk,
  ParsedDocument,
  ScanCandidate,
  ScanResult,
} from "../../application/dto/ingestion.js";
import type { FileManifestEntry, PersistedChunkRecord } from "../../application/dto/storage.js";
import type { ChunkerPort } from "../../application/ports/chunker-port.js";
import type { DocumentManifestPort } from "../../application/ports/document-manifest-port.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { FileScannerPort } from "../../application/ports/file-scanner-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { ParserPort } from "../../application/ports/parser-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";

function createLogger(): LoggerPort & {
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const logger = {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function createCandidate(path: string): ScanCandidate {
  return {
    absolutePath: `/repo/${path}`,
    path,
    sizeBytes: 100,
    sourceType: "code",
  };
}

function createDocument(candidate: ScanCandidate, content: string): ParsedDocument {
  return {
    content,
    language: "ts",
    path: candidate.path,
    sourceType: candidate.sourceType,
  };
}

function createChunk(options: {
  content: string;
  evidenceId: string;
  indexRunId?: string;
  path: string;
}): DocumentChunk {
  return {
    content: options.content,
    contentHash: `${options.evidenceId}-hash`,
    evidenceId: options.evidenceId,
    extractor: "test-extractor",
    indexRunId: options.indexRunId ?? "run-1",
    path: options.path,
    sourceType: "code",
  };
}

function createManifestEntry(overrides: Partial<FileManifestEntry> = {}): FileManifestEntry {
  return {
    chunkKeys: ["chunk-a"],
    fileFingerprint: "fingerprint-old",
    indexRunId: "run-old",
    lastIndexedAt: "2026-05-03T00:00:00.000Z",
    path: "src/example.ts",
    sourceType: "code",
    ...overrides,
  };
}

function createPipeline(options: {
  chunker?: Partial<ChunkerPort>;
  embedding?: Partial<EmbeddingPort>;
  logger?: ReturnType<typeof createLogger>;
  manifest?: Partial<DocumentManifestPort>;
  parser?: Partial<ParserPort>;
  scanner?: Partial<FileScannerPort>;
  vectorStore?: Partial<VectorStorePort>;
}) {
  const scanner: FileScannerPort = {
    scan: vi.fn<() => Promise<ScanResult>>().mockResolvedValue({
      candidates: [],
      skipped: [],
    }),
    ...options.scanner,
  };
  const parser: ParserPort = {
    parse: vi.fn<(candidate: ScanCandidate) => Promise<ParsedDocument>>(),
    ...options.parser,
  };
  const chunker: ChunkerPort = {
    chunk: vi.fn<(document: ParsedDocument) => Promise<DocumentChunk[]>>(),
    ...options.chunker,
  };
  const embedding: EmbeddingPort = {
    embedChunks: vi.fn<(chunks: Array<{ content: string; contentHash: string; evidenceId: string; path: string; sourceType: "code" | "doc" }>) => Promise<Array<{ evidenceId: string; vector: number[] }>>>().mockResolvedValue([]),
    embedQuery: vi.fn(),
    ...options.embedding,
  };
  const vectorStore: VectorStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    listRecords: vi.fn<() => Promise<PersistedChunkRecord[]>>().mockResolvedValue([]),
    searchByEmbedding: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...options.vectorStore,
  };
  const manifest: DocumentManifestPort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn<() => Promise<FileManifestEntry[]>>().mockResolvedValue([]),
    getByPath: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...options.manifest,
  };
  const logger = options.logger ?? createLogger();

  const pipeline = new DefaultIngestionPipeline(
    scanner,
    parser,
    chunker,
    embedding,
    vectorStore,
    manifest,
    logger,
    {
      activeProjectIdentity: "project-a",
      chunking: {
        chunkTokenOverlap: 0,
        embeddingContextLength: null,
        embeddingTokenMargin: 0,
        maxChunkTokens: null,
        maxSplitDepth: 2,
        oversizedSegmentPolicy: "split",
      },
      embeddingBatchSize: 10,
      fileScanBatchSize: 10,
      indexCheckpointEveryBatches: 1,
      vectorUpsertBatchSize: 10,
    },
  );

  return {
    chunker,
    embedding,
    logger,
    manifest,
    parser,
    pipeline,
    scanner,
    vectorStore,
  };
}

function getMock<T extends (...args: never[]) => unknown>(
  fn: T,
): ReturnType<typeof vi.fn<T>> {
  return fn as ReturnType<typeof vi.fn<T>>;
}

describe("DefaultIngestionPipeline", () => {
  it("clears vector store and manifest before a rebuild run", async () => {
    const candidate = createCandidate("src/rebuild.ts");
    const document = createDocument(candidate, "export const rebuild = true;\n");
    const chunk = createChunk({
      content: document.content,
      evidenceId: "evidence-1",
      path: candidate.path,
    });
    const calls: string[] = [];

    const { pipeline, vectorStore, manifest } = createPipeline({
      scanner: {
        scan: vi.fn().mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([chunk]),
      },
      embedding: {
        embedChunks: vi.fn().mockResolvedValue([
          { evidenceId: "evidence-1", vector: [1, 2, 3] },
        ]),
      },
      vectorStore: {
        clear: vi.fn().mockImplementation(() => {
          calls.push("clear-vector");
          return Promise.resolve();
        }),
        upsert: vi.fn().mockImplementation(() => {
          calls.push("upsert-vector");
          return Promise.resolve();
        }),
      },
      manifest: {
        clear: vi.fn().mockImplementation(() => {
          calls.push("clear-manifest");
          return Promise.resolve();
        }),
        upsert: vi.fn().mockImplementation(() => {
          calls.push("upsert-manifest");
          return Promise.resolve();
        }),
      },
    });

    const summary = await pipeline.run({ indexRunId: "run-1", mode: "rebuild" });

    const clearVectorStore = getMock(vectorStore.clear);
    const clearManifest = getMock(manifest.clear);

    expect(clearVectorStore.mock.calls).toHaveLength(1);
    expect(clearManifest.mock.calls).toHaveLength(1);
    expect(calls).toEqual([
      "clear-vector",
      "clear-manifest",
      "upsert-vector",
      "upsert-manifest",
    ]);
    expect(summary.counters).toEqual({ errors: 0, filesIndexed: 1, filesTotal: 1 });
  });

  it("short-circuits unchanged files without downstream writes", async () => {
    const candidate = createCandidate("src/unchanged.ts");
    const document = createDocument(candidate, "export const stable = true;\n");
    const manifestEntry = createManifestEntry({
      fileFingerprint: "e9446810aede94ee09fd0720cafe0f6d15f9b35dbcda662bcaf3d63d7009c479",
      path: candidate.path,
    });

    const { pipeline, chunker, embedding, vectorStore, manifest } = createPipeline({
      scanner: {
        scan: vi.fn().mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      manifest: {
        getAll: vi.fn().mockResolvedValue([manifestEntry]),
      },
    });

    const summary = await pipeline.run({ indexRunId: "run-2", mode: "incremental" });

    const chunkSpy = getMock(chunker.chunk);
    const embedChunksSpy = getMock(embedding.embedChunks);
    const upsertSpy = getMock(vectorStore.upsert);
    const manifestUpsertSpy = getMock(manifest.upsert);

    expect(summary.counters).toEqual({ errors: 0, filesIndexed: 1, filesTotal: 1 });
    expect(summary.filesUnchanged).toBe(1);
    expect(summary.chunksWritten).toBe(0);
    expect(chunkSpy.mock.calls).toHaveLength(0);
    expect(embedChunksSpy.mock.calls).toHaveLength(0);
    expect(upsertSpy.mock.calls).toHaveLength(0);
    expect(manifestUpsertSpy.mock.calls).toHaveLength(0);
  });

  it("purges an existing file before rewriting updated chunks", async () => {
    const candidate = createCandidate("src/changed.ts");
    const document = createDocument(candidate, "export const changed = 2;\n");
    const chunks = [
      createChunk({ content: "chunk one", evidenceId: "evidence-1", path: candidate.path }),
      createChunk({ content: "chunk two", evidenceId: "evidence-2", path: candidate.path }),
    ];
    const manifestEntry = createManifestEntry({
      chunkKeys: ["old-1", "old-2"],
      fileFingerprint: "fingerprint-old",
      path: candidate.path,
    });
    const calls: string[] = [];

    const { pipeline, vectorStore, manifest } = createPipeline({
      scanner: {
        scan: vi.fn().mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue(chunks),
      },
      embedding: {
        embedChunks: vi.fn().mockResolvedValue([
          { evidenceId: "evidence-1", vector: [0.1, 0.2] },
          { evidenceId: "evidence-2", vector: [0.3, 0.4] },
        ]),
      },
      vectorStore: {
        deleteByPath: vi.fn().mockImplementation(() => {
          calls.push("delete");
          return Promise.resolve();
        }),
        upsert: vi.fn().mockImplementation(() => {
          calls.push("upsert");
          return Promise.resolve();
        }),
      },
      manifest: {
        getAll: vi.fn().mockResolvedValue([manifestEntry]),
        upsert: vi.fn().mockImplementation(() => {
          calls.push("manifest-upsert");
          return Promise.resolve();
        }),
      },
    });

    const summary = await pipeline.run({ indexRunId: "run-3", mode: "incremental" });

    const deleteByPathSpy = getMock(vectorStore.deleteByPath);
    const manifestUpsertSpy = getMock(manifest.upsert);

    expect(deleteByPathSpy.mock.calls).toEqual([[candidate.path]]);
    expect(calls).toEqual(["delete", "upsert", "manifest-upsert"]);
    expect(summary.chunksPurged).toBe(2);
    expect(summary.chunksWritten).toBe(2);
    expect(manifestUpsertSpy.mock.calls).toHaveLength(1);
    expect(manifestUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        chunkKeys: expect.any(Array) as string[],
        fileFingerprint: expect.any(String) as string,
        path: candidate.path,
      }),
    );
  });

  it("logs failures and continues processing later files", async () => {
    const badCandidate = createCandidate("src/bad.ts");
    const goodCandidate = createCandidate("src/good.ts");
    const goodDocument = createDocument(goodCandidate, "export const good = true;\n");
    const goodChunk = createChunk({
      content: goodDocument.content,
      evidenceId: "evidence-good",
      path: goodCandidate.path,
    });

    const logger = createLogger();
    const { pipeline, vectorStore, manifest } = createPipeline({
      logger,
      scanner: {
        scan: vi.fn().mockResolvedValue({
          candidates: [badCandidate, goodCandidate],
          skipped: [],
        }),
      },
      parser: {
        parse: vi
          .fn()
          .mockRejectedValueOnce(new Error("parse failed"))
          .mockResolvedValueOnce(goodDocument),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([goodChunk]),
      },
      embedding: {
        embedChunks: vi.fn().mockResolvedValue([
          { evidenceId: "evidence-good", vector: [5, 6, 7] },
        ]),
      },
    });

    const summary = await pipeline.run({ indexRunId: "run-4", mode: "incremental" });

    const upsertSpy = getMock(vectorStore.upsert);
    const manifestUpsertSpy = getMock(manifest.upsert);

    expect(summary.counters).toEqual({ errors: 1, filesIndexed: 1, filesTotal: 2 });
    expect(summary.progress.filesProcessed).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith("Failed to ingest file", {
      error: "parse failed",
      path: badCandidate.path,
    });
    expect(upsertSpy.mock.calls).toHaveLength(1);
    expect(manifestUpsertSpy.mock.calls).toHaveLength(1);
  });

  it("purges stale manifest entries missing from the current scan", async () => {
    const currentCandidate = createCandidate("src/current.ts");
    const currentDocument = createDocument(currentCandidate, "export const current = true;\n");
    const currentChunk = createChunk({
      content: currentDocument.content,
      evidenceId: "evidence-current",
      path: currentCandidate.path,
    });
    const staleEntry = createManifestEntry({
      chunkKeys: ["stale-1", "stale-2", "stale-3"],
      path: "src/stale.ts",
    });

    const { pipeline, vectorStore, manifest } = createPipeline({
      scanner: {
        scan: vi.fn().mockResolvedValue({ candidates: [currentCandidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(currentDocument),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([currentChunk]),
      },
      embedding: {
        embedChunks: vi.fn().mockResolvedValue([
          { evidenceId: "evidence-current", vector: [9, 9, 9] },
        ]),
      },
      manifest: {
        getAll: vi.fn().mockResolvedValue([staleEntry]),
      },
    });

    const summary = await pipeline.run({ indexRunId: "run-5", mode: "incremental" });

    const deleteByPathSpy = getMock(vectorStore.deleteByPath);
    const manifestDeleteByPathSpy = getMock(manifest.deleteByPath);

    expect(deleteByPathSpy.mock.calls).toEqual([[staleEntry.path]]);
    expect(manifestDeleteByPathSpy.mock.calls).toEqual([[staleEntry.path]]);
    expect(summary.filesPurged).toBe(1);
    expect(summary.chunksPurged).toBe(3);
  });
});
