import type { StructuredObservation } from "./structured-observations.js";
import type { CodeLocation, SourceType } from "../../domain/index.js";

export type { CodeLocation, SourceType };

export type ArtifactKind =
  | "code"
  | "config"
  | "doc"
  | "generated"
  | "lockfile"
  | "schema"
  | "script"
  | "test"
  | "workflow";

export type PartitionStatus =
  | "complete"
  | "degraded"
  | "failed"
  | "partial"
  | "skipped";

export type ScanSkipReason =
  | "ignored"
  | "binary"
  | "directory"
  | "unsupported"
  | "too_large";

export type ScanCandidate = {
  absolutePath: string;
  artifactKind: ArtifactKind;
  path: string;
  sizeBytes: number;
  sourceType: SourceType;
};

export type SkippedPath = {
  path: string;
  reason: ScanSkipReason;
};

export type ScanResult = {
  candidates: ScanCandidate[];
  skipped: SkippedPath[];
};

export type DocLocation = {
  offset?: number;
  section?: string;
};

export type DocumentPartition = {
  content: string;
  index: number;
  location?: CodeLocation | DocLocation;
  partitionId: string;
  status: PartitionStatus;
  total: number;
};

export type StructuralCodeBlock = {
  content: string;
  kind: string;
  location: CodeLocation;
};

export type FileImportObservation = {
  isPackage: boolean;
  specifier: string;
};

export type PackageDependencyObservation = {
  name: string;
  version: string;
};

export type PackageScriptObservation = {
  command: string;
  name: string;
};

export type WorkflowStepObservation = {
  command?: string;
  name: string;
  scriptName?: string;
};

export type QualityGateObservation = {
  command: string;
  scriptName?: string;
  tool: string;
};

export type SymbolCandidate = {
  codeLocation: CodeLocation;
  containerName?: string;
  contentHash: string;
  evidenceId: string;
  extractor: string;
  kind: string;
  name: string;
  signature?: string;
};

export type ChunkingOptions = {
  chunkTokenOverlap: number;
  embeddingContextLength: number | null;
  embeddingTokenMargin: number;
  maxChunkTokens: number | null;
  maxSplitDepth: number;
  oversizedSegmentPolicy: "split" | "skip";
};

export type ParsedDocument = {
  artifactKind: ArtifactKind;
  content: string;
  imports?: FileImportObservation[];
  language: string | null;
  packageDependencies?: PackageDependencyObservation[];
  packageName?: string;
  packageScripts?: PackageScriptObservation[];
  partitions?: DocumentPartition[];
  path: string;
  qualityGates?: QualityGateObservation[];
  sourceType: SourceType;
  structuralBlocks?: StructuralCodeBlock[];
  symbolCandidates?: SymbolCandidate[];
  workflowSteps?: WorkflowStepObservation[];
};

export type ChunkProvenance = {
  artifactKind: ArtifactKind;
  contentHash: string;
  evidenceId: string;
  extractor: string;
  indexRunId: string;
  partitionId?: string;
  partitionIndex?: number;
  partitionStatus?: PartitionStatus;
  partitionTotal?: number;
  path: string;
  sourceType: SourceType;
};

export type DocumentChunk = ChunkProvenance & {
  content: string;
  docLocation?: DocLocation;
  codeLocation?: CodeLocation;
};

export type IngestionCounters = {
  errors: number;
  filesIndexed: number;
  filesTotal: number;
};

export type IngestionSummary = {
  chunks: DocumentChunk[];
  chunksEmbedded: number;
  chunksPurged: number;
  chunksWritten: number;
  counters: IngestionCounters;
  filesPurged: number;
  filesUnchanged: number;
  observations: StructuredObservation[];
  progress: {
    batchIndex: number;
    batchTotal: number;
    checkpointWrittenAt: string | null;
    chunksWritten: number;
    filesProcessed: number;
  };
  skipped: SkippedPath[];
};
