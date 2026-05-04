import { createHash } from "node:crypto";

import type {
  ChunkingOptions,
  DocumentChunk,
  IngestionCounters,
  IngestionSummary,
  ParsedDocument,
  StructuralCodeBlock,
} from "../../application/dto/ingestion.js";
import type { PersistedChunkRecord } from "../../application/dto/storage.js";
import type {
  PersistedStructuredObservationRecord,
  StructuredObservation,
} from "../../application/dto/structured-observations.js";
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
import type { IngestionPipelinePort } from "../../application/ports/ingestion-pipeline-port.js";
import type { InternalGraphStorePort } from "../../application/ports/internal-graph-store-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { ParserPort } from "../../application/ports/parser-port.js";
import type { StructuredAnalyzerRegistryPort } from "../../application/ports/structured-analyzer-registry-port.js";
import type { StructuredDataProjectorPort } from "../../application/ports/structured-data-projector-port.js";
import type { StructuredObservationStorePort } from "../../application/ports/structured-observation-store-port.js";
import type { SymbolCandidateStorePort } from "../../application/ports/symbol-candidate-store-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";
import { inferSymbolIdentity } from "../../domain/index.js";

export class DefaultIngestionPipeline implements IngestionPipelinePort {
  constructor(
    private readonly scanner: FileScannerPort,
    private readonly parser: ParserPort,
    private readonly chunker: ChunkerPort,
    private readonly embedding: EmbeddingPort,
    private readonly vectorStore: VectorStorePort,
    private readonly manifest: DocumentManifestPort,
    private readonly symbolCandidates: SymbolCandidateStorePort,
    private readonly structuredObservations: StructuredObservationStorePort,
    private readonly structuredAnalyzers: StructuredAnalyzerRegistryPort,
    private readonly canonicalFacts: CanonicalFactStorePort,
    private readonly derivedFacts: DerivedFactStorePort,
    private readonly internalGraph: InternalGraphStorePort,
    private readonly graphProjector: StructuredDataProjectorPort,
    private readonly logger: LoggerPort,
    private readonly context: {
      activeProjectIdentity: string;
      chunking: ChunkingOptions;
      embeddingBatchSize: number;
      fileScanBatchSize: number;
      indexCheckpointEveryBatches: number;
      vectorUpsertBatchSize: number;
    },
  ) {}

  async run(context: {
    indexRunId: string;
    mode: "full" | "incremental" | "rebuild";
  }): Promise<IngestionSummary> {
    if (context.mode === "rebuild") {
      await this.vectorStore.clear();
      await this.manifest.clear();
      await this.symbolCandidates.clear();
      await this.structuredObservations.clear();
      await this.canonicalFacts.clear();
      await this.derivedFacts.clear();
      await this.internalGraph.clear();
    }

    const previousManifestEntries = await this.manifest.getAll();
    const previousManifestByPath = new Map(
      previousManifestEntries.map((entry) => [entry.path, entry]),
    );
    const scanResult = await this.scanner.scan();
    const currentPaths = new Set(
      scanResult.candidates.map((candidate) => candidate.path),
    );
    const chunks: DocumentChunk[] = [];
    const observations: StructuredObservation[] = [];
    const counters: IngestionCounters = {
      errors: 0,
      filesIndexed: 0,
      filesTotal: scanResult.candidates.length,
    };
    const batches = sliceIntoBatches(
      scanResult.candidates,
      this.context.fileScanBatchSize,
    ) as Array<typeof scanResult.candidates>;
    let chunksEmbedded = 0;
    let chunksPurged = 0;
    let chunksWritten = 0;
    let filesPurged = 0;
    let filesUnchanged = 0;
    let filesProcessed = 0;
    let checkpointWrittenAt: string | null = null;

    for (const [batchIndex, batch] of batches.entries()) {
      for (const candidate of batch) {
        try {
          const document = await this.parser.parse(candidate);
          const fileFingerprint = fingerprintDocument(document);
          const existingManifest = previousManifestByPath.get(candidate.path);

          if (existingManifest?.fileFingerprint === fileFingerprint) {
            filesUnchanged += 1;
            counters.filesIndexed += 1;
            continue;
          }

          const documentChunks = await this.chunker.chunk(document, {
            chunking: this.context.chunking,
            indexRunId: context.indexRunId,
          });
          chunks.push(...documentChunks);

          if (existingManifest) {
            await this.vectorStore.deleteByPath(candidate.path);
            await this.symbolCandidates.deleteByPath(candidate.path);
            await this.structuredObservations.deleteByPath(candidate.path);
            await this.canonicalFacts.deleteByPath(candidate.path);
            await this.derivedFacts.deleteByPath(candidate.path);
            await this.internalGraph.deleteByPath(candidate.path);
            chunksPurged += existingManifest.chunkKeys.length;
          }

          const embeddedChunks = await embedInBatches(
            this.embedding,
            documentChunks,
            this.context.embeddingBatchSize,
          );
          chunksEmbedded += embeddedChunks.length;

          const records = toPersistedRecords({
            activeProjectIdentity: this.context.activeProjectIdentity,
            chunks: documentChunks,
            embeddings: embeddedChunks,
            fileFingerprint,
          });
          const symbolCandidates = extractSymbolCandidates({
            activeProjectIdentity: this.context.activeProjectIdentity,
            document,
            fileFingerprint,
            indexRunId: context.indexRunId,
          });
          const structuredObservations = await analyzeStructuredObservations({
            analyzers: this.structuredAnalyzers,
            document,
            fileFingerprint,
            indexRunId: context.indexRunId,
            logger: this.logger,
          });
          observations.push(...structuredObservations.map((record) => stripFileFingerprint(record)));
          const canonicalFacts = normalizeCanonicalFacts({
            activeProjectIdentity: this.context.activeProjectIdentity,
            document,
            fileFingerprint,
            indexRunId: context.indexRunId,
            structuredObservations,
            symbolCandidates,
          });
          const derivedFacts = deriveFacts({
            canonicalFacts,
            document,
            fileFingerprint,
            indexRunId: context.indexRunId,
            symbolCandidates,
          });

          await upsertInBatches(
            this.vectorStore,
            records,
            this.context.vectorUpsertBatchSize,
          );
          chunksWritten += records.length;

          await this.symbolCandidates.upsert(symbolCandidates);
          await this.structuredObservations.upsert(structuredObservations);
          await persistStructuredData({
            canonicalFacts,
            derivedFacts,
            documentPath: candidate.path,
            graphProjector: this.graphProjector,
            internalGraph: this.internalGraph,
            canonicalFactStore: this.canonicalFacts,
            derivedFactStore: this.derivedFacts,
            logger: this.logger,
            symbolCandidates,
          });

          await this.manifest.upsert({
            chunkKeys: records.map((record) => record.chunkKey),
            fileFingerprint,
            indexRunId: context.indexRunId,
            lastIndexedAt: new Date().toISOString(),
            path: candidate.path,
            sourceType: candidate.sourceType,
          });

          counters.filesIndexed += 1;
          filesProcessed += 1;
        } catch (error) {
          counters.errors += 1;
          filesProcessed += 1;
          this.logger.warn("Failed to ingest file", {
            error: error instanceof Error ? error.message : String(error),
            path: candidate.path,
          });
        }

        this.logger.info("Processed index batch", {
          batchIndex: batchIndex + 1,
          batchTotal: batches.length,
          chunksWritten,
          event: "index.batch_processed",
          filesProcessed,
        });
      }

      if ((batchIndex + 1) % this.context.indexCheckpointEveryBatches === 0) {
        checkpointWrittenAt = new Date().toISOString();
      }
    }

    const staleEntries = previousManifestEntries.filter(
      (entry) => !currentPaths.has(entry.path),
    );
    for (const staleEntry of staleEntries) {
      await this.vectorStore.deleteByPath(staleEntry.path);
      await this.manifest.deleteByPath(staleEntry.path);
      await this.symbolCandidates.deleteByPath(staleEntry.path);
      await this.structuredObservations.deleteByPath(staleEntry.path);
      await this.canonicalFacts.deleteByPath(staleEntry.path);
      await this.derivedFacts.deleteByPath(staleEntry.path);
      await this.internalGraph.deleteByPath(staleEntry.path);
      filesPurged += 1;
      chunksPurged += staleEntry.chunkKeys.length;
    }

    return {
      chunks,
      chunksEmbedded,
      chunksPurged,
      chunksWritten,
      counters,
      filesPurged,
      filesUnchanged,
      observations,
      progress: {
        batchIndex: batches.length,
        batchTotal: batches.length,
        checkpointWrittenAt,
        chunksWritten,
        filesProcessed,
      },
      skipped: scanResult.skipped,
    };
  }
}

function sliceIntoBatches(items: unknown[], batchSize: number): unknown[][] {
  const batches: unknown[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

async function embedInBatches(
  embedding: EmbeddingPort,
  chunks: DocumentChunk[],
  batchSize: number,
): Promise<Awaited<ReturnType<EmbeddingPort["embedChunks"]>>> {
  const results: Awaited<ReturnType<EmbeddingPort["embedChunks"]>> = [];
  for (const batch of sliceIntoBatches(
    chunks,
    batchSize,
  ) as DocumentChunk[][]) {
    const embedded = await embedding.embedChunks(
      batch.map((chunk) => ({
        content: chunk.content,
        contentHash: chunk.contentHash,
        evidenceId: chunk.evidenceId,
        path: chunk.path,
        sourceType: chunk.sourceType,
      })),
    );
    results.push(...embedded);
  }
  return results;
}

async function upsertInBatches(
  vectorStore: VectorStorePort,
  records: PersistedChunkRecord[],
  batchSize: number,
): Promise<void> {
  for (const batch of sliceIntoBatches(
    records,
    batchSize,
  ) as PersistedChunkRecord[][]) {
    await vectorStore.upsert(batch);
  }
}

function fingerprintDocument(document: ParsedDocument): string {
  return createHash("sha256").update(document.content).digest("hex");
}

function toPersistedRecords(options: {
  activeProjectIdentity: string;
  chunks: DocumentChunk[];
  embeddings: Awaited<ReturnType<EmbeddingPort["embedChunks"]>>;
  fileFingerprint: string;
}): PersistedChunkRecord[] {
  const embeddingByEvidenceId = new Map(
    options.embeddings.map((embedding) => [
      embedding.evidenceId,
      embedding.vector,
    ]),
  );

  return options.chunks.map((chunk) => ({
    chunkKey: createHash("sha256")
      .update(
        [
          options.activeProjectIdentity,
          chunk.path,
          chunk.evidenceId,
          chunk.contentHash,
        ].join(":"),
      )
      .digest("hex"),
    content: chunk.content,
    contentHash: chunk.contentHash,
    embedding: embeddingByEvidenceId.get(chunk.evidenceId) ?? [],
    evidenceId: chunk.evidenceId,
    extractor: chunk.extractor,
    fileFingerprint: options.fileFingerprint,
    indexRunId: chunk.indexRunId,
    path: chunk.path,
    sourceType: chunk.sourceType,
    codeLocation: chunk.codeLocation,
    docLocation: chunk.docLocation,
  }));
}

function extractSymbolCandidates(options: {
  activeProjectIdentity: string;
  document: ParsedDocument;
  fileFingerprint: string;
  indexRunId: string;
}): PersistedSymbolCandidateRecord[] {
  if (options.document.sourceType !== "code") {
    return [];
  }

  const blocks = options.document.structuralBlocks ?? [];
  const symbols: PersistedSymbolCandidateRecord[] = [];

  for (const block of blocks) {
    try {
      const symbol = toSymbolCandidate({
        activeProjectIdentity: options.activeProjectIdentity,
        block,
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        language: options.document.language,
        path: options.document.path,
      });

      if (symbol) {
        symbols.push(symbol);
      }
    } catch {
      continue;
    }
  }

  return dedupeSymbols(symbols);
}

function toSymbolCandidate(options: {
  activeProjectIdentity: string;
  block: StructuralCodeBlock;
  fileFingerprint: string;
  indexRunId: string;
  language: string | null;
  path: string;
}): PersistedSymbolCandidateRecord | null {
  const identity = inferSymbolIdentity({
    content: options.block.content,
    kind: options.block.kind,
    language: options.language,
  });
  if (identity === null) {
    return null;
  }

  const contentHash = createHash("sha256")
    .update(options.block.content)
    .digest("hex");
  const id = createHash("sha256")
    .update(
      [
        options.activeProjectIdentity,
        options.path,
        identity.kind,
        identity.name,
        String(options.block.location.startLine),
        String(options.block.location.endLine),
      ].join(":"),
    )
    .digest("hex");

  return {
    codeLocation: options.block.location,
    contentHash,
    evidenceId: id,
    extractor: `structural-block:${options.language ?? "unknown"}`,
    fileFingerprint: options.fileFingerprint,
    indexRunId: options.indexRunId,
    kind: identity.kind,
    language: options.language,
    name: identity.name,
    path: options.path,
    scope: "file",
    sourceType: "code",
  };
}

function dedupeSymbols(
  symbols: PersistedSymbolCandidateRecord[],
): PersistedSymbolCandidateRecord[] {
  const byEvidenceId = new Map(
    symbols.map((symbol) => [symbol.evidenceId, symbol]),
  );
  return Array.from(byEvidenceId.values()).sort(
    (left, right) =>
      left.codeLocation.startLine - right.codeLocation.startLine ||
      left.name.localeCompare(right.name),
  );
}

async function analyzeStructuredObservations(options: {
  analyzers: StructuredAnalyzerRegistryPort;
  document: ParsedDocument;
  fileFingerprint: string;
  indexRunId: string;
  logger: LoggerPort;
}): Promise<PersistedStructuredObservationRecord[]> {
  const selectedAnalyzers = options.analyzers.select(options.document);
  const observations: PersistedStructuredObservationRecord[] = [];

  for (const analyzer of selectedAnalyzers) {
    try {
      const analyzerObservations = await analyzer.analyze({
        document: options.document,
        indexRunId: options.indexRunId,
      });

      for (const observation of analyzerObservations) {
        observations.push({
          ...observation,
          fileFingerprint: options.fileFingerprint,
        });
      }
    } catch (error) {
      options.logger.warn("Structured analyzer failed; continuing with text indexing", {
        error: error instanceof Error ? error.message : String(error),
        extractor: analyzer.constructor.name,
        path: options.document.path,
      });
    }
  }

  return dedupeObservationRecords(observations);
}

function dedupeObservationRecords(
  observations: PersistedStructuredObservationRecord[],
): PersistedStructuredObservationRecord[] {
  const byEvidenceId = new Map(
    observations.map((observation) => [observation.evidenceId, observation]),
  );

  return Array.from(byEvidenceId.values()).sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
}

function stripFileFingerprint(
  observation: PersistedStructuredObservationRecord,
): StructuredObservation {
  const { fileFingerprint: _fileFingerprint, ...rest } = observation;
  return rest;
}

function normalizeCanonicalFacts(options: {
  activeProjectIdentity: string;
  document: ParsedDocument;
  fileFingerprint: string;
  indexRunId: string;
  symbolCandidates: PersistedSymbolCandidateRecord[];
  structuredObservations?: PersistedStructuredObservationRecord[];
}): PersistedCanonicalFactRecord[] {
  const facts: PersistedCanonicalFactRecord[] = [];

  for (const symbol of options.symbolCandidates) {
    facts.push({
      codeLocation: symbol.codeLocation,
      confidence: 1,
      contentHash: symbol.contentHash,
      evidenceId: symbol.evidenceId,
      extractor: symbol.extractor,
      factId: hashStructuredId(
        options.activeProjectIdentity,
        options.document.path,
        "symbol_definition",
        symbol.kind,
        symbol.name,
      ),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "symbol_definition",
      layer: "canonical",
      path: options.document.path,
      payload: {
        language: symbol.language,
        name: symbol.name,
        scope: symbol.scope,
        symbolCandidateId: symbol.evidenceId,
        symbolKind: symbol.kind,
      },
      sourceType: symbol.sourceType,
    });
  }

  for (const observation of options.structuredObservations ?? []) {
    if (observation.kind === "symbol_export" && observation.name !== undefined) {
      facts.push({
        codeLocation: observation.codeLocation,
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(
          options.activeProjectIdentity,
          options.document.path,
          "symbol_export",
          observation.name,
        ),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "symbol_export",
        layer: "canonical",
        path: options.document.path,
        payload: {
          exportedName: observation.name,
          symbolKind: observation.symbolKind,
        },
        sourceType: observation.sourceType,
      });
      continue;
    }

    if (observation.kind === "workflow" && observation.name !== undefined) {
      facts.push({
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "workflow", observation.name),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "workflow",
        layer: "canonical",
        path: options.document.path,
        payload: { workflowName: observation.name },
        sourceType: observation.sourceType,
      });
      continue;
    }

    if (observation.kind === "workflow_step" && observation.name !== undefined) {
      facts.push({
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "workflow_step", observation.name),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "workflow_step",
        layer: "canonical",
        path: options.document.path,
        payload: {
          command: observation.metadata?.command,
          scriptName: observation.metadata?.scriptName,
          stepName: observation.name,
        },
        sourceType: observation.sourceType,
      });
      continue;
    }

    if (observation.kind === "quality_gate" && observation.name !== undefined) {
      facts.push({
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "quality_gate", observation.name),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "quality_gate",
        layer: "canonical",
        path: options.document.path,
        payload: {
          command: observation.metadata?.command,
          scriptName: observation.metadata?.scriptName,
          tool: observation.name,
        },
        sourceType: observation.sourceType,
      });
      continue;
    }

    if (observation.kind === "config_artifact" && observation.name !== undefined) {
      facts.push({
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "config_artifact", observation.name),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "config_artifact",
        layer: "canonical",
        path: options.document.path,
        payload: {
          artifactName: observation.name,
          artifactKind: observation.symbolKind,
        },
        sourceType: observation.sourceType,
      });
      continue;
    }

    if (observation.kind === "task" && observation.name !== undefined) {
      facts.push({
        confidence: observation.confidence,
        contentHash: observation.contentHash,
        evidenceId: observation.evidenceId,
        extractor: observation.extractor,
        factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "workspace_task", observation.name),
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "workspace_task",
        layer: "canonical",
        path: options.document.path,
        payload: {
          command: observation.metadata?.command,
          taskName: observation.name,
          taskType: observation.symbolKind,
        },
        sourceType: observation.sourceType,
      });
    }
  }

  for (const item of options.document.imports ?? []) {
    facts.push({
      confidence: item.isPackage ? 0.95 : 0.9,
      contentHash: options.symbolCandidates[0]?.contentHash ?? hashContent(options.document.content),
      evidenceId: hashStructuredId(options.activeProjectIdentity, options.document.path, "file_import", item.specifier),
      extractor: "observation-normalizer",
      factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "file_import", item.specifier),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "file_import",
      layer: "canonical",
      path: options.document.path,
      payload: { isPackage: item.isPackage, specifier: item.specifier },
      sourceType: options.document.sourceType,
    });
  }

  for (const dep of options.document.packageDependencies ?? []) {
    facts.push({
      confidence: 1,
      contentHash: hashContent(`${dep.name}:${dep.version}`),
      evidenceId: hashStructuredId(options.activeProjectIdentity, options.document.path, "package_dependency", dep.name),
      extractor: "observation-normalizer",
      factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "package_dependency", dep.name),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "package_dependency",
      layer: "canonical",
      path: options.document.path,
      payload: {
        packageName: options.document.packageName,
        dependencyName: dep.name,
        version: dep.version,
      },
      sourceType: options.document.sourceType,
    });
  }

  for (const script of options.document.packageScripts ?? []) {
    facts.push({
      confidence: 1,
      contentHash: hashContent(script.command),
      evidenceId: hashStructuredId(options.activeProjectIdentity, options.document.path, "package_script", script.name),
      extractor: "observation-normalizer",
      factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "package_script", script.name),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "package_script",
      layer: "canonical",
      path: options.document.path,
      payload: { command: script.command, packageName: options.document.packageName, scriptName: script.name },
      sourceType: options.document.sourceType,
    });
  }

  for (const step of options.document.workflowSteps ?? []) {
    facts.push({
      confidence: 0.95,
      contentHash: hashContent(`${step.name}:${step.command ?? ""}`),
      evidenceId: hashStructuredId(options.activeProjectIdentity, options.document.path, "workflow_step", step.name),
      extractor: "observation-normalizer",
      factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "workflow_step", step.name),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "workflow_step",
      layer: "canonical",
      path: options.document.path,
      payload: { command: step.command, scriptName: step.scriptName, stepName: step.name },
      sourceType: options.document.sourceType,
    });
  }

  for (const gate of options.document.qualityGates ?? []) {
    facts.push({
      confidence: 0.95,
      contentHash: hashContent(`${gate.tool}:${gate.command}`),
      evidenceId: hashStructuredId(options.activeProjectIdentity, options.document.path, "quality_gate", gate.command),
      extractor: "observation-normalizer",
      factId: hashStructuredId(options.activeProjectIdentity, options.document.path, "quality_gate", gate.command),
      fileFingerprint: options.fileFingerprint,
      indexRunId: options.indexRunId,
      kind: "quality_gate",
      layer: "canonical",
      path: options.document.path,
      payload: { command: gate.command, scriptName: gate.scriptName, tool: gate.tool },
      sourceType: options.document.sourceType,
    });
  }

  return dedupeCanonicalFacts(facts);
}

function deriveFacts(options: {
  canonicalFacts: PersistedCanonicalFactRecord[];
  document: ParsedDocument;
  fileFingerprint: string;
  indexRunId: string;
  symbolCandidates: PersistedSymbolCandidateRecord[];
}): PersistedDerivedFactRecord[] {
  const derived: PersistedDerivedFactRecord[] = [];
  const symbolDefinitions = options.canonicalFacts.filter(
    (fact) => fact.kind === "symbol_definition",
  );
  const fileImports = options.canonicalFacts.filter((fact) => fact.kind === "file_import");
  const packageDependencies = options.canonicalFacts.filter(
    (fact) => fact.kind === "package_dependency",
  );
  const packageScripts = options.canonicalFacts.filter((fact) => fact.kind === "package_script");
  const workflowSteps = options.canonicalFacts.filter((fact) => fact.kind === "workflow_step");
  const qualityGates = options.canonicalFacts.filter((fact) => fact.kind === "quality_gate");
  const workflows = options.canonicalFacts.filter((fact) => fact.kind === "workflow");
  const symbolExports = options.canonicalFacts.filter((fact) => fact.kind === "symbol_export");
  const workspaceTasks = options.canonicalFacts.filter((fact) => fact.kind === "workspace_task");

  for (const fact of symbolDefinitions) {
    derived.push(createDerivedFact(fact, options.fileFingerprint, "symbol-defined-in-file", {
      fromId: String(fact.payload.symbolCandidateId),
      fromKind: "SymbolCandidate",
      fromLabel: String(fact.payload.name),
      toId: options.document.path,
      toKind: "File",
      toLabel: options.document.path,
    }));
  }

  for (const fact of symbolExports) {
    derived.push(createDerivedFact(fact, options.fileFingerprint, "symbol-exported-from-file", {
      fromId: String(fact.payload.exportedName),
      fromKind: "Symbol",
      fromLabel: String(fact.payload.exportedName),
      toId: options.document.path,
      toKind: "File",
      toLabel: options.document.path,
    }));
  }

  for (const fact of fileImports) {
    const specifier = String(fact.payload.specifier);
    const isPackage = Boolean(fact.payload.isPackage);
    derived.push(createDerivedFact(fact, options.fileFingerprint, isPackage ? "file-imports-package" : "file-imports-file", {
      fromId: options.document.path,
      fromKind: "File",
      fromLabel: options.document.path,
      toId: specifier,
      toKind: isPackage ? "Package" : "File",
      toLabel: specifier,
    }));
  }

  for (const fact of packageDependencies) {
    const packageName =
      typeof fact.payload.packageName === "string"
        ? fact.payload.packageName
        : options.document.path;
    const dependencyName =
      typeof fact.payload.dependencyName === "string"
        ? fact.payload.dependencyName
        : "unknown";
    derived.push(createDerivedFact(fact, options.fileFingerprint, "package-depends-on-package", {
      fromId: packageName,
      fromKind: "Package",
      fromLabel: packageName,
      toId: dependencyName,
      toKind: "Package",
      toLabel: dependencyName,
    }));
  }

  for (const sourceSymbol of options.symbolCandidates) {
    const references = options.symbolCandidates.filter(
      (candidate) =>
        candidate.path === sourceSymbol.path && candidate.evidenceId !== sourceSymbol.evidenceId,
    );
    for (const target of references) {
      derived.push({
        codeLocation: sourceSymbol.codeLocation,
        confidence: 0.6,
        contentHash: sourceSymbol.contentHash,
        derivedFactId: hashStructuredId(
          options.document.path,
          "symbol-references-symbol-candidate",
          sourceSymbol.evidenceId,
          target.evidenceId,
        ),
        evidenceId: sourceSymbol.evidenceId,
        extractor: "derived-fact-builder",
        fileFingerprint: options.fileFingerprint,
        indexRunId: options.indexRunId,
        kind: "symbol-references-symbol-candidate",
        layer: "derived",
        path: options.document.path,
        payload: {
          fromId: sourceSymbol.evidenceId,
          fromKind: "SymbolCandidate",
          fromLabel: sourceSymbol.name,
          toId: target.evidenceId,
          toKind: "SymbolCandidate",
          toLabel: target.name,
        },
        sourceType: sourceSymbol.sourceType,
      });
      if (sourceSymbol.kind === "function" && target.kind === "function") {
        derived.push({
          codeLocation: sourceSymbol.codeLocation,
          confidence: 0.55,
          contentHash: sourceSymbol.contentHash,
          derivedFactId: hashStructuredId(
            options.document.path,
            "caller-callee-candidate",
            sourceSymbol.evidenceId,
            target.evidenceId,
          ),
          evidenceId: sourceSymbol.evidenceId,
          extractor: "derived-fact-builder",
          fileFingerprint: options.fileFingerprint,
          indexRunId: options.indexRunId,
          kind: "caller-callee-candidate",
          layer: "derived",
          path: options.document.path,
          payload: {
            fromId: sourceSymbol.evidenceId,
            fromKind: "SymbolCandidate",
            fromLabel: sourceSymbol.name,
            toId: target.evidenceId,
            toKind: "SymbolCandidate",
            toLabel: target.name,
          },
          sourceType: sourceSymbol.sourceType,
        });
      }
    }
  }

  for (const step of workflowSteps) {
    const workflowName = options.document.path;
    derived.push(createDerivedFact(step, options.fileFingerprint, "workflow-contains-job", {
      fromId: workflowName,
      fromKind: "Workflow",
      fromLabel: workflowName,
      toId: String(step.payload.stepName),
      toKind: "WorkflowJob",
      toLabel: String(step.payload.stepName),
    }));
    derived.push(createDerivedFact(step, options.fileFingerprint, "job-runs-step", {
      fromId: String(step.payload.stepName),
      fromKind: "WorkflowJob",
      fromLabel: String(step.payload.stepName),
      toId: String(step.payload.stepName),
      toKind: "WorkflowStep",
      toLabel: String(step.payload.stepName),
    }));
  }

  for (const step of workflowSteps) {
    const scriptName = step.payload.scriptName;
    if (typeof scriptName === "string") {
      derived.push(createDerivedFact(step, options.fileFingerprint, "workflow-runs-package-script-candidate", {
        fromId: String(step.payload.stepName),
        fromKind: "WorkflowStep",
        fromLabel: String(step.payload.stepName),
        toId: scriptName,
        toKind: "PackageScript",
        toLabel: scriptName,
      }));
    }
  }

  for (const workflow of workflows) {
    const hasWorkflowJob = derived.some(
      (fact) =>
        fact.kind === "workflow-contains-job" && fact.payload.fromId === workflow.payload.workflowName,
    );
    if (!hasWorkflowJob) {
      derived.push(createDerivedFact(workflow, options.fileFingerprint, "workflow-contains-job", {
        fromId: String(workflow.payload.workflowName),
        fromKind: "Workflow",
        fromLabel: String(workflow.payload.workflowName),
        toId: String(workflow.payload.workflowName),
        toKind: "WorkflowJob",
        toLabel: String(workflow.payload.workflowName),
      }));
    }
  }

  for (const task of workspaceTasks) {
    const command = typeof task.payload.command === "string" ? task.payload.command : undefined;
    if (command !== undefined) {
      derived.push(createDerivedFact(task, options.fileFingerprint, "task-runs-command", {
        fromId: String(task.payload.taskName),
        fromKind: "Task",
        fromLabel: String(task.payload.taskName),
        toId: command,
        toKind: "Command",
        toLabel: command,
      }));
    }
  }

  for (const gate of qualityGates) {
    derived.push(createDerivedFact(gate, options.fileFingerprint, "quality-gate-runs-command", {
      fromId: String(gate.payload.tool),
      fromKind: "QualityGate",
      fromLabel: String(gate.payload.tool),
      toId: String(gate.payload.command),
      toKind: "Command",
      toLabel: String(gate.payload.command),
    }));

    if (typeof gate.payload.scriptName === "string") {
      derived.push(createDerivedFact(gate, options.fileFingerprint, "quality-gate-runs-script-candidate", {
        fromId: String(gate.payload.tool),
        fromKind: "QualityGate",
        fromLabel: String(gate.payload.tool),
        toId: String(gate.payload.scriptName),
        toKind: "PackageScript",
        toLabel: String(gate.payload.scriptName),
      }));
    }
  }

  for (const script of packageScripts) {
    const calledScript = String(script.payload.command)
      .match(/npm\s+run\s+([\w:-]+)/u)?.[1];
    if (calledScript !== undefined) {
      derived.push(createDerivedFact(script, options.fileFingerprint, "quality-gate-runs-script-candidate", {
        fromId: String(script.payload.scriptName),
        fromKind: "PackageScript",
        fromLabel: String(script.payload.scriptName),
        toId: calledScript,
        toKind: "PackageScript",
        toLabel: calledScript,
      }));
    }
  }

  return dedupeDerivedFacts(derived);
}

async function persistStructuredData(options: {
  canonicalFacts: PersistedCanonicalFactRecord[];
  derivedFactStore: DerivedFactStorePort;
  derivedFacts: PersistedDerivedFactRecord[];
  documentPath: string;
  graphProjector: StructuredDataProjectorPort;
  internalGraph: InternalGraphStorePort;
  logger: LoggerPort;
  canonicalFactStore: CanonicalFactStorePort;
  symbolCandidates: PersistedSymbolCandidateRecord[];
}): Promise<void> {
  try {
    await options.canonicalFactStore.upsert(options.canonicalFacts);
    await options.derivedFactStore.upsert(options.derivedFacts);
    const existingGraph = await options.internalGraph.read();
    const projected = options.graphProjector.project({
      canonicalFacts: options.canonicalFacts,
      derivedFacts: options.derivedFacts,
      symbolCandidates: options.symbolCandidates,
    });
    await options.internalGraph.replace({
      edges: [
        ...existingGraph.edges.filter((edge) => edge.path !== options.documentPath),
        ...projected.edges,
      ].sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
      nodes: [
        ...existingGraph.nodes.filter((node) => node.path !== options.documentPath),
        ...projected.nodes,
      ].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    });
  } catch (error) {
    options.logger.warn("Structured persistence failed; continuing text indexing", {
      error: error instanceof Error ? error.message : String(error),
      event: "index.structured_persistence_failed",
      path: options.documentPath,
    });
  }
}

function createDerivedFact(
  fact: PersistedCanonicalFactRecord,
  fileFingerprint: string,
  kind: PersistedDerivedFactRecord["kind"],
  payload: Record<string, unknown>,
): PersistedDerivedFactRecord {
  return {
    codeLocation: fact.codeLocation,
    confidence: fact.confidence,
    contentHash: fact.contentHash,
    derivedFactId: hashStructuredId(fact.path, kind, JSON.stringify(payload)),
    evidenceId: fact.evidenceId,
    extractor: "derived-fact-builder",
    fileFingerprint,
    indexRunId: fact.indexRunId,
    kind,
    layer: "derived",
    path: fact.path,
    payload,
    sourceType: fact.sourceType,
  };
}

function dedupeCanonicalFacts(
  facts: PersistedCanonicalFactRecord[],
): PersistedCanonicalFactRecord[] {
  return Array.from(new Map(facts.map((fact) => [fact.factId, fact])).values()).sort(
    (left, right) => left.factId.localeCompare(right.factId),
  );
}

function dedupeDerivedFacts(
  facts: PersistedDerivedFactRecord[],
): PersistedDerivedFactRecord[] {
  return Array.from(
    new Map(facts.map((fact) => [fact.derivedFactId, fact])).values(),
  ).sort((left, right) => left.derivedFactId.localeCompare(right.derivedFactId));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function hashStructuredId(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}
