import { createHash } from "node:crypto";

import type {
  ChunkingOptions,
  DocumentChunk,
  IngestionCounters,
  IngestionSummary,
  ParsedDocument,
} from "../../application/dto/ingestion.js";
import type { PersistedChunkRecord } from "../../application/dto/storage.js";
import type { ChunkerPort } from "../../application/ports/chunker-port.js";
import type { DocumentManifestPort } from "../../application/ports/document-manifest-port.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { FileScannerPort } from "../../application/ports/file-scanner-port.js";
import type { IngestionPipelinePort } from "../../application/ports/ingestion-pipeline-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { ParserPort } from "../../application/ports/parser-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";

export class DefaultIngestionPipeline implements IngestionPipelinePort {
  constructor(
    private readonly scanner: FileScannerPort,
    private readonly parser: ParserPort,
    private readonly chunker: ChunkerPort,
    private readonly embedding: EmbeddingPort,
    private readonly vectorStore: VectorStorePort,
    private readonly manifest: DocumentManifestPort,
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

          await upsertInBatches(
            this.vectorStore,
            records,
            this.context.vectorUpsertBatchSize,
          );
          chunksWritten += records.length;

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
