import type { ArtifactKind, PartitionStatus, SourceType } from "./ingestion.js";
import type { PersistedSymbolCandidateRecord } from "./structured-records.js";

export type { ArtifactKind, PartitionStatus, SourceType } from "./ingestion.js";

export type PersistedChunkRecord = {
  artifactKind: ArtifactKind;
  chunkKey: string;
  content: string;
  contentHash: string;
  embedding: number[];
  evidenceId: string;
  extractor: string;
  fileFingerprint: string;
  indexRunId: string;
  partitionId?: string;
  partitionIndex?: number;
  partitionStatus?: PartitionStatus;
  partitionTotal?: number;
  path: string;
  sourceType: SourceType;
  codeLocation?: {
    endLine: number;
    startLine: number;
  };
  docLocation?: {
    offset?: number;
    section?: string;
  };
};

export type PersistedSymbolCandidate = PersistedSymbolCandidateRecord;

export type FileManifestEntry = {
  artifactKind: ArtifactKind;
  chunkKeys: string[];
  fileFingerprint: string;
  indexRunId: string;
  lastIndexedAt: string;
  latestPartitionStatus?: PartitionStatus;
  partitionCount?: number;
  path: string;
  sourceType: SourceType;
  symbolCandidates?: PersistedSymbolCandidateRecord[];
};
