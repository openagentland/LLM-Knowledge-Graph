import type {
  PersistedStructuredObservationRecord,
  StructuredObservationFilter,
} from "../dto/structured-observations.js";

export interface StructuredObservationStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  list(
    filter?: StructuredObservationFilter,
  ): Promise<PersistedStructuredObservationRecord[]>;
  upsert(records: PersistedStructuredObservationRecord[]): Promise<void>;
}
