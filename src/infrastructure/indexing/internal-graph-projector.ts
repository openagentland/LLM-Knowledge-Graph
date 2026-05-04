import { createHash } from "node:crypto";

import type {
  InternalGraphEdgeRecord,
  InternalGraphNodeRecord,
  PersistedCanonicalFactRecord,
  PersistedDerivedFactRecord,
  PersistedInternalGraphRecord,
  PersistedSymbolCandidateRecord,
} from "../../application/dto/structured-records.js";
import type { StructuredDataProjectorPort } from "../../application/ports/structured-data-projector-port.js";
import {
  getCanonicalDescriptor,
} from "../../domain/index.js";

export class InternalGraphProjector implements StructuredDataProjectorPort {
  project(input: {
    canonicalFacts: PersistedCanonicalFactRecord[];
    derivedFacts: PersistedDerivedFactRecord[];
    symbolCandidates: PersistedSymbolCandidateRecord[];
  }): PersistedInternalGraphRecord {
    const nodes = new Map<string, InternalGraphNodeRecord>();
    const edges = new Map<string, InternalGraphEdgeRecord>();

    for (const symbol of input.symbolCandidates) {
      const fileNodeId = nodeId("File", symbol.path);
      const symbolNodeId = nodeId("SymbolCandidate", symbol.evidenceId);
      upsertNode(nodes, {
        confidence: 1,
        contentHash: symbol.contentHash,
        evidenceId: symbol.evidenceId,
        extractor: symbol.extractor,
        indexRunId: symbol.indexRunId,
        kind: "File",
        layer: "graph",
        nodeId: fileNodeId,
        path: symbol.path,
        properties: { path: symbol.path, sourceType: symbol.sourceType },
        sourceType: symbol.sourceType,
      });
      upsertNode(nodes, {
        confidence: 1,
        contentHash: symbol.contentHash,
        evidenceId: symbol.evidenceId,
        extractor: symbol.extractor,
        codeLocation: symbol.codeLocation,
        indexRunId: symbol.indexRunId,
        kind: "SymbolCandidate",
        layer: "graph",
        nodeId: symbolNodeId,
        path: symbol.path,
        properties: {
          kind: symbol.kind,
          language: symbol.language,
          name: symbol.name,
          scope: symbol.scope,
        },
        sourceType: symbol.sourceType,
      });
      upsertEdge(edges, {
        confidence: 1,
        contentHash: symbol.contentHash,
        edgeId: edgeId(fileNodeId, "DEFINES_CANDIDATE", symbolNodeId),
        evidenceId: symbol.evidenceId,
        extractor: symbol.extractor,
        fromNodeId: fileNodeId,
        indexRunId: symbol.indexRunId,
        kind: "DEFINES_CANDIDATE",
        layer: "graph",
        path: symbol.path,
        properties: {},
        sourceType: symbol.sourceType,
        toNodeId: symbolNodeId,
      });
    }

    for (const fact of input.canonicalFacts) {
      const factNodeId = nodeId("CanonicalFact", fact.factId);
      upsertNode(nodes, {
        confidence: fact.confidence,
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        codeLocation: fact.codeLocation,
        indexRunId: fact.indexRunId,
        kind: `CanonicalFact:${fact.kind}`,
        layer: "graph",
        nodeId: factNodeId,
        path: fact.path,
        properties: fact.payload,
        sourceType: fact.sourceType,
      });

      const domainNode = toCanonicalDomainNode(fact);
      if (domainNode !== null) {
        upsertNode(nodes, domainNode);
        upsertEdge(edges, {
          confidence: fact.confidence,
          contentHash: fact.contentHash,
          edgeId: edgeId(factNodeId, "REPRESENTS", domainNode.nodeId),
          evidenceId: fact.evidenceId,
          extractor: fact.extractor,
          fromNodeId: factNodeId,
          indexRunId: fact.indexRunId,
          kind: "REPRESENTS",
          layer: "graph",
          path: fact.path,
          properties: fact.payload,
          sourceType: fact.sourceType,
          toNodeId: domainNode.nodeId,
        });
      }
    }

    for (const fact of input.derivedFacts) {
      const fromKind =
        typeof fact.payload.fromKind === "string" ? fact.payload.fromKind : "Entity";
      const fromId =
        typeof fact.payload.fromId === "string" ? fact.payload.fromId : fact.path;
      const toKind =
        typeof fact.payload.toKind === "string" ? fact.payload.toKind : "Entity";
      const toId =
        typeof fact.payload.toId === "string" ? fact.payload.toId : fact.derivedFactId;
      const fromLabel =
        typeof fact.payload.fromLabel === "string" ? fact.payload.fromLabel : undefined;
      const toLabel =
        typeof fact.payload.toLabel === "string" ? fact.payload.toLabel : undefined;
      const fromNodeId = nodeId(fromKind, fromId);
      const toNodeId = nodeId(toKind, toId);
      upsertNode(nodes, {
        confidence: fact.confidence,
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        indexRunId: fact.indexRunId,
        kind: fromKind,
        layer: "graph",
        nodeId: fromNodeId,
        path: fact.path,
        properties: { id: fromId, label: fromLabel },
        sourceType: fact.sourceType,
      });
      upsertNode(nodes, {
        confidence: fact.confidence,
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        indexRunId: fact.indexRunId,
        kind: toKind,
        layer: "graph",
        nodeId: toNodeId,
        path: fact.path,
        properties: { id: toId, label: toLabel },
        sourceType: fact.sourceType,
      });
      upsertEdge(edges, {
        confidence: fact.confidence,
        contentHash: fact.contentHash,
        edgeId: edgeId(fromNodeId, fact.kind, toNodeId),
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        fromNodeId,
        indexRunId: fact.indexRunId,
        kind: fact.kind,
        layer: "graph",
        path: fact.path,
        properties: fact.payload,
        sourceType: fact.sourceType,
        toNodeId,
      });
    }

    return {
      edges: Array.from(edges.values()).sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
      nodes: Array.from(nodes.values()).sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    };
  }
}

function nodeId(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function edgeId(fromNodeId: string, kind: string, toNodeId: string): string {
  return createHash("sha256").update(`${fromNodeId}:${kind}:${toNodeId}`).digest("hex");
}

function upsertNode(map: Map<string, InternalGraphNodeRecord>, node: InternalGraphNodeRecord): void {
  map.set(node.nodeId, node);
}

function toCanonicalDomainNode(
  fact: PersistedCanonicalFactRecord,
): InternalGraphNodeRecord | null {
  const descriptor = getCanonicalDescriptor(fact);
  if (descriptor === null) {
    return null;
  }

  return {
    confidence: fact.confidence,
    contentHash: fact.contentHash,
    evidenceId: fact.evidenceId,
    extractor: fact.extractor,
    codeLocation: fact.codeLocation,
    indexRunId: fact.indexRunId,
    kind: descriptor.kind,
    layer: "graph",
    nodeId: nodeId(descriptor.kind, descriptor.id),
    path: fact.path,
    properties: {
      id: descriptor.id,
      label: descriptor.label,
      ...fact.payload,
    },
    sourceType: fact.sourceType,
  };
}

function upsertEdge(map: Map<string, InternalGraphEdgeRecord>, edge: InternalGraphEdgeRecord): void {
  map.set(edge.edgeId, edge);
}
