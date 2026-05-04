import type { StructuredAnalyzerPort } from "./structured-analyzer-port.js";
import type { ParsedDocument } from "../dto/ingestion.js";

export interface StructuredAnalyzerRegistryPort {
  select(document: ParsedDocument): StructuredAnalyzerPort[];
}
