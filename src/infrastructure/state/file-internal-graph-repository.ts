import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PersistedInternalGraphRecord } from "../../application/dto/structured-records.js";
import type {
  InternalGraphSnapshot,
  InternalGraphStorePort,
} from "../../application/ports/internal-graph-store-port.js";

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
    await rm(this.resolveGraphPath(), { force: true });
  }

  async deleteByPath(path: string): Promise<void> {
    const snapshot = await this.readSnapshot();
    await this.replaceSnapshot({
      edges: snapshot.edges.filter((edge) => edge.path !== path),
      nodes: snapshot.nodes.filter((node) => node.path !== path),
    });
  }

  async listByPath(path: string): Promise<PersistedInternalGraphRecord> {
    const graph = await this.readSnapshot();
    return {
      edges: graph.edges.filter((edge) => edge.path === path),
      nodes: graph.nodes.filter((node) => node.path === path),
    };
  }

  async listEdgesByNode(
    nodeId: string,
  ): Promise<PersistedInternalGraphRecord["edges"]> {
    const graph = await this.readSnapshot();
    return graph.edges.filter(
      (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId,
    );
  }

  async listNodesByPath(
    path: string,
  ): Promise<PersistedInternalGraphRecord["nodes"]> {
    const graph = await this.readSnapshot();
    return graph.nodes.filter((node) => node.path === path);
  }

  async readSnapshot(): Promise<InternalGraphSnapshot> {
    try {
      const content = await readFile(this.resolveGraphPath(), "utf8");
      return JSON.parse(content) as PersistedInternalGraphRecord;
    } catch {
      return EMPTY_GRAPH;
    }
  }

  async replaceSnapshot(snapshot: InternalGraphSnapshot): Promise<void> {
    const filePath = this.resolveGraphPath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  private resolveGraphPath(): string {
    return resolve(
      this.options.homeDir,
      "graph",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }
}
