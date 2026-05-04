import type { SourceType } from "./ingestion.js";
import type { PersistedSymbolCandidateRecord } from "./structured-records.js";

export type { SourceType } from "./ingestion.js";

export type PersistedChunkRecord = {
  chunkKey: string;
  content: string;
  contentHash: string;
  embedding: number[];
  evidenceId: string;
  extractor: string;
  fileFingerprint: string;
  indexRunId: string;
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
  chunkKeys: string[];
  fileFingerprint: string;
  indexRunId: string;
  lastIndexedAt: string;
  path: string;
  sourceType: SourceType;
  symbolCandidates?: PersistedSymbolCandidateRecord[];
};
