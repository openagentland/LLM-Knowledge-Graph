import type { FileManifestEntry } from "../dto/storage.js";

export interface DocumentManifestPort {
  getAll(): Promise<FileManifestEntry[]>;
  getByPath(path: string): Promise<FileManifestEntry | null>;
  clear(): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  upsert(entry: FileManifestEntry): Promise<void>;
}
