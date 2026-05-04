import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  CanonicalFactFilter,
  PersistedCanonicalFactRecord,
} from "../../application/dto/structured-records.js";
import type { CanonicalFactStorePort } from "../../application/ports/canonical-fact-store-port.js";

export class FileCanonicalFactRepository implements CanonicalFactStorePort {
  constructor(
    private readonly options: {
      homeDir: string;
      indexScope: string;
      projectIdentity: string;
    },
  ) {}

  async clear(): Promise<void> {
    await rm(this.resolvePath(), { force: true });
  }

  async deleteByPath(path: string): Promise<void> {
    const records = await this.readRecords();
    await this.writeRecords(records.filter((record) => record.path !== path));
  }

  async list(
    filter?: CanonicalFactFilter,
  ): Promise<PersistedCanonicalFactRecord[]> {
    const records = await this.readRecords();
    return records.filter((record) => {
      if (filter?.path !== undefined && record.path !== filter.path) {
        return false;
      }
      if (filter?.kind !== undefined && record.kind !== filter.kind) {
        return false;
      }
      return true;
    });
  }

  async upsert(records: PersistedCanonicalFactRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const existing = await this.readRecords();
    const recordPaths = new Set(records.map((record) => record.path));
    const next = existing.filter((record) => !recordPaths.has(record.path));
    next.push(...records);
    await this.writeRecords(
      next.sort((left, right) => left.factId.localeCompare(right.factId)),
    );
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "facts",
      "canonical",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }

  private async readRecords(): Promise<PersistedCanonicalFactRecord[]> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as PersistedCanonicalFactRecord[];
    } catch {
      return [];
    }
  }

  private async writeRecords(records: PersistedCanonicalFactRecord[]): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }
}
