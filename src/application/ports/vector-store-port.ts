import type { RetrievedChunk } from "../dto/retrieval.js";
import type { PersistedChunkRecord } from "../dto/storage.js";

export interface VectorStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  listRecords(): Promise<PersistedChunkRecord[]>;
  searchByEmbedding(
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievedChunk[]>;
  upsert(records: PersistedChunkRecord[]): Promise<void>;
}
