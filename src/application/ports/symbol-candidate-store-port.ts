import type {
  PersistedSymbolCandidateRecord,
  SymbolCandidateFilter,
} from "../dto/structured-records.js";

export interface SymbolCandidateStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  list(filter?: SymbolCandidateFilter): Promise<PersistedSymbolCandidateRecord[]>;
  upsert(records: PersistedSymbolCandidateRecord[]): Promise<void>;
}
