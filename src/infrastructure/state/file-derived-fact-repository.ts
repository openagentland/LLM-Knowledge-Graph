import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  DerivedFactFilter,
  PersistedDerivedFactRecord,
} from "../../application/dto/structured-records.js";
import type { DerivedFactStorePort } from "../../application/ports/derived-fact-store-port.js";

export class FileDerivedFactRepository implements DerivedFactStorePort {
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

  async list(filter?: DerivedFactFilter): Promise<PersistedDerivedFactRecord[]> {
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

  async upsert(records: PersistedDerivedFactRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const existing = await this.readRecords();
    const recordPaths = new Set(records.map((record) => record.path));
    const next = existing.filter((record) => !recordPaths.has(record.path));
    next.push(...records);
    await this.writeRecords(
      next.sort((left, right) => left.derivedFactId.localeCompare(right.derivedFactId)),
    );
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "facts",
      "derived",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }

  private async readRecords(): Promise<PersistedDerivedFactRecord[]> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as PersistedDerivedFactRecord[];
    } catch {
      return [];
    }
  }

  private async writeRecords(records: PersistedDerivedFactRecord[]): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }
}
