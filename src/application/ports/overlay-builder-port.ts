import type { OverlayRecord } from "../dto/overlay.js";
import type { PersistedDerivedFactRecord } from "../dto/structured-records.js";

export interface OverlayBuilderPort {
  build(records: {
    derivedFacts: PersistedDerivedFactRecord[];
  }): Promise<OverlayRecord[]>;
}
