import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { FileManifestEntry } from "../../application/dto/storage.js";
import type { DocumentManifestPort } from "../../application/ports/document-manifest-port.js";

export class FileDocumentManifestRepository implements DocumentManifestPort {
  constructor(
    private readonly options: {
      homeDir: string;
      indexScope: string;
      projectIdentity: string;
    },
  ) {}

  async getAll(): Promise<FileManifestEntry[]> {
    return this.readEntries();
  }

  async getByPath(path: string): Promise<FileManifestEntry | null> {
    const entries = await this.readEntries();
    return entries.find((entry) => entry.path === path) ?? null;
  }

  async clear(): Promise<void> {
    await rm(this.resolvePath(), { force: true });
  }

  async deleteByPath(path: string): Promise<void> {
    const entries = await this.readEntries();
    await this.writeEntries(entries.filter((entry) => entry.path !== path));
  }

  async upsert(entry: FileManifestEntry): Promise<void> {
    const entries = await this.readEntries();
    const nextEntries = entries.filter(
      (existingEntry) => existingEntry.path !== entry.path,
    );
    nextEntries.push(entry);
    await this.writeEntries(
      nextEntries.sort((left, right) => left.path.localeCompare(right.path)),
    );
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "manifest",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }

  private async readEntries(): Promise<FileManifestEntry[]> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as FileManifestEntry[];
    } catch {
      return [];
    }
  }

  private async writeEntries(entries: FileManifestEntry[]): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }
}
