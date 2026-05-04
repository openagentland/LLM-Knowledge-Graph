import type {
  DerivedFactFilter,
  PersistedDerivedFactRecord,
} from "../dto/structured-records.js";

export interface DerivedFactStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  list(filter?: DerivedFactFilter): Promise<PersistedDerivedFactRecord[]>;
  upsert(records: PersistedDerivedFactRecord[]): Promise<void>;
}
