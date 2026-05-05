import type {
  PersistedStructuredObservationRecord,
  StructuredObservationFilter,
} from "./structured-observations.js";
import type {
  CanonicalFactKind,
  DerivedFactKind,
  InternalGraphEdgeRecord,
  InternalGraphNodeRecord,
  SourceType,
  StructuredDataProvenance,
  StructuredDataScope,
  SymbolCandidateRecord,
} from "../../domain/index.js";

export type {
  PersistedStructuredObservationRecord,
  StructuredObservationFilter,
};
export type {
  CanonicalFactKind,
  DerivedFactKind,
  InternalGraphEdgeRecord,
  InternalGraphNodeRecord,
  StructuredDataProvenance,
  StructuredDataScope,
};

export type PersistedSymbolCandidateRecord = SymbolCandidateRecord;

export type SymbolCandidateFilter = {
  kind?: string;
  path?: string;
  sourceType?: SourceType;
};

export type PersistedCanonicalFactRecord = {
  confidence: number;
  factId: string;
  fileFingerprint: string;
  indexRunId: string;
  kind: CanonicalFactKind;
  layer: "canonical";
  payload: Record<string, unknown>;
  path: string;
  sourceType: SourceType;
} & StructuredDataProvenance;

export type CanonicalFactFilter = {
  kind?: CanonicalFactKind;
  path?: string;
};

export type PersistedDerivedFactRecord = {
  confidence: number;
  derivedFactId: string;
  fileFingerprint: string;
  indexRunId: string;
  kind: DerivedFactKind;
  layer: "derived";
  payload: Record<string, unknown>;
  path: string;
  sourceType: SourceType;
} & StructuredDataProvenance;

export type DerivedFactFilter = {
  kind?: DerivedFactKind;
  path?: string;
};

export type PersistedInternalGraphNodeRecord = InternalGraphNodeRecord;
export type PersistedInternalGraphEdgeRecord = InternalGraphEdgeRecord;

export type PersistedInternalGraphRecord = {
  edges: PersistedInternalGraphEdgeRecord[];
  nodes: PersistedInternalGraphNodeRecord[];
};
