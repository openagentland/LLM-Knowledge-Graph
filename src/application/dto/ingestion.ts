export type SourceType = "code" | "doc";

export type ScanSkipReason =
  | "ignored"
  | "binary"
  | "directory"
  | "unsupported"
  | "too_large";

export type ScanCandidate = {
  absolutePath: string;
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

export type CodeLocation = {
  endLine: number;
  startLine: number;
};

export type DocLocation = {
  offset?: number;
  section?: string;
};

export type StructuralCodeBlock = {
  content: string;
  kind: string;
  location: CodeLocation;
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
  content: string;
  language: string | null;
  path: string;
  sourceType: SourceType;
  structuralBlocks?: StructuralCodeBlock[];
};

export type ChunkProvenance = {
  contentHash: string;
  evidenceId: string;
  extractor: string;
  indexRunId: string;
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
  progress: {
    batchIndex: number;
    batchTotal: number;
    checkpointWrittenAt: string | null;
    chunksWritten: number;
    filesProcessed: number;
  };
  skipped: SkippedPath[];
};
