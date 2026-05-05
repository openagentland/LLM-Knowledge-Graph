import type {
  DocumentPartition,
  ParsedDocument,
  ScanCandidate,
} from "../dto/ingestion.js";

export interface ParserPort {
  parse(candidate: ScanCandidate): Promise<ParsedDocument>;
  parsePartition(
    candidate: ScanCandidate,
    partition: DocumentPartition,
  ): Promise<ParsedDocument>;
}
