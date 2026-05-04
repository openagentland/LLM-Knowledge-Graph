import type { SourceType } from "./ingestion.js";

export type ListSymbolsCommand = {
  kind?: string;
  path?: string;
  query?: string;
  sourceType?: SourceType;
};

export type SymbolCandidateEvidence = {
  codeLocation: {
    endLine: number;
    startLine: number;
  };
  contentHash: string;
  evidenceId: string;
  extractor: string;
  path: string;
};

export type SymbolSearchResult = {
  confidence?: number;
  containerName?: string;
  indexRunId: string;
  kind: string;
  language: string | null;
  name: string;
  ranking?: {
    exactNameMatch: boolean;
    exactPathMatch: boolean;
    kindMatch: boolean;
    score: number;
  };
  scope: "file";
  signature?: string;
  sourceType: SourceType;
  evidence: SymbolCandidateEvidence;
};

export type ListSymbolsResult = {
  results: SymbolSearchResult[];
};

export type GetSymbolCommand = {
  path: string;
  symbol: string;
};

export type SymbolRelationResult = {
  confidence?: number;
  relationshipKind?: string;
} & SymbolSearchResult;

export type SymbolContextResult = {
  confidence?: number;
  label?: string;
} & SymbolSearchResult;

export type AmbiguousSymbolResult = Pick<
  SymbolSearchResult,
  | "confidence"
  | "containerName"
  | "indexRunId"
  | "kind"
  | "language"
  | "name"
  | "ranking"
  | "scope"
  | "signature"
  | "sourceType"
  | "evidence"
>;

export type ResolvedSymbolDetailResult = {
  ambiguity?: undefined;
  callers?: SymbolRelationResult[];
  callees?: SymbolRelationResult[];
  candidates?: SymbolSearchResult[];
  exports?: SymbolContextResult[];
  imports?: SymbolContextResult[];
  references?: SymbolContextResult[];
  repoContext?: SymbolContextResult[];
  symbol: SymbolSearchResult;
  tests?: SymbolContextResult[];
};

export type AmbiguousSymbolDetailResult = {
  ambiguity: AmbiguousSymbolResult[];
  callers?: undefined;
  callees?: undefined;
  candidates?: SymbolSearchResult[];
  exports?: undefined;
  imports?: undefined;
  references?: undefined;
  repoContext?: undefined;
  symbol?: undefined;
  tests?: undefined;
};

export type SymbolDetailResult =
  | {
      candidates: SymbolSearchResult[];
    }
  | ResolvedSymbolDetailResult
  | AmbiguousSymbolDetailResult;
