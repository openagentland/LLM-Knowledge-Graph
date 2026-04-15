import type {
  RetrievedChunk,
  RetrievalQuery,
} from "../../application/dto/retrieval.js";
import type { EmbeddingPort } from "../../application/ports/embedding-port.js";
import type { RetrieverPort } from "../../application/ports/retriever-port.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";

export class HybridRetriever implements RetrieverPort {
  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly vectorStorePort: VectorStorePort,
  ) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]> {
    if (query.topK <= 0) {
      return [];
    }

    const queryText = query.query ?? "";
    const queryVector =
      query.queryEmbedding ?? (await this.embeddingPort.embedQuery(queryText));
    const matches = await this.vectorStorePort.searchByEmbedding(
      queryVector,
      query.topK,
    );

    return matches.sort(compareRetrievedChunks);
  }
}

function compareRetrievedChunks(
  left: RetrievedChunk,
  right: RetrievedChunk,
): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return left.chunkKey.localeCompare(right.chunkKey);
}
