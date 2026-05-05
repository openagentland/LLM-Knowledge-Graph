import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OverlaySnapshot } from "../../application/dto/overlay.js";
import type { PersistedInternalGraphRecord } from "../../application/dto/structured-records.js";
import type { InternalGraphStorePort } from "../../application/ports/internal-graph-store-port.js";

const EMPTY_GRAPH: PersistedInternalGraphRecord = {
  edges: [],
  nodes: [],
};

const EMPTY_OVERLAYS: OverlaySnapshot = {
  records: [],
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
    await Promise.all([
      rm(this.resolveGraphPath(), { force: true }),
      rm(this.resolveOverlayPath(), { force: true }),
    ]);
  }

  async deleteByPath(path: string): Promise<void> {
    const [graph, overlays] = await Promise.all([
      this.read(),
      this.readOverlays(),
    ]);
    await Promise.all([
      this.replace({
        edges: graph.edges.filter((edge) => edge.path !== path),
        nodes: graph.nodes.filter((node) => node.path !== path),
      }),
      this.replaceOverlays({
        records: overlays.records.map((record) => ({
          ...record,
          edges: record.edges.filter((edge) => edge.path !== path),
          nodes: record.nodes.filter((node) => node.path !== path),
        })),
      }),
    ]);
  }

  async listByPath(path: string): Promise<PersistedInternalGraphRecord> {
    const graph = await this.read();
    return {
      edges: graph.edges.filter((edge) => edge.path === path),
      nodes: graph.nodes.filter((node) => node.path === path),
    };
  }

  async listEdgesByNode(
    nodeId: string,
  ): Promise<PersistedInternalGraphRecord["edges"]> {
    const graph = await this.read();
    return graph.edges.filter(
      (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId,
    );
  }

  async listNodesByPath(
    path: string,
  ): Promise<PersistedInternalGraphRecord["nodes"]> {
    const graph = await this.read();
    return graph.nodes.filter((node) => node.path === path);
  }

  async read(): Promise<PersistedInternalGraphRecord> {
    try {
      const content = await readFile(this.resolveGraphPath(), "utf8");
      return JSON.parse(content) as PersistedInternalGraphRecord;
    } catch {
      return EMPTY_GRAPH;
    }
  }

  async readOverlays(): Promise<OverlaySnapshot> {
    try {
      const content = await readFile(this.resolveOverlayPath(), "utf8");
      return JSON.parse(content) as OverlaySnapshot;
    } catch {
      return EMPTY_OVERLAYS;
    }
  }

  async replace(records: PersistedInternalGraphRecord): Promise<void> {
    const filePath = this.resolveGraphPath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  async replaceOverlays(snapshot: OverlaySnapshot): Promise<void> {
    const filePath = this.resolveOverlayPath();
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

  private resolveOverlayPath(): string {
    return resolve(
      this.options.homeDir,
      "overlays",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }
}
