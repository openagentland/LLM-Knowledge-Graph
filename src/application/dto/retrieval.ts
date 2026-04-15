import type { PersistedChunkRecord } from "./storage.js";

export type RetrievalQuery = {
  query?: string;
  queryEmbedding?: number[];
  topK: number;
};

export type RetrievedChunk = PersistedChunkRecord & {
  score: number;
};
