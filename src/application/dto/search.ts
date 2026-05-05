import type { ArtifactKind, PartitionStatus, SourceType } from "./storage.js";

export type SearchKnowledgeCommand = {
  query: string;
  topK?: number;
};

export type SearchEvidence = {
  artifactKind: ArtifactKind;
  evidenceId: string;
  partitionId?: string;
  partitionIndex?: number;
  partitionStatus?: PartitionStatus;
  partitionTotal?: number;
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
