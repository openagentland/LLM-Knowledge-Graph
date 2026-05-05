import type {
  OverlayEdgeRecord,
  OverlayNodeRecord,
  OverlayRecord,
} from "../../application/dto/overlay.js";
import type { PersistedDerivedFactRecord } from "../../application/dto/structured-records.js";
import type { OverlayBuilderPort } from "../../application/ports/overlay-builder-port.js";

const OVERLAY_VERSION = "milestone-4.1";

export class DerivedFactOverlayBuilder implements OverlayBuilderPort {
  build(records: {
    derivedFacts: PersistedDerivedFactRecord[];
  }): Promise<OverlayRecord[]> {
    const nodes = new Map<string, OverlayNodeRecord>();
    const cfgEdges: OverlayEdgeRecord[] = [];
    const dataFlowEdges: OverlayEdgeRecord[] = [];
    const pdgEdges: OverlayEdgeRecord[] = [];

    for (const fact of records.derivedFacts) {
      const fromId = asString(fact.payload.fromId);
      const toId = asString(fact.payload.toId);
      if (fromId === undefined || toId === undefined) {
        continue;
      }

      nodes.set(fromId, createNode(fact, fromId, "from"));
      nodes.set(toId, createNode(fact, toId, "to"));

      const target = classifyOverlayEdge(fact.kind, {
        cfgEdges,
        dataFlowEdges,
        pdgEdges,
      });
      if (target === null) {
        continue;
      }

      const edge = createEdge(fact, target.edgeKind, fromId, toId);
      target.bucket.push(edge);
    }

    return Promise.resolve([
      createOverlayRecord("cfg", nodes, cfgEdges),
      createOverlayRecord("data_flow", nodes, dataFlowEdges),
      createOverlayRecord("pdg_lite", nodes, pdgEdges),
    ]);
  }
}

function createOverlayRecord(
  kind: OverlayRecord["kind"],
  nodeMap: Map<string, OverlayNodeRecord>,
  edges: OverlayEdgeRecord[],
): OverlayRecord {
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.fromId);
    nodeIds.add(edge.toId);
  }

  return {
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    generatedAt: new Date(0).toISOString(),
    kind,
    nodes: Array.from(nodeIds)
      .map((id) => nodeMap.get(id))
      .filter((node): node is OverlayNodeRecord => node !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id)),
    version: OVERLAY_VERSION,
  };
}

function createNode(
  fact: PersistedDerivedFactRecord,
  id: string,
  endpoint: "from" | "to",
): OverlayNodeRecord {
  const label =
    asString(
      endpoint === "from" ? fact.payload.fromLabel : fact.payload.toLabel,
    ) ?? id;
  return {
    endLine: fact.codeLocation?.endLine,
    id,
    kind:
      asString(
        endpoint === "from" ? fact.payload.fromKind : fact.payload.toKind,
      ) ?? "Unknown",
    label,
    path: fact.path,
    sourceType: fact.sourceType,
    startLine: fact.codeLocation?.startLine,
  };
}

function createEdge(
  fact: PersistedDerivedFactRecord,
  kind: OverlayEdgeRecord["kind"],
  fromId: string,
  toId: string,
): OverlayEdgeRecord {
  return {
    confidence: fact.confidence,
    fromId,
    id: `${kind}:${fact.derivedFactId}`,
    kind,
    path: fact.path,
    sourceType: fact.sourceType,
    toId,
  };
}

function classifyOverlayEdge(
  kind: PersistedDerivedFactRecord["kind"],
  buckets: {
    cfgEdges: OverlayEdgeRecord[];
    dataFlowEdges: OverlayEdgeRecord[];
    pdgEdges: OverlayEdgeRecord[];
  },
): {
  bucket: OverlayEdgeRecord[];
  edgeKind: OverlayEdgeRecord["kind"];
} | null {
  switch (kind) {
    case "caller-callee-candidate":
      return { bucket: buckets.cfgEdges, edgeKind: "cfg-next" };
    case "symbol-references-symbol-candidate":
      return { bucket: buckets.dataFlowEdges, edgeKind: "data-flow" };
    case "file-imports-file":
    case "file-imports-package":
    case "workflow-runs-package-script-candidate":
    case "quality-gate-runs-script-candidate":
    case "config-selects-entrypoint-candidate":
      return { bucket: buckets.pdgEdges, edgeKind: "pdg-lite" };
    default:
      return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
