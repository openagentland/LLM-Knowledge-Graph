import type { IndexMode } from "../dto/index-lifecycle.js";
import type { IngestionSummary } from "../dto/ingestion.js";

export interface IngestionPipelinePort {
  run(context: {
    indexRunId: string;
    mode: IndexMode;
  }): Promise<IngestionSummary>;
}
