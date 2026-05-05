import type {
  AnalysisBudget,
  AnalysisCompleteness,
  Anchor,
  EvidenceItem,
  FlowSegment,
  ImpactReason,
  LimitationItem,
  PrecisionTier,
  PropagationPath,
} from "../../domain/index.js";

export type {
  AnalysisBudget,
  Anchor,
  EvidenceItem,
  FlowSegment,
  ImpactReason,
  LimitationItem,
  PropagationPath,
};

export type EntrypointKind =
  | "mcp_tool"
  | "cli"
  | "script"
  | "http"
  | "worker"
  | "test"
  | "library_export"
  | "workflow"
  | "entrypoint";

export type EntrypointResult = {
  command?: string;
  confidence: number;
  detectionReason: string;
  endLine?: number;
  entrypointId: string;
  evidence: EvidenceItem[];
  kind: EntrypointKind;
  name: string;
  path: string;
  precisionTier: PrecisionTier;
  startLine?: number;
  symbolId?: string;
  trigger?: string;
};

export type ListEntrypointsCommand = {
  confidenceMin?: number;
  kind?: EntrypointKind;
  limit?: number;
  package?: string;
  path?: string;
  query?: string;
};

export type ListEntrypointsResult = {
  limitations?: LimitationItem[];
  results: EntrypointResult[];
};

export type TraceFlowCommand = {
  confidenceMin?: number;
  direction?: "forward" | "backward" | "both";
  from?: Anchor;
  include?: Array<
    "calls" | "imports" | "exports" | "control" | "data" | "config" | "workflow"
  >;
  maxDepth?: number;
  maxNodes?: number;
  timeBudgetMs?: number;
  to?: Anchor;
};

export type FlowTraceResult = {
  completeness: AnalysisCompleteness;
  confidence: number;
  end?: Anchor;
  precisionTier: PrecisionTier;
  segments: FlowSegment[];
  start: Anchor;
  traceId: string;
};

export type TraceFlowResult = {
  limitations?: LimitationItem[];
  traces: FlowTraceResult[];
};

export type AnalyzeImpactCommand = {
  confidenceMin?: number;
  maxDepth?: number;
  maxResults?: number;
  mode?: "callers" | "callees" | "dependents" | "tests" | "runtime" | "all";
  target: Anchor;
};

export type ImpactResult = {
  anchor: Anchor;
  classification: "direct" | "transitive" | "possible";
  confidence: number;
  evidence: EvidenceItem[];
  impactId: string;
  kind:
    | "symbol"
    | "file"
    | "module"
    | "package"
    | "test"
    | "workflow"
    | "entrypoint";
  paths: PropagationPath[];
  precisionTier: PrecisionTier;
  reasons: ImpactReason[];
};

export type AnalyzeImpactResult = {
  impacts: ImpactResult[];
  limitations?: LimitationItem[];
  summary: {
    directCount: number;
    possibleCount: number;
    transitiveCount: number;
    truncated: boolean;
  };
  target: Anchor;
};

export type ComputeSliceCommand = {
  criterion: Anchor;
  direction?: "forward" | "backward" | "both";
  include?: Array<"calls" | "control" | "data" | "imports" | "config">;
  maxEvidence?: number;
  maxFiles?: number;
  maxNodes?: number;
};

export type SliceItemResult = {
  anchor: Anchor;
  confidence: number;
  evidence: EvidenceItem[];
  inclusionReason: string;
  precisionTier: PrecisionTier;
  relationPath: FlowSegment[];
};

export type ComputeSliceResult = {
  completeness: AnalysisCompleteness;
  criterion: Anchor;
  items: SliceItemResult[];
  limitations?: LimitationItem[];
  sliceId: string;
};

export const DEFAULT_ANALYSIS_BUDGET: Required<AnalysisBudget> = {
  maxDepth: 4,
  maxEvidence: 60,
  maxNodes: 200,
  timeBudgetMs: 1500,
};

export const MAX_ANALYSIS_BUDGET: Required<AnalysisBudget> = {
  maxDepth: 8,
  maxEvidence: 200,
  maxNodes: 800,
  timeBudgetMs: 5000,
};
