import type {
  CodeLocation,
  SourceType,
  StructuredObservationKind,
} from "../../domain/index.js";

export type { StructuredObservationKind };

export type LanguageSupportLevel = "full" | "partial" | "none";

export type AnalyzerEngine = "ast-grep" | "tree-sitter" | "custom";

export type StructuredObservation = {
  codeLocation?: CodeLocation;
  confidence: number;
  contentHash: string;
  evidenceId: string;
  extractor: string;
  indexRunId: string;
  kind: StructuredObservationKind;
  language: string | null;
  name?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  path: string;
  sourceType: SourceType;
  symbolKind?: string;
};

export type PersistedStructuredObservationRecord = StructuredObservation & {
  fileFingerprint: string;
};

export type StructuredObservationFilter = {
  kind?: StructuredObservationKind;
  path?: string;
  sourceType?: SourceType;
};

export type LanguageCapability = {
  analyzerEngines: AnalyzerEngine[];
  artifactKinds?: string[];
  capabilities?: Array<
    | "definition"
    | "export"
    | "import"
    | "reference"
    | "call"
    | "module"
    | "workflow"
    | "config"
    | "task"
  >;
  extensions: string[];
  fallbackStrategy?: "text-only" | "generic-structural" | "ast-grep-only";
  id: string;
  observationKinds: StructuredObservationKind[];
  supportLevel: LanguageSupportLevel;
};
