import { createHash } from "node:crypto";

import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import {
  detectRelationEndpointMatch,
  mapOppositeRelationAnchor,
  resolveAnalysisAnchor,
  type ResolvedAnchor,
} from "../analysis-anchor-resolution.js";
import {
  DEFAULT_ANALYSIS_BUDGET,
  MAX_ANALYSIS_BUDGET,
  type TraceFlowCommand,
  type TraceFlowResult,
} from "../dto/analysis.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type {
  PersistedDerivedFactRecord,
  PersistedInternalGraphEdgeRecord,
} from "../dto/structured-records.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { InternalGraphStorePort } from "../ports/internal-graph-store-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

const DEFAULT_INCLUDE = [
  "calls",
  "imports",
  "exports",
  "config",
  "workflow",
] as const;
const SUPPORTED_INCLUDE = new Set(DEFAULT_INCLUDE);
const EDGE_KIND_BY_INCLUDE = {
  calls: new Set(["caller-callee-candidate"]),
  config: new Set([
    "config-selects-entrypoint-candidate",
    "file-declares-entrypoint-candidate",
    "quality-gate-runs-command",
    "quality-gate-runs-script-candidate",
    "task-runs-command",
  ]),
  exports: new Set(["symbol-exported-from-file"]),
  imports: new Set(["file-imports-file", "file-imports-package"]),
  workflow: new Set([
    "workflow-runs-package-script-candidate",
    "workflow-contains-job",
    "job-runs-step",
  ]),
} as const;

type SupportedInclude = keyof typeof EDGE_KIND_BY_INCLUDE;
type TraversalDirection = NonNullable<TraceFlowCommand["direction"]>;
type TraversalStep = {
  edge: PersistedInternalGraphEdgeRecord;
  fact?: PersistedDerivedFactRecord;
  nextAnchor: ResolvedAnchor;
  segment: TraceFlowResult["traces"][number]["segments"][number];
};

export class TraceFlowUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly derivedFactStore: DerivedFactStorePort,
    private readonly internalGraphStore: InternalGraphStorePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(command: TraceFlowCommand): Promise<TraceFlowResult> {
    const status = await this.indexStatePort.getStatus(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );

    if (
      status === null ||
      status.lastIndexedAt === null ||
      status.needsReindex ||
      status.state === "error"
    ) {
      throw new LkgError(
        ERROR_CODES.ANALYSIS_NOT_READY,
        "The knowledge index is not ready for flow analysis.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    const from = command.from;
    if (from === undefined) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "from anchor is required for flow analysis.",
      );
    }

    const budget = {
      maxDepth: clamp(
        command.maxDepth,
        DEFAULT_ANALYSIS_BUDGET.maxDepth,
        MAX_ANALYSIS_BUDGET.maxDepth,
      ),
      maxNodes: clamp(
        command.maxNodes,
        DEFAULT_ANALYSIS_BUDGET.maxNodes,
        MAX_ANALYSIS_BUDGET.maxNodes,
      ),
      maxEvidence: DEFAULT_ANALYSIS_BUDGET.maxEvidence,
      timeBudgetMs: clamp(
        command.timeBudgetMs,
        DEFAULT_ANALYSIS_BUDGET.timeBudgetMs,
        MAX_ANALYSIS_BUDGET.timeBudgetMs,
      ),
    };

    const include = normalizeInclude(command.include);
    const direction = command.direction ?? "forward";
    const startedAt = Date.now();
    const [derivedFacts, startAnchor, endAnchor] = await Promise.all([
      this.derivedFactStore.list(),
      this.resolveAnchor(from),
      command.to ? this.resolveAnchor(command.to) : Promise.resolve(undefined),
    ]);
    const factByKindAndIds = indexFacts(derivedFacts);

    const limitations: NonNullable<TraceFlowResult["limitations"]> = [];
    const unsupportedIncludes = (command.include ?? []).filter(
      (item) => !SUPPORTED_INCLUDE.has(item as SupportedInclude),
    );
    if (unsupportedIncludes.length > 0) {
      limitations.push({
        detail: `Flow tracing does not yet support include categories: ${unsupportedIncludes.join(", ")}.`,
        failureClass: "RULE_PREREQUISITE_MISSING",
        kind: "unsupported-include",
      });
    }

    const { segments, terminatedAtTarget, truncated } = await this.traverse({
      budget,
      derivedFactsByKey: factByKindAndIds,
      direction,
      endAnchor,
      include,
      limitations,
      startAnchor,
      startedAt,
    });

    const completeness = determineCompleteness({
      endAnchor,
      limitations,
      segments,
      targetReached: terminatedAtTarget,
      truncated,
    });

    if (segments.length === 0) {
      limitations.push({
        detail:
          endAnchor === undefined
            ? "No supported evidence-backed flow segments were found from the requested anchor within the current analysis budget."
            : "No supported evidence-backed path was found between the requested anchors within the current analysis budget.",
        kind: "no-match",
      });
    }

    if (
      (command.include === undefined || command.include.length === 0) &&
      limitations.every((item) => item.kind !== "coverage")
    ) {
      limitations.push({
        detail:
          "Current flow tracing is bounded to indexed call, import, export, config, and workflow relations; overlay-backed control/data flow is not implemented yet.",
        kind: "coverage",
      });
    }

    const end = segments.at(-1)?.to ?? endAnchor;

    return {
      limitations,
      traces: [
        {
          completeness,
          confidence: aggregateTraceConfidence(segments),
          end,
          precisionTier: inferTracePrecision(segments),
          segments,
          start: startAnchor,
          traceId: createHash("sha256")
            .update(
              JSON.stringify({
                direction,
                from: startAnchor,
                include,
                maxDepth: budget.maxDepth,
                maxNodes: budget.maxNodes,
                timeBudgetMs: budget.timeBudgetMs,
                to: endAnchor,
              }),
            )
            .digest("hex"),
        },
      ],
    };
  }

  private async resolveAnchor(
    anchor: NonNullable<TraceFlowCommand["from"]>,
  ): Promise<ResolvedAnchor> {
    return resolveAnalysisAnchor(anchor, this.symbolCandidateStore);
  }

  private async traverse(options: {
    budget: {
      maxDepth: number;
      maxEvidence: number;
      maxNodes: number;
      timeBudgetMs: number;
    };
    derivedFactsByKey: Map<string, PersistedDerivedFactRecord>;
    direction: TraversalDirection;
    endAnchor?: ResolvedAnchor;
    include: SupportedInclude[];
    limitations: NonNullable<TraceFlowResult["limitations"]>;
    startAnchor: ResolvedAnchor;
    startedAt: number;
  }): Promise<{
    segments: TraceFlowResult["traces"][number]["segments"];
    terminatedAtTarget: boolean;
    truncated: boolean;
  }> {
    const segments: TraceFlowResult["traces"][number]["segments"] = [];
    const visitedNodeIds = new Set<string>();
    const visitedEdgeIds = new Set<string>();
    const queue: Array<{ anchor: ResolvedAnchor; depth: number }> = [
      { anchor: options.startAnchor, depth: 0 },
    ];
    let terminatedAtTarget = false;
    let truncated = false;

    while (queue.length > 0) {
      if (Date.now() - options.startedAt > options.budget.timeBudgetMs) {
        options.limitations.push({
          detail:
            "Flow traversal stopped after reaching the configured analysis time budget.",
          failureClass: "BUDGET_EXHAUSTED",
          kind: "budget",
        });
        truncated = true;
        break;
      }

      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      if (current.depth >= options.budget.maxDepth) {
        continue;
      }
      if (visitedNodeIds.size >= options.budget.maxNodes) {
        options.limitations.push({
          detail:
            "Flow traversal stopped after reaching the configured node budget.",
          failureClass: "BUDGET_EXHAUSTED",
          kind: "budget",
        });
        truncated = true;
        break;
      }

      visitedNodeIds.add(current.anchor.id);
      const steps = await this.listTraversalSteps(
        current.anchor,
        options.direction,
        options.include,
        options.derivedFactsByKey,
      );

      for (const step of steps) {
        if (visitedEdgeIds.has(step.edge.edgeId)) {
          continue;
        }
        visitedEdgeIds.add(step.edge.edgeId);
        segments.push(step.segment);

        if (
          options.endAnchor &&
          anchorsMatch(step.nextAnchor, options.endAnchor)
        ) {
          terminatedAtTarget = true;
          return { segments, terminatedAtTarget, truncated };
        }

        if (
          segments.length >= options.budget.maxDepth ||
          visitedNodeIds.size >= options.budget.maxNodes
        ) {
          options.limitations.push({
            detail:
              "Flow traversal stopped after reaching the configured analysis depth or node budget.",
            failureClass: "BUDGET_EXHAUSTED",
            kind: "budget",
          });
          truncated = true;
          return { segments, terminatedAtTarget, truncated };
        }

        if (!visitedNodeIds.has(step.nextAnchor.id)) {
          queue.push({ anchor: step.nextAnchor, depth: current.depth + 1 });
        }
      }
    }

    return { segments, terminatedAtTarget, truncated };
  }

  private async listTraversalSteps(
    anchor: ResolvedAnchor,
    direction: TraversalDirection,
    include: SupportedInclude[],
    factsByKey: Map<string, PersistedDerivedFactRecord>,
  ): Promise<TraversalStep[]> {
    const edges = await this.internalGraphStore.listEdgesByNode(anchor.id);
    const relevantEdges = edges
      .filter(
        (edge) =>
          edge.kind !== "REPRESENTS" && edge.kind !== "DEFINES_CANDIDATE",
      )
      .filter((edge) =>
        include.some((item) => EDGE_KIND_BY_INCLUDE[item].has(edge.kind)),
      )
      .filter((edge) => matchesDirection(edge, anchor.id, direction))
      .sort(compareEdges);

    return relevantEdges
      .map((edge) => {
        const nextNodeId =
          edge.fromNodeId === anchor.id ? edge.toNodeId : edge.fromNodeId;
        const fact = factsByKey.get(toFactKey(edge.kind, edge.evidenceId));
        const nextAnchor = this.toResolvedAnchor(
          nextNodeId,
          edge,
          fact,
          anchor.id,
        );
        return {
          edge,
          fact,
          nextAnchor,
          segment: toFlowSegment(anchor, nextAnchor, edge, fact),
        };
      })
      .sort(compareTraversalSteps);
  }

  private toResolvedAnchor(
    nodeId: string,
    edge: PersistedInternalGraphEdgeRecord,
    fact: PersistedDerivedFactRecord | undefined,
    currentAnchorId: string,
  ): ResolvedAnchor {
    const matchedEndpoint = detectRelationEndpointMatch(fact ?? edge, {
      id: currentAnchorId,
      kind: "symbol",
      name: currentAnchorId,
    });

    if (matchedEndpoint !== undefined) {
      return mapOppositeRelationAnchor({
        fallbackKind: inferAnchorKindFromEdge(edge.kind),
        fallbackPath: edge.path,
        matchedEndpoint,
        relation: fact ?? edge,
      });
    }

    const isForward = edge.fromNodeId === currentAnchorId;
    const id = isForward
      ? (readString(fact?.payload.toId) ??
        readString(edge.properties.toId) ??
        nodeId)
      : (readString(fact?.payload.fromId) ??
        readString(edge.properties.fromId) ??
        nodeId);
    const label = isForward
      ? (readString(fact?.payload.toLabel) ??
        readString(edge.properties.toLabel))
      : (readString(fact?.payload.fromLabel) ??
        readString(edge.properties.fromLabel));
    const kind = isForward
      ? (readAnchorKind(fact?.payload.toKind) ??
        inferAnchorKindFromEdge(edge.kind))
      : (readAnchorKind(fact?.payload.fromKind) ??
        inferAnchorKindFromEdge(edge.kind));

    return {
      codeLocation: fact?.codeLocation,
      id,
      kind,
      name: label ?? id,
      path: fact?.path ?? edge.path,
      sourceType: fact?.sourceType ?? edge.sourceType,
    };
  }
}

function normalizeInclude(
  include: TraceFlowCommand["include"],
): SupportedInclude[] {
  const requested = include?.filter((item): item is SupportedInclude =>
    SUPPORTED_INCLUDE.has(item as SupportedInclude),
  );

  if (requested === undefined || requested.length === 0) {
    return [...DEFAULT_INCLUDE];
  }

  return requested;
}

function indexFacts(
  records: PersistedDerivedFactRecord[],
): Map<string, PersistedDerivedFactRecord> {
  const map = new Map<string, PersistedDerivedFactRecord>();
  for (const record of records) {
    map.set(toFactKey(record.kind, record.evidenceId), record);
  }
  return map;
}

function toFactKey(kind: string, evidenceId: string): string {
  return `${kind}:${evidenceId}`;
}

function matchesDirection(
  edge: PersistedInternalGraphEdgeRecord,
  anchorId: string,
  direction: TraversalDirection,
): boolean {
  if (direction === "both") {
    return edge.fromNodeId === anchorId || edge.toNodeId === anchorId;
  }
  if (direction === "forward") {
    return edge.fromNodeId === anchorId;
  }
  return edge.toNodeId === anchorId;
}

function compareEdges(
  left: PersistedInternalGraphEdgeRecord,
  right: PersistedInternalGraphEdgeRecord,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.path.localeCompare(right.path) ||
    left.edgeId.localeCompare(right.edgeId)
  );
}

function compareTraversalSteps(
  left: TraversalStep,
  right: TraversalStep,
): number {
  return (
    compareAnchors(left.nextAnchor, right.nextAnchor) ||
    left.edge.edgeId.localeCompare(right.edge.edgeId)
  );
}

function compareAnchors(left: ResolvedAnchor, right: ResolvedAnchor): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function anchorsMatch(left: ResolvedAnchor, right: ResolvedAnchor): boolean {
  return (
    left.id === right.id ||
    (left.kind === right.kind &&
      left.name === right.name &&
      (left.path ?? "") === (right.path ?? ""))
  );
}

function toFlowSegment(
  from: ResolvedAnchor,
  to: ResolvedAnchor,
  edge: PersistedInternalGraphEdgeRecord,
  fact: PersistedDerivedFactRecord | undefined,
) {
  const evidence = [
    {
      codeLocation: fact?.codeLocation,
      path: fact?.path ?? edge.path,
      precisionTier: inferPrecisionTier(edge.kind),
      provenance: {
        contentHash: fact?.contentHash ?? edge.contentHash,
        evidenceId: fact?.evidenceId ?? edge.evidenceId,
        extractor: fact?.extractor ?? edge.extractor,
        indexRunId: fact?.indexRunId ?? edge.indexRunId,
        path: fact?.path ?? edge.path,
      },
      sourceType: fact?.sourceType ?? edge.sourceType,
    },
  ];

  return {
    confidence: fact?.confidence ?? edge.confidence,
    evidence,
    from,
    precisionTier: inferPrecisionTier(edge.kind),
    relationKind: edge.kind,
    to,
  };
}

function inferPrecisionTier(kind: string): "derived" | "possible" {
  switch (kind) {
    case "file-declares-entrypoint-candidate":
    case "config-selects-entrypoint-candidate":
    case "quality-gate-runs-command":
    case "task-runs-command":
      return "possible";
    default:
      return "derived";
  }
}

function inferTracePrecision(
  segments: TraceFlowResult["traces"][number]["segments"],
): TraceFlowResult["traces"][number]["precisionTier"] {
  if (segments.length === 0) {
    return "unknown";
  }
  if (segments.some((segment) => segment.precisionTier === "possible")) {
    return "possible";
  }
  return "derived";
}

function aggregateTraceConfidence(
  segments: TraceFlowResult["traces"][number]["segments"],
): number {
  if (segments.length === 0) {
    return 0;
  }
  return Number(
    segments
      .reduce((lowest, segment) => Math.min(lowest, segment.confidence), 1)
      .toFixed(6),
  );
}

function determineCompleteness(options: {
  endAnchor?: ResolvedAnchor;
  limitations: NonNullable<TraceFlowResult["limitations"]>;
  segments: TraceFlowResult["traces"][number]["segments"];
  targetReached: boolean;
  truncated: boolean;
}): TraceFlowResult["traces"][number]["completeness"] {
  if (options.truncated) {
    return "truncated";
  }
  if (
    options.endAnchor &&
    !options.targetReached &&
    options.segments.length > 0
  ) {
    return "ambiguous";
  }
  if (options.endAnchor && options.targetReached) {
    return "complete";
  }
  if (options.segments.length === 0) {
    return "partial";
  }
  return "partial";
}

function clamp(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "analysis budget values must be positive integers.",
      {
        value,
      },
    );
  }

  return Math.min(value, max);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readAnchorKind(value: unknown): ResolvedAnchor["kind"] | undefined {
  if (
    value === "symbol" ||
    value === "file" ||
    value === "module" ||
    value === "package" ||
    value === "entrypoint" ||
    value === "workflow" ||
    value === "task" ||
    value === "quality_gate" ||
    value === "config_artifact"
  ) {
    return value;
  }
  return undefined;
}

function inferAnchorKindFromEdge(kind: string): ResolvedAnchor["kind"] {
  switch (kind) {
    case "file-imports-file":
      return "file";
    case "file-imports-package":
      return "package";
    case "workflow-runs-package-script-candidate":
    case "workflow-contains-job":
      return "workflow";
    case "job-runs-step":
      return "task";
    case "quality-gate-runs-command":
    case "quality-gate-runs-script-candidate":
      return "quality_gate";
    case "config-selects-entrypoint-candidate":
      return "config_artifact";
    default:
      return "symbol";
  }
}
