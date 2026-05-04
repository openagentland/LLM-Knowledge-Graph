import type { PersistedInternalGraphRecord } from "../dto/structured-records.js";

export interface InternalGraphStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  listByPath(path: string): Promise<PersistedInternalGraphRecord>;
  read(): Promise<PersistedInternalGraphRecord>;
  replace(records: PersistedInternalGraphRecord): Promise<void>;
}
