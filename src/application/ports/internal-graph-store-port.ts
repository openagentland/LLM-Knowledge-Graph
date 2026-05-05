import type {
  PersistedInternalGraphEdgeRecord,
  PersistedInternalGraphNodeRecord,
  PersistedInternalGraphRecord,
} from "../dto/structured-records.js";

export type InternalGraphSnapshot = PersistedInternalGraphRecord;

export interface InternalGraphStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  listByPath(path: string): Promise<PersistedInternalGraphRecord>;
  listEdgesByNode(nodeId: string): Promise<PersistedInternalGraphEdgeRecord[]>;
  listNodesByPath(path: string): Promise<PersistedInternalGraphNodeRecord[]>;
  readSnapshot(): Promise<InternalGraphSnapshot>;
  replaceSnapshot(snapshot: InternalGraphSnapshot): Promise<void>;
}
