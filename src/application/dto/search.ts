import type { SourceType } from "./storage.js";

export type SearchKnowledgeCommand = {
  query: string;
  topK?: number;
};

export type SearchEvidence = {
  evidenceId: string;
  path: string;
  provenance: {
    contentHash: string;
    extractor: string;
    indexRunId: string;
  };
  score?: number;
  snippet: string;
  sourceType: SourceType;
  codeLocation?: {
    startLine: number;
    endLine: number;
  };
  docLocation?: {
    section?: string;
    offset?: number;
  };
};

export type SearchKnowledgeResult = {
  results: SearchEvidence[];
};
