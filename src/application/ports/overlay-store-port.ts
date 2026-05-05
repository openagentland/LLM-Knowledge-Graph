import type { OverlaySnapshot } from "../dto/overlay.js";

export interface OverlayStorePort {
  clear(): Promise<void>;
  read(): Promise<OverlaySnapshot>;
  replace(snapshot: OverlaySnapshot): Promise<void>;
}
