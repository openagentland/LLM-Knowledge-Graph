import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type { RetrievedChunk } from "../dto/retrieval.js";
import type {
  SearchEvidence,
  SearchKnowledgeCommand,
  SearchKnowledgeResult,
} from "../dto/search.js";
import type { EmbeddingPort } from "../ports/embedding-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { RetrieverPort } from "../ports/retriever-port.js";

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;
const MAX_SNIPPET_LENGTH = 500;

export class SearchKnowledgeUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly embeddingPort: EmbeddingPort,
    private readonly retrieverPort: RetrieverPort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(
    command: SearchKnowledgeCommand,
  ): Promise<SearchKnowledgeResult> {
    const query = command.query.trim();

    if (!query) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "Search query must not be empty.",
      );
    }

    const status = await this.indexStatePort.getStatus(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );

    if (
      status === null ||
      status.lastIndexedAt === null ||
      status.needsReindex ||
      status.state === "error"
    ) {
      throw new LkgError(
        ERROR_CODES.INDEX_NOT_READY,
        "The knowledge index is not ready for search.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    const topK = normalizeTopK(command.topK);
    const queryEmbedding = await this.embeddingPort.embedQuery(query);
    const records = await this.retrieverPort.retrieve({
      query,
      queryEmbedding,
      topK,
    });

    return {
      results: records.map((record) => toSearchEvidence(record)),
    };
  }
}

function normalizeTopK(topK: SearchKnowledgeCommand["topK"]): number {
  if (topK === undefined) {
    return DEFAULT_TOP_K;
  }

  if (!Number.isInteger(topK) || topK <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "topK must be a positive integer.",
      { topK },
    );
  }

  return Math.min(topK, MAX_TOP_K);
}

function toSearchEvidence(record: RetrievedChunk): SearchEvidence {
  if (record.sourceType === "code") {
    if (!record.codeLocation || record.docLocation) {
      throw new LkgError(
        ERROR_CODES.INTERNAL_ERROR,
        "Code search evidence must include only code location metadata.",
        { chunkKey: record.chunkKey, path: record.path },
      );
    }

    return {
      codeLocation: record.codeLocation,
      evidenceId: record.evidenceId,
      path: record.path,
      provenance: {
        contentHash: record.contentHash,
        extractor: record.extractor,
        indexRunId: record.indexRunId,
      },
      score: record.score,
      snippet: boundSnippet(record.content),
      sourceType: record.sourceType,
    };
  }

  if (!record.docLocation || record.codeLocation) {
    throw new LkgError(
      ERROR_CODES.INTERNAL_ERROR,
      "Document search evidence must include only document location metadata.",
      { chunkKey: record.chunkKey, path: record.path },
    );
  }

  return {
    docLocation: record.docLocation,
    evidenceId: record.evidenceId,
    path: record.path,
    provenance: {
      contentHash: record.contentHash,
      extractor: record.extractor,
      indexRunId: record.indexRunId,
    },
    score: record.score,
    snippet: boundSnippet(record.content),
    sourceType: record.sourceType,
  };
}

function boundSnippet(content: string): string {
  return content.slice(0, MAX_SNIPPET_LENGTH);
}
