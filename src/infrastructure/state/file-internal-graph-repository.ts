import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PersistedInternalGraphRecord } from "../../application/dto/structured-records.js";
import type { InternalGraphStorePort } from "../../application/ports/internal-graph-store-port.js";

const EMPTY_GRAPH: PersistedInternalGraphRecord = {
  edges: [],
  nodes: [],
};

export class FileInternalGraphRepository implements InternalGraphStorePort {
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
    const graph = await this.read();
    await this.replace({
      edges: graph.edges.filter((edge) => edge.path !== path),
      nodes: graph.nodes.filter((node) => node.path !== path),
    });
  }

  async listByPath(path: string): Promise<PersistedInternalGraphRecord> {
    const graph = await this.read();
    return {
      edges: graph.edges.filter((edge) => edge.path === path),
      nodes: graph.nodes.filter((node) => node.path === path),
    };
  }

  async read(): Promise<PersistedInternalGraphRecord> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as PersistedInternalGraphRecord;
    } catch {
      return EMPTY_GRAPH;
    }
  }

  async replace(records: PersistedInternalGraphRecord): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "graph",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }
}
