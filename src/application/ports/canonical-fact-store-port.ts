import type {
  CanonicalFactFilter,
  PersistedCanonicalFactRecord,
} from "../dto/structured-records.js";

export interface CanonicalFactStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  list(filter?: CanonicalFactFilter): Promise<PersistedCanonicalFactRecord[]>;
  upsert(records: PersistedCanonicalFactRecord[]): Promise<void>;
}
