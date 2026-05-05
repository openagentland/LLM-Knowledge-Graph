import type { OverlaySnapshot } from "../dto/overlay.js";
import type {
  PersistedInternalGraphEdgeRecord,
  PersistedInternalGraphNodeRecord,
  PersistedInternalGraphRecord,
} from "../dto/structured-records.js";

export interface InternalGraphStorePort {
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  listByPath(path: string): Promise<PersistedInternalGraphRecord>;
  listEdgesByNode(nodeId: string): Promise<PersistedInternalGraphEdgeRecord[]>;
  listNodesByPath(path: string): Promise<PersistedInternalGraphNodeRecord[]>;
  read(): Promise<PersistedInternalGraphRecord>;
  readOverlays(): Promise<OverlaySnapshot>;
  replace(records: PersistedInternalGraphRecord): Promise<void>;
  replaceOverlays(snapshot: OverlaySnapshot): Promise<void>;
}
