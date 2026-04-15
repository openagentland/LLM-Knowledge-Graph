import type { ScanResult } from "../dto/ingestion.js";

export interface FileScannerPort {
  scan(): Promise<ScanResult>;
}
