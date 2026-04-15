import type { ParsedDocument, ScanCandidate } from "../dto/ingestion.js";

export interface ParserPort {
  parse(candidate: ScanCandidate): Promise<ParsedDocument>;
}
