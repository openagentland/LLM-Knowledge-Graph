import type {
  ChunkingOptions,
  DocumentChunk,
  ParsedDocument,
} from "../dto/ingestion.js";

export interface ChunkerPort {
  chunk(
    document: ParsedDocument,
    context: { chunking: ChunkingOptions; indexRunId: string },
  ): Promise<DocumentChunk[]>;
}
