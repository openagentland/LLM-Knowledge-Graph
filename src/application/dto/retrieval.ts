import type { ArtifactKind, PartitionStatus, SourceType } from "./storage.js";

export type RetrievalQuery = {
  query?: string;
  queryEmbedding?: number[];
  topK: number;
};

export type RetrievedChunk = {
  artifactKind: ArtifactKind;
  chunkKey: string;
  codeLocation?: {
    endLine: number;
    startLine: number;
  };
  content: string;
  contentHash: string;
  docLocation?: {
    offset?: number;
    section?: string;
  };
  evidenceId: string;
  extractor: string;
  indexRunId: string;
  partitionId?: string;
  partitionIndex?: number;
  partitionStatus?: PartitionStatus;
  partitionTotal?: number;
  path: string;
  score: number;
  sourceType: SourceType;
};
