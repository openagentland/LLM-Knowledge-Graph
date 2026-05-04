import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  PersistedSymbolCandidateRecord,
  SymbolCandidateFilter,
} from "../../application/dto/structured-records.js";
import type { SymbolCandidateRepositoryPort } from "../../application/ports/symbol-candidate-repository-port.js";

export class FileSymbolCandidateRepository
  implements SymbolCandidateRepositoryPort
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
    const candidates = await this.readCandidates();
    await this.writeCandidates(
      candidates.filter((candidate) => candidate.path !== path),
    );
  }

  async list(
    filter?: SymbolCandidateFilter,
  ): Promise<PersistedSymbolCandidateRecord[]> {
    const candidates = await this.readCandidates();

    return candidates.filter((candidate) => {
      if (filter?.path !== undefined && candidate.path !== filter.path) {
        return false;
      }

      if (filter?.kind !== undefined && candidate.kind !== filter.kind) {
        return false;
      }

      if (
        filter?.sourceType !== undefined &&
        candidate.sourceType !== filter.sourceType
      ) {
        return false;
      }

      return true;
    });
  }

  async upsert(records: PersistedSymbolCandidateRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const existingCandidates = await this.readCandidates();
    const candidatePaths = new Set(records.map((record) => record.path));
    const nextCandidates = existingCandidates.filter(
      (candidate) => !candidatePaths.has(candidate.path),
    );
    nextCandidates.push(...records);

    await this.writeCandidates(
      nextCandidates.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    );
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "symbols",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }

  private async readCandidates(): Promise<PersistedSymbolCandidateRecord[]> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as PersistedSymbolCandidateRecord[];
    } catch {
      return [];
    }
  }

  private async writeCandidates(
    candidates: PersistedSymbolCandidateRecord[],
  ): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(candidates, null, 2)}\n`,
      "utf8",
    );
  }
}
