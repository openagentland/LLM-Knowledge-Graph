import type { DerivedFactKind, SourceType } from "../../domain/index.js";

export type OverlayKind = "cfg" | "data_flow" | "pdg_lite";

export type OverlayNodeRecord = {
  id: string;
  kind: string;
  label: string;
  path: string;
  sourceType: SourceType;
  startLine?: number;
  endLine?: number;
};

export type OverlayEdgeRecord = {
  confidence: number;
  fromId: string;
  id: string;
  kind: DerivedFactKind | "cfg-next" | "data-flow" | "pdg-lite";
  path: string;
  sourceType: SourceType;
  toId: string;
};

export type OverlayRecord = {
  kind: OverlayKind;
  version: string;
  nodes: OverlayNodeRecord[];
  edges: OverlayEdgeRecord[];
  generatedAt: string;
};

export type OverlaySnapshot = {
  records: OverlayRecord[];
};

export type AnalysisRule = {
  defaultPrecision:
    | "resolved"
    | "derived"
    | "heuristic"
    | "possible"
    | "unknown";
  id: string;
  kind: "traversal" | "impact" | "slice" | "entrypoint";
  requiredFacts: DerivedFactKind[];
  requiredOverlays: OverlayKind[];
  version: string;
};

export type RulePack = {
  costProfile: "low" | "medium" | "high";
  id: string;
  requiredOverlays: OverlayKind[];
  supportedLanguages: string[];
  version: string;
};
