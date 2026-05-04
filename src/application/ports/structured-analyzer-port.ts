import type { ParsedDocument } from "../dto/ingestion.js";
import type { StructuredObservation } from "../dto/structured-observations.js";

export interface StructuredAnalyzerPort {
  readonly id?: string;
  supports(document: ParsedDocument): boolean;
  analyze(context: {
    document: ParsedDocument;
    indexRunId: string;
  }): Promise<StructuredObservation[]>;
}
