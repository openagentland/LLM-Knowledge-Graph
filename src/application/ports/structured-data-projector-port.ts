import type {
  PersistedCanonicalFactRecord,
  PersistedDerivedFactRecord,
  PersistedInternalGraphRecord,
  PersistedSymbolCandidateRecord,
} from "../dto/structured-records.js";

export interface StructuredDataProjectorPort {
  project(input: {
    canonicalFacts: PersistedCanonicalFactRecord[];
    derivedFacts: PersistedDerivedFactRecord[];
    symbolCandidates: PersistedSymbolCandidateRecord[];
  }): PersistedInternalGraphRecord;
}
