import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  PersistedStructuredObservationRecord,
  StructuredObservationFilter,
} from "../../application/dto/structured-observations.js";
import type { StructuredObservationStorePort } from "../../application/ports/structured-observation-store-port.js";

export class FileStructuredObservationRepository
  implements StructuredObservationStorePort
{
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
    const observations = await this.readObservations();
    await this.writeObservations(
      observations.filter((observation) => observation.path !== path),
    );
  }

  async list(
    filter?: StructuredObservationFilter,
  ): Promise<PersistedStructuredObservationRecord[]> {
    const observations = await this.readObservations();

    return observations.filter((observation) => {
      if (filter?.path !== undefined && observation.path !== filter.path) {
        return false;
      }

      if (filter?.kind !== undefined && observation.kind !== filter.kind) {
        return false;
      }

      if (
        filter?.sourceType !== undefined &&
        observation.sourceType !== filter.sourceType
      ) {
        return false;
      }

      return true;
    });
  }

  async upsert(records: PersistedStructuredObservationRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const existing = await this.readObservations();
    const recordPaths = new Set(records.map((record) => record.path));
    const next = existing.filter((record) => !recordPaths.has(record.path));
    next.push(...records);

    await this.writeObservations(
      next.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    );
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "structured-observations",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }

  private async readObservations(): Promise<PersistedStructuredObservationRecord[]> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as PersistedStructuredObservationRecord[];
    } catch {
      return [];
    }
  }

  private async writeObservations(
    observations: PersistedStructuredObservationRecord[],
  ): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(observations, null, 2)}\n`, "utf8");
  }
}
