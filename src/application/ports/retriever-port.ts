import type { RetrievalQuery, RetrievedChunk } from "../dto/retrieval.js";

export interface RetrieverPort {
  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}
