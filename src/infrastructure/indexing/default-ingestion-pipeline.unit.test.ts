/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { DefaultIngestionPipeline } from "./default-ingestion-pipeline.js";
import { InternalGraphProjector } from "./internal-graph-projector.js";
import type {
  DocumentChunk,
  ParsedDocument,
  ScanCandidate,
  ScanResult,
} from "../../application/dto/ingestion.js";
import type {
  FileManifestEntry,
  PersistedChunkRecord,
} from "../../application/dto/storage.js";
import type { PersistedStructuredObservationRecord } from "../../application/dto/structured-observations.js";
import type {
  PersistedCanonicalFactRecord,
  PersistedDerivedFactRecord,
  PersistedSymbolCandidateRecord,
} from "../../application/dto/structured-records.js";
import type { CanonicalFactStorePort } from "../../application/ports/canonical-fact-store-port.js";
import type { ChunkerPort } from "../../application/ports/chunker-port.js";
import type { DerivedFactStorePort } from "../../application/ports/derived-fact-store-port.js";
import type { DocumentManifestPort } from "../../application/ports/document-manifest-port.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { FileScannerPort } from "../../application/ports/file-scanner-port.js";
import type { InternalGraphStorePort } from "../../application/ports/internal-graph-store-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { OverlayBuilderPort } from "../../application/ports/overlay-builder-port.js";
import type { OverlayStorePort } from "../../application/ports/overlay-store-port.js";
import type { ParserPort } from "../../application/ports/parser-port.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";
import type { StructuredAnalyzerRegistryPort } from "../../application/ports/structured-analyzer-registry-port.js";
import type { StructuredDataProjectorPort } from "../../application/ports/structured-data-projector-port.js";
import type { StructuredObservationStorePort } from "../../application/ports/structured-observation-store-port.js";
import type { SymbolCandidateStorePort } from "../../application/ports/symbol-candidate-store-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";

function createLogger(): LoggerPort & {
  child: ReturnType<typeof vi.fn>;
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
    artifactKind: "code",
    path,
    sizeBytes: 100,
    sourceType: "code",
  };
}

function createDocument(
  candidate: ScanCandidate,
  content: string,
): ParsedDocument {
  return {
    artifactKind: candidate.artifactKind,
    content,
    language: "ts",
    path: candidate.path,
    sourceType: candidate.sourceType,
    structuralBlocks: [
      {
        content,
        kind: "function_declaration",
        location: {
          endLine: 1,
          startLine: 1,
        },
      },
    ],
  };
}

function createStructuredObservation(
  path: string,
): PersistedStructuredObservationRecord {
  return {
    codeLocation: { endLine: 1, startLine: 1 },
    confidence: 0.9,
    contentHash: "obs-hash",
    evidenceId: `obs:${path}`,
    extractor: "ast-grep:test",
    fileFingerprint: "file-fingerprint",
    indexRunId: "run-1",
    kind: "symbol_definition",
    language: "ts",
    name: "example",
    path,
    sourceType: "code",
    symbolKind: "function",
  };
}

function createPartitionedDocument(candidate: ScanCandidate): ParsedDocument {
  return {
    artifactKind: candidate.artifactKind,
    content: ["const first = 1;", "const second = 2;"].join("\n"),
    language: "ts",
    partitions: [
      {
        content: "const first = 1;",
        index: 0,
        location: { endLine: 1, startLine: 1 },
        partitionId: `${candidate.path}:0`,
        status: "partial",
        total: 2,
      },
      {
        content: "const second = 2;",
        index: 1,
        location: { endLine: 2, startLine: 2 },
        partitionId: `${candidate.path}:1`,
        status: "complete",
        total: 2,
      },
    ],
    path: candidate.path,
    sourceType: candidate.sourceType,
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

function createManifestEntry(
  overrides: Partial<FileManifestEntry> = {},
): FileManifestEntry {
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
  graphProjector?: StructuredDataProjectorPort;
  logger?: ReturnType<typeof createLogger>;
  manifest?: Partial<DocumentManifestPort>;
  parser?: Partial<ParserPort>;
  scanner?: Partial<FileScannerPort>;
  structuredAnalyzers?: StructuredAnalyzerPort[];
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
    embedChunks: vi
      .fn<
        (
          chunks: Array<{
            content: string;
            contentHash: string;
            evidenceId: string;
            path: string;
            sourceType: "code" | "doc";
          }>,
        ) => Promise<Array<{ evidenceId: string; vector: number[] }>>
      >()
      .mockResolvedValue([]),
    embedQuery: vi.fn(),
    ...options.embedding,
  };
  const vectorStore: VectorStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    listRecords: vi
      .fn<() => Promise<PersistedChunkRecord[]>>()
      .mockResolvedValue([]),
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
  const symbolCandidates: SymbolCandidateStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    list: vi
      .fn<() => Promise<PersistedSymbolCandidateRecord[]>>()
      .mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const structuredObservations: StructuredObservationStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    list: vi
      .fn<() => Promise<PersistedStructuredObservationRecord[]>>()
      .mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const canonicalFacts: CanonicalFactStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    list: vi
      .fn<() => Promise<PersistedCanonicalFactRecord[]>>()
      .mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const derivedFacts: DerivedFactStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    list: vi
      .fn<() => Promise<PersistedDerivedFactRecord[]>>()
      .mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const internalGraph: InternalGraphStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    listByPath: vi.fn().mockResolvedValue({ edges: [], nodes: [] }),
    listEdgesByNode: vi.fn().mockResolvedValue([]),
    listNodesByPath: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({ edges: [], nodes: [] }),
    readOverlays: vi.fn().mockResolvedValue({ records: [] }),
    replace: vi.fn().mockResolvedValue(undefined),
    replaceOverlays: vi.fn().mockResolvedValue(undefined),
  };
  const overlayStore: OverlayStorePort = {
    clear: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue({ records: [] }),
    replace: vi.fn().mockResolvedValue(undefined),
  };
  const overlayBuilder: OverlayBuilderPort = {
    build: vi.fn().mockResolvedValue([]),
  };
  const graphProjector: StructuredDataProjectorPort =
    options.graphProjector ?? new InternalGraphProjector();
  const structuredAnalyzerRegistry: StructuredAnalyzerRegistryPort = {
    select: vi.fn().mockImplementation(() => options.structuredAnalyzers ?? []),
  };
  const logger = options.logger ?? createLogger();

  const pipeline = new DefaultIngestionPipeline(
    scanner,
    parser,
    chunker,
    embedding,
    vectorStore,
    manifest,
    symbolCandidates,
    structuredObservations,
    structuredAnalyzerRegistry,
    canonicalFacts,
    derivedFacts,
    internalGraph,
    overlayStore,
    overlayBuilder,
    graphProjector,
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
    canonicalFacts,
    chunker,
    derivedFacts,
    embedding,
    graphProjector,
    internalGraph,
    logger,
    manifest,
    overlayStore,
    parser,
    pipeline,
    scanner,
    structuredAnalyzerRegistry,
    structuredObservations,
    symbolCandidates,
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
    const document = createDocument(
      candidate,
      "export const rebuild = true;\n",
    );
    const chunk = createChunk({
      content: document.content,
      evidenceId: "evidence-1",
      path: candidate.path,
    });
    const calls: string[] = [];

    const {
      pipeline,
      vectorStore,
      manifest,
      symbolCandidates,
      structuredObservations,
      canonicalFacts,
      derivedFacts,
      internalGraph,
      overlayStore,
    } = createPipeline({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([chunk]),
      },
      embedding: {
        embedChunks: vi
          .fn()
          .mockResolvedValue([{ evidenceId: "evidence-1", vector: [1, 2, 3] }]),
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

    const summary = await pipeline.run({
      indexRunId: "run-1",
      mode: "rebuild",
    });

    const clearVectorStore = getMock(vectorStore.clear);
    const clearManifest = getMock(manifest.clear);
    const clearSymbolCandidates = getMock(symbolCandidates.clear);
    const clearStructuredObservations = getMock(structuredObservations.clear);
    const clearCanonicalFacts = getMock(canonicalFacts.clear);
    const clearDerivedFacts = getMock(derivedFacts.clear);
    const clearInternalGraph = getMock(internalGraph.clear);
    const clearOverlayStore = getMock(overlayStore.clear);

    expect(clearVectorStore.mock.calls).toHaveLength(1);
    expect(clearManifest.mock.calls).toHaveLength(1);
    expect(clearSymbolCandidates.mock.calls).toHaveLength(1);
    expect(clearStructuredObservations.mock.calls).toHaveLength(1);
    expect(clearCanonicalFacts.mock.calls).toHaveLength(1);
    expect(clearDerivedFacts.mock.calls).toHaveLength(1);
    expect(clearInternalGraph.mock.calls).toHaveLength(1);
    expect(clearOverlayStore.mock.calls).toHaveLength(1);
    expect(calls).toEqual([
      "clear-vector",
      "clear-manifest",
      "upsert-vector",
      "upsert-manifest",
    ]);
    expect(summary.counters).toEqual({
      errors: 0,
      filesIndexed: 1,
      filesTotal: 1,
    });
  });

  it("short-circuits unchanged files without downstream writes", async () => {
    const candidate = createCandidate("src/unchanged.ts");
    const document = createDocument(candidate, "export const stable = true;\n");
    const manifestEntry = createManifestEntry({
      fileFingerprint:
        "e9446810aede94ee09fd0720cafe0f6d15f9b35dbcda662bcaf3d63d7009c479",
      path: candidate.path,
    });

    const {
      pipeline,
      chunker,
      embedding,
      vectorStore,
      manifest,
      symbolCandidates,
      structuredObservations,
    } = createPipeline({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      manifest: {
        getAll: vi.fn().mockResolvedValue([manifestEntry]),
      },
      graphProjector: {
        project: vi.fn().mockReturnValue({ edges: [], nodes: [] }),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-2",
      mode: "incremental",
    });

    const chunkSpy = getMock(chunker.chunk);
    const embedChunksSpy = getMock(embedding.embedChunks);
    const upsertSpy = getMock(vectorStore.upsert);
    const manifestUpsertSpy = getMock(manifest.upsert);
    const symbolUpsertSpy = getMock(symbolCandidates.upsert);
    const observationUpsertSpy = getMock(structuredObservations.upsert);

    expect(summary.counters).toEqual({
      errors: 0,
      filesIndexed: 1,
      filesTotal: 1,
    });
    expect(summary.filesUnchanged).toBe(1);
    expect(summary.chunksWritten).toBe(0);
    expect(chunkSpy.mock.calls).toHaveLength(0);
    expect(embedChunksSpy.mock.calls).toHaveLength(0);
    expect(upsertSpy.mock.calls).toHaveLength(0);
    expect(symbolUpsertSpy.mock.calls).toHaveLength(0);
    expect(observationUpsertSpy.mock.calls).toHaveLength(0);
    expect(manifestUpsertSpy.mock.calls).toHaveLength(0);
  });

  it("purges an existing file before rewriting updated chunks", async () => {
    const candidate = createCandidate("src/changed.ts");
    const document = createDocument(candidate, "export const changed = 2;\n");
    const chunks = [
      createChunk({
        content: "chunk one",
        evidenceId: "evidence-1",
        path: candidate.path,
      }),
      createChunk({
        content: "chunk two",
        evidenceId: "evidence-2",
        path: candidate.path,
      }),
    ];
    const manifestEntry = createManifestEntry({
      chunkKeys: ["old-1", "old-2"],
      fileFingerprint: "fingerprint-old",
      path: candidate.path,
    });
    const calls: string[] = [];

    const {
      pipeline,
      vectorStore,
      manifest,
      symbolCandidates,
      structuredObservations,
    } = createPipeline({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
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
      structuredAnalyzers: [
        {
          analyze: vi
            .fn()
            .mockResolvedValue([createStructuredObservation(candidate.path)]),
          supports: vi.fn().mockReturnValue(true),
        },
      ],
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
      graphProjector: {
        project: vi.fn().mockReturnValue({ edges: [], nodes: [] }),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-3",
      mode: "incremental",
    });

    const deleteByPathSpy = getMock(vectorStore.deleteByPath);
    const symbolDeleteByPathSpy = getMock(symbolCandidates.deleteByPath);
    const observationDeleteByPathSpy = getMock(
      structuredObservations.deleteByPath,
    );
    const symbolUpsertSpy = getMock(symbolCandidates.upsert);
    const observationUpsertSpy = getMock(structuredObservations.upsert);
    const manifestUpsertSpy = getMock(manifest.upsert);

    expect(deleteByPathSpy.mock.calls).toEqual([[candidate.path]]);
    expect(symbolDeleteByPathSpy.mock.calls).toEqual([[candidate.path]]);
    expect(observationDeleteByPathSpy.mock.calls).toEqual([[candidate.path]]);
    expect(calls).toEqual(["delete", "upsert", "manifest-upsert"]);
    expect(summary.chunksPurged).toBe(2);
    expect(summary.chunksWritten).toBe(2);
    expect(symbolUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codeLocation: { endLine: 1, startLine: 1 },
          kind: "variable",
          name: "changed",
          path: candidate.path,
          sourceType: "code",
        }),
      ]),
    );
    expect(observationUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "symbol_definition",
          path: candidate.path,
          sourceType: "code",
        }),
      ]),
    );
    expect(manifestUpsertSpy.mock.calls).toHaveLength(1);
    expect(manifestUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        artifactKind: candidate.artifactKind,
        chunkKeys: expect.any(Array) as string[],
        fileFingerprint: expect.any(String) as string,
        latestPartitionStatus: undefined,
        partitionCount: undefined,
        path: candidate.path,
      }),
    );
  });

  it("persists partition metadata for partial ingestion success", async () => {
    const candidate = createCandidate("src/partitioned.ts");
    const document = createPartitionedDocument(candidate);
    const chunks = [
      createChunk({
        content: "const first = 1;",
        evidenceId: "evidence-1",
        path: candidate.path,
      }),
      createChunk({
        content: "const second = 2;",
        evidenceId: "evidence-2",
        path: candidate.path,
      }),
    ];

    const { pipeline, manifest } = createPipeline({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue(chunks),
      },
      embedding: {
        embedChunks: vi.fn().mockResolvedValue([
          { evidenceId: "evidence-1", vector: [1, 2, 3] },
          { evidenceId: "evidence-2", vector: [4, 5, 6] },
        ]),
      },
      graphProjector: {
        project: vi.fn().mockReturnValue({ edges: [], nodes: [] }),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-partial",
      mode: "full",
    });

    const manifestUpsertSpy = getMock(manifest.upsert);
    expect(summary.counters).toEqual({
      errors: 0,
      filesIndexed: 1,
      filesTotal: 1,
    });
    expect(manifestUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        latestPartitionStatus: "partial",
        partitionCount: 2,
        path: candidate.path,
      }),
    );
  });

  it("indexes degraded oversized valuable files without inflating ingestion errors", async () => {
    const candidate: ScanCandidate = {
      absolutePath: "/repo/architecture.md",
      artifactKind: "doc",
      path: "architecture.md",
      sizeBytes: 10_000,
      sourceType: "doc",
    };
    const document: ParsedDocument = {
      artifactKind: "doc",
      content: "# Architecture\n\nimportant system overview",
      language: null,
      partitions: [
        {
          content: "# Architecture",
          index: 0,
          location: { section: "Architecture" },
          partitionId: "architecture.md:0",
          status: "degraded",
          total: 1,
        },
      ],
      path: candidate.path,
      sourceType: "doc",
    };
    const chunk: DocumentChunk = {
      content: document.content,
      contentHash: "architecture-hash",
      docLocation: { section: "Architecture" },
      evidenceId: "architecture-evidence",
      extractor: "test-extractor",
      indexRunId: "run-degraded",
      partitionId: "architecture.md:0",
      partitionIndex: 0,
      partitionStatus: "degraded",
      partitionTotal: 1,
      path: candidate.path,
      sourceType: "doc",
    };

    const logger = createLogger();
    const { pipeline, manifest, vectorStore } = createPipeline({
      logger,
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([chunk]),
      },
      embedding: {
        embedChunks: vi
          .fn()
          .mockResolvedValue([
            { evidenceId: "architecture-evidence", vector: [1, 2, 3] },
          ]),
      },
      vectorStore: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-degraded",
      mode: "full",
    });

    expect(summary.counters).toEqual({
      errors: 0,
      filesIndexed: 1,
      filesTotal: 1,
    });
    expect(getMock(manifest.upsert).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        latestPartitionStatus: "degraded",
        partitionCount: 1,
        path: candidate.path,
      }),
    );
    expect(getMock(vectorStore.upsert).mock.calls).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Failed to ingest file",
      expect.objectContaining({ path: candidate.path }),
    );
  });

  it("returns scanner too_large skips without inflating ingestion errors", async () => {
    const logger = createLogger();
    const { pipeline, parser, chunker, embedding } = createPipeline({
      logger,
      scanner: {
        scan: vi.fn().mockResolvedValue({
          candidates: [],
          skipped: [{ path: "package-lock.json", reason: "too_large" }],
        }),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-too-large-skip",
      mode: "full",
    });

    expect(summary.skipped).toEqual([
      { path: "package-lock.json", reason: "too_large" },
    ]);
    expect(summary.counters).toEqual({
      errors: 0,
      filesIndexed: 0,
      filesTotal: 0,
    });
    expect(getMock(parser.parse)).not.toHaveBeenCalled();
    expect(getMock(chunker.chunk)).not.toHaveBeenCalled();
    expect(getMock(embedding.embedChunks)).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Failed to ingest file",
      expect.objectContaining({ path: "package-lock.json" }),
    );
  });

  it("logs failures and continues processing later files", async () => {
    const badCandidate = createCandidate("src/bad.ts");
    const goodCandidate = createCandidate("src/good.ts");
    const goodDocument = createDocument(
      goodCandidate,
      "export const good = true;\n",
    );
    const goodChunk = createChunk({
      content: goodDocument.content,
      evidenceId: "evidence-good",
      path: goodCandidate.path,
    });

    const logger = createLogger();
    const {
      pipeline,
      vectorStore,
      manifest,
      symbolCandidates,
      structuredObservations,
    } = createPipeline({
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
        embedChunks: vi
          .fn()
          .mockResolvedValue([
            { evidenceId: "evidence-good", vector: [5, 6, 7] },
          ]),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-4",
      mode: "incremental",
    });

    const upsertSpy = getMock(vectorStore.upsert);
    const symbolUpsertSpy = getMock(symbolCandidates.upsert);
    const observationUpsertSpy = getMock(structuredObservations.upsert);
    const manifestUpsertSpy = getMock(manifest.upsert);

    expect(summary.counters).toEqual({
      errors: 1,
      filesIndexed: 1,
      filesTotal: 2,
    });
    expect(summary.progress.filesProcessed).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith("Failed to ingest file", {
      error: "parse failed",
      path: badCandidate.path,
    });
    expect(upsertSpy.mock.calls).toHaveLength(1);
    expect(symbolUpsertSpy.mock.calls).toHaveLength(1);
    expect(observationUpsertSpy.mock.calls).toHaveLength(1);
    expect(manifestUpsertSpy.mock.calls).toHaveLength(1);
  });

  it("extracts and persists symbol candidates from structural blocks", async () => {
    const candidate = createCandidate("src/symbols.ts");
    const document = createDocument(
      candidate,
      "export const answer = 42;\nexport function greet() {\n  return 'hi';\n}\n",
    );
    const chunk = createChunk({
      content: document.content,
      evidenceId: "evidence-symbols",
      path: candidate.path,
    });
    const structuredAnalyzer: StructuredAnalyzerPort = {
      analyze: vi
        .fn()
        .mockResolvedValue([createStructuredObservation(candidate.path)]),
      supports: vi.fn().mockReturnValue(true),
    };

    const { pipeline, symbolCandidates, structuredObservations } =
      createPipeline({
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue({ candidates: [candidate], skipped: [] }),
        },
        parser: {
          parse: vi.fn().mockResolvedValue({
            ...document,
            structuralBlocks: [
              {
                content: "export const answer = 42;",
                kind: "lexical_declaration",
                location: { endLine: 1, startLine: 1 },
              },
              {
                content: "export function greet() {\n  return 'hi';\n}",
                kind: "function_declaration",
                location: { endLine: 3, startLine: 2 },
              },
            ],
          }),
        },
        chunker: {
          chunk: vi.fn().mockResolvedValue([chunk]),
        },
        embedding: {
          embedChunks: vi
            .fn()
            .mockResolvedValue([
              { evidenceId: "evidence-symbols", vector: [1, 1, 1] },
            ]),
        },
        structuredAnalyzers: [structuredAnalyzer],
      });

    await pipeline.run({ indexRunId: "run-symbols", mode: "full" });

    const symbolUpsertSpy = getMock(symbolCandidates.upsert);
    const observationUpsertSpy = getMock(structuredObservations.upsert);
    expect(symbolUpsertSpy.mock.calls).toHaveLength(1);
    expect(symbolUpsertSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        kind: "variable",
        name: "answer",
        path: candidate.path,
        sourceType: "code",
      }),
      expect.objectContaining({
        kind: "function",
        name: "greet",
        path: candidate.path,
        sourceType: "code",
      }),
    ]);
    expect(observationUpsertSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        kind: "symbol_definition",
        path: candidate.path,
        sourceType: "code",
      }),
    ]);
  });

  it("records structured observations and tolerates analyzer failures", async () => {
    const candidate = createCandidate("src/structured.ts");
    const document = createDocument(
      candidate,
      "export function structured() { return true; }\n",
    );
    const chunk = createChunk({
      content: document.content,
      evidenceId: "evidence-structured",
      path: candidate.path,
    });
    const logger = createLogger();

    const { pipeline, structuredObservations, vectorStore } = createPipeline({
      logger,
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([chunk]),
      },
      embedding: {
        embedChunks: vi
          .fn()
          .mockResolvedValue([
            { evidenceId: "evidence-structured", vector: [1, 2, 3] },
          ]),
      },
      structuredAnalyzers: [
        {
          analyze: vi.fn().mockRejectedValue(new Error("structured explode")),
          supports: vi.fn().mockReturnValue(true),
        },
        {
          analyze: vi
            .fn()
            .mockResolvedValue([createStructuredObservation(candidate.path)]),
          supports: vi.fn().mockReturnValue(true),
        },
      ],
      graphProjector: {
        project: vi.fn().mockReturnValue({ edges: [], nodes: [] }),
      },
    });

    const summary = await pipeline.run({
      indexRunId: "run-structured",
      mode: "full",
    });

    const observationUpsertSpy = getMock(structuredObservations.upsert);
    const vectorUpsertSpy = getMock(vectorStore.upsert);

    expect(summary.counters.errors).toBe(0);
    expect(summary.observations).toEqual([
      expect.objectContaining({
        kind: "symbol_definition",
        path: candidate.path,
      }),
    ]);
    expect(observationUpsertSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        kind: "symbol_definition",
        path: candidate.path,
      }),
    ]);
    expect(vectorUpsertSpy.mock.calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Structured analyzer failed; continuing with text indexing",
      expect.objectContaining({
        error: "structured explode",
        path: candidate.path,
      }),
    );
  });

  it("projects workflow, task, and export facts into structured stores and graph", async () => {
    const candidate = createCandidate(".github/workflows/ci.yml");
    const document: ParsedDocument = {
      content: "name: CI\nsteps:\n  - name: Lint\n    run: npm run lint\n",
      language: "yaml",
      path: candidate.path,
      qualityGates: [{ command: "npm run lint", tool: "eslint" }],
      sourceType: "doc",
      workflowSteps: [
        { command: "npm run lint", name: "Lint", scriptName: "lint" },
      ],
    };
    const chunk = {
      content: document.content,
      contentHash: "workflow-hash",
      evidenceId: "workflow-evidence",
      extractor: "test-extractor",
      indexRunId: "run-graph",
      path: candidate.path,
      sourceType: "doc" as const,
    };

    const { pipeline, canonicalFacts, derivedFacts, internalGraph } =
      createPipeline({
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue({ candidates: [candidate], skipped: [] }),
        },
        parser: {
          parse: vi.fn().mockResolvedValue(document),
        },
        chunker: {
          chunk: vi.fn().mockResolvedValue([chunk]),
        },
        embedding: {
          embedChunks: vi
            .fn()
            .mockResolvedValue([
              { evidenceId: "workflow-evidence", vector: [1, 2, 3] },
            ]),
        },
        structuredAnalyzers: [
          {
            analyze: vi.fn().mockResolvedValue([
              {
                confidence: 0.9,
                contentHash: "workflow-content",
                evidenceId: "workflow-observation",
                extractor: "artifact:repo-config",
                indexRunId: "run-graph",
                kind: "workflow",
                language: "yaml",
                name: ".github/workflows/ci.yml",
                path: candidate.path,
                sourceType: "doc",
                symbolKind: "workflow",
              },
              {
                confidence: 0.9,
                contentHash: "task-content",
                evidenceId: "task-observation",
                extractor: "artifact:repo-config",
                indexRunId: "run-graph",
                kind: "task",
                language: "yaml",
                metadata: { command: "npm run lint" },
                name: "lint",
                path: candidate.path,
                sourceType: "doc",
                symbolKind: "package-script",
              },
              {
                codeLocation: { endLine: 1, startLine: 1 },
                confidence: 0.9,
                contentHash: "export-content",
                evidenceId: "export-observation",
                extractor: "custom:ts-js-deep",
                indexRunId: "run-graph",
                kind: "symbol_export",
                language: "ts",
                name: "build",
                path: candidate.path,
                sourceType: "doc",
                symbolKind: "function",
              },
            ]),
            supports: vi.fn().mockReturnValue(true),
          },
        ],
        graphProjector: {
          project: vi.fn().mockReturnValue({
            edges: [
              {
                edgeId: "edge-1",
                fromNodeId: "workflow",
                kind: "REPRESENTS",
                path: candidate.path,
                sourceType: "doc",
                toNodeId: "workflow-node",
              },
              {
                edgeId: "edge-2",
                fromNodeId: "workflow",
                kind: "workflow-contains-job",
                path: candidate.path,
                sourceType: "doc",
                toNodeId: "job-node",
              },
              {
                edgeId: "edge-3",
                fromNodeId: "task",
                kind: "task-runs-command",
                path: candidate.path,
                sourceType: "doc",
                toNodeId: "command-node",
              },
            ],
            nodes: [
              {
                nodeId: "workflow-node",
                kind: "Workflow",
                label: "workflow",
                path: candidate.path,
                sourceType: "doc",
              },
              {
                nodeId: "job-node",
                kind: "WorkflowJob",
                label: "Lint",
                path: candidate.path,
                sourceType: "doc",
              },
              {
                nodeId: "step-node",
                kind: "WorkflowStep",
                label: "Lint",
                path: candidate.path,
                sourceType: "doc",
              },
              {
                nodeId: "task-node",
                kind: "Task",
                label: "lint",
                path: candidate.path,
                sourceType: "doc",
              },
              {
                nodeId: "symbol-node",
                kind: "Symbol",
                label: "build",
                path: candidate.path,
                sourceType: "doc",
              },
            ],
          }),
        },
      });

    await pipeline.run({ indexRunId: "run-graph", mode: "full" });

    const canonicalUpsertSpy = getMock(canonicalFacts.upsert);
    const derivedUpsertSpy = getMock(derivedFacts.upsert);
    const graphReplaceSpy = getMock(internalGraph.replace);

    expect(canonicalUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow", path: candidate.path }),
        expect.objectContaining({
          kind: "workspace_task",
          path: candidate.path,
        }),
        expect.objectContaining({
          kind: "symbol_export",
          path: candidate.path,
        }),
      ]),
    );
    expect(derivedUpsertSpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow-contains-job",
          path: candidate.path,
        }),
        expect.objectContaining({
          kind: "job-runs-step",
          path: candidate.path,
        }),
        expect.objectContaining({
          kind: "task-runs-command",
          path: candidate.path,
        }),
        expect.objectContaining({
          kind: "symbol-exported-from-file",
          path: candidate.path,
        }),
      ]),
    );
    const projectedGraph = graphReplaceSpy.mock.calls[0][0] as {
      edges: Array<{ kind: string; path: string }>;
      nodes: Array<{ kind: string; path: string }>;
    };
    expect(projectedGraph).toEqual(
      expect.objectContaining({
        edges: expect.arrayContaining([
          expect.objectContaining({ kind: "REPRESENTS", path: candidate.path }),
          expect.objectContaining({
            kind: "workflow-contains-job",
            path: candidate.path,
          }),
          expect.objectContaining({
            kind: "task-runs-command",
            path: candidate.path,
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({ kind: "Workflow", path: candidate.path }),
          expect.objectContaining({
            kind: "WorkflowJob",
            path: candidate.path,
          }),
          expect.objectContaining({
            kind: "WorkflowStep",
            path: candidate.path,
          }),
          expect.objectContaining({ kind: "Task", path: candidate.path }),
          expect.objectContaining({ kind: "Symbol", path: candidate.path }),
        ]),
      }),
    );
  });

  it("keeps graph node ids stable for canonical domain nodes", async () => {
    const candidate = createCandidate("src/stable.ts");
    const document = createDocument(candidate, "export const stable = true;\n");
    const chunk = createChunk({
      content: document.content,
      evidenceId: "stable-evidence",
      path: candidate.path,
    });
    const expectedSymbolNodeId = createHash("sha256")
      .update("Symbol:stable")
      .digest("hex");

    const { pipeline, internalGraph } = createPipeline({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ candidates: [candidate], skipped: [] }),
      },
      parser: {
        parse: vi.fn().mockResolvedValue(document),
      },
      chunker: {
        chunk: vi.fn().mockResolvedValue([chunk]),
      },
      embedding: {
        embedChunks: vi
          .fn()
          .mockResolvedValue([
            { evidenceId: "stable-evidence", vector: [1, 1, 1] },
          ]),
      },
      structuredAnalyzers: [
        {
          analyze: vi.fn().mockResolvedValue([
            {
              codeLocation: { endLine: 1, startLine: 1 },
              confidence: 0.9,
              contentHash: "stable-export",
              evidenceId: "stable-export-observation",
              extractor: "custom:ts-js-deep",
              indexRunId: "run-stable",
              kind: "symbol_export",
              language: "ts",
              name: "stable",
              path: candidate.path,
              sourceType: "code",
              symbolKind: "variable",
            },
          ]),
          supports: vi.fn().mockReturnValue(true),
        },
      ],
      graphProjector: {
        project: vi.fn().mockReturnValue({
          edges: [],
          nodes: [
            {
              nodeId: expectedSymbolNodeId,
              kind: "Symbol",
              label: "stable",
              path: candidate.path,
              sourceType: "code",
            },
          ],
        }),
      },
    });

    await pipeline.run({ indexRunId: "run-stable", mode: "full" });

    const graphReplaceSpy = getMock(internalGraph.replace);
    const graph = graphReplaceSpy.mock.calls[0][0] as {
      nodes: Array<{ kind: string; nodeId: string; path: string }>;
    };
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Symbol",
          nodeId: expectedSymbolNodeId,
          path: candidate.path,
        }),
      ]),
    );
  });
});
