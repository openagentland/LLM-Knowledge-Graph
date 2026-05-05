import type {
  Anchor,
  AnchorKind,
  EvidenceItem,
  FlowSegment,
  PrecisionTier,
} from "../domain/index.js";
import type {
  PersistedDerivedFactRecord,
  PersistedInternalGraphEdgeRecord,
} from "./dto/structured-records.js";
import type { SymbolSearchResult } from "./dto/symbols.js";
import type { SymbolCandidateStorePort } from "./ports/symbol-candidate-store-port.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

export type ResolvedAnchor = Anchor & { id: string };
export type RelationEndpoint = "from" | "to";

type RelationPayloadCarrier =
  | Pick<PersistedDerivedFactRecord, "payload">
  | Pick<PersistedInternalGraphEdgeRecord, "properties">;

type RelationAnchorShape =
  | Pick<
      PersistedDerivedFactRecord,
      "path" | "payload" | "sourceType" | "codeLocation"
    >
  | Pick<
      PersistedInternalGraphEdgeRecord,
      "path" | "properties" | "sourceType"
    >;

export async function resolveAnalysisAnchor(
  anchor: Anchor,
  symbolCandidateStore: SymbolCandidateStorePort,
): Promise<ResolvedAnchor> {
  if (anchor.kind !== "symbol") {
    return resolveNonSymbolAnchor(anchor);
  }

  if (anchor.id !== undefined && anchor.id.trim()) {
    return { ...anchor, id: anchor.id };
  }

  const candidates = await symbolCandidateStore.list(
    anchor.path !== undefined && anchor.path.trim().length > 0
      ? { path: anchor.path, sourceType: anchor.sourceType }
      : { sourceType: anchor.sourceType },
  );
  const ranked = candidates
    .filter((candidate) => candidate.name === anchor.name)
    .map((candidate) => toCandidateResult(candidate, anchor.path))
    .sort(compareCandidates);

  if (ranked.length === 0) {
    throw new LkgError(
      ERROR_CODES.ANCHOR_NOT_FOUND,
      `Anchor not found: ${anchor.name}`,
      {
        anchor,
      },
    );
  }

  if (ranked.length > 1 && haveEquivalentTopRank(ranked[0], ranked[1])) {
    throw new LkgError(
      ERROR_CODES.AMBIGUOUS_ANCHOR,
      `Anchor is ambiguous: ${anchor.name}`,
      {
        anchor,
        candidates: ranked.slice(0, 5),
      },
    );
  }

  return {
    ...anchor,
    codeLocation: ranked[0]?.evidence.codeLocation,
    id: ranked[0]?.evidence.evidenceId ?? anchor.name,
    path: ranked[0]?.evidence.path ?? anchor.path,
    sourceType: ranked[0]?.sourceType ?? anchor.sourceType,
  };
}

export function resolveNonSymbolAnchor(anchor: Anchor): ResolvedAnchor {
  if (anchor.id !== undefined && anchor.id.trim()) {
    return { ...anchor, id: anchor.id };
  }
  if (anchor.path !== undefined && anchor.path.trim()) {
    return { ...anchor, id: `${anchor.kind}:${anchor.path}` };
  }
  if (anchor.name.trim()) {
    return { ...anchor, id: `${anchor.kind}:${anchor.name}` };
  }
  throw new LkgError(
    ERROR_CODES.ANCHOR_NOT_FOUND,
    `Unable to resolve ${anchor.kind} anchor.`,
    {
      anchor,
    },
  );
}

export function detectRelationEndpointMatch(
  relation: RelationPayloadCarrier,
  anchor: ResolvedAnchor,
): RelationEndpoint | undefined {
  const payload =
    "payload" in relation ? relation.payload : relation.properties;
  const from = readRelationAnchor(payload, "from");
  const to = readRelationAnchor(payload, "to");

  if (from && anchorsEquivalent(anchor, from)) {
    return "from";
  }
  if (to && anchorsEquivalent(anchor, to)) {
    return "to";
  }
  return undefined;
}

export function mapOppositeRelationAnchor(options: {
  relation: RelationAnchorShape;
  matchedEndpoint: RelationEndpoint;
  fallbackKind: AnchorKind;
  fallbackPath?: string;
}): ResolvedAnchor {
  const payload =
    "payload" in options.relation
      ? options.relation.payload
      : options.relation.properties;
  const oppositeEndpoint = options.matchedEndpoint === "from" ? "to" : "from";
  const opposite = readRelationAnchor(payload, oppositeEndpoint);
  const codeLocation =
    "codeLocation" in options.relation
      ? options.relation.codeLocation
      : undefined;
  const path = options.relation.path;

  return {
    codeLocation,
    id: opposite?.id ?? `${options.fallbackKind}:${path}`,
    kind: opposite?.kind ?? options.fallbackKind,
    name: opposite?.name ?? opposite?.id ?? path,
    path,
    sourceType: options.relation.sourceType,
  };
}

export function toDerivedEvidence(
  fact: PersistedDerivedFactRecord,
): EvidenceItem[] {
  return [
    {
      codeLocation: fact.codeLocation,
      path: fact.path,
      precisionTier: "derived",
      provenance: {
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        indexRunId: fact.indexRunId,
        path: fact.path,
      },
      sourceType: fact.sourceType,
    },
  ];
}

export function toRelationFlowSegment(options: {
  confidence: number;
  evidence: EvidenceItem[];
  from: ResolvedAnchor;
  precisionTier: PrecisionTier;
  relationKind: string;
  to: ResolvedAnchor;
}): FlowSegment {
  return {
    confidence: options.confidence,
    evidence: options.evidence,
    from: options.from,
    precisionTier: options.precisionTier,
    relationKind: options.relationKind,
    to: options.to,
  };
}

export function relationUsesInclude(
  relationKind: string,
  include: ReadonlySet<string>,
): boolean {
  if (
    include.has("calls") &&
    (relationKind === "caller-callee-candidate" ||
      relationKind === "symbol-references-symbol-candidate")
  ) {
    return true;
  }
  if (include.has("imports") && relationKind.startsWith("file-imports-")) {
    return true;
  }
  if (
    include.has("config") &&
    (relationKind === "config-selects-entrypoint-candidate" ||
      relationKind === "file-declares-entrypoint-candidate" ||
      relationKind === "quality-gate-runs-command" ||
      relationKind === "quality-gate-runs-script-candidate" ||
      relationKind === "task-runs-command")
  ) {
    return true;
  }
  if (include.has("control") || include.has("data")) {
    return false;
  }
  return false;
}

export function relationMatchesDirection(
  matchedEndpoint: RelationEndpoint,
  direction: "forward" | "backward" | "both",
): boolean {
  if (direction === "both") {
    return true;
  }
  if (direction === "forward") {
    return matchedEndpoint === "from";
  }
  return matchedEndpoint === "to";
}

function readRelationAnchor(
  payload: Record<string, unknown>,
  endpoint: RelationEndpoint,
): ResolvedAnchor | undefined {
  const id = readString(payload[`${endpoint}Id`]);
  const name = readString(payload[`${endpoint}Label`]) ?? id;

  if (id === undefined && name === undefined) {
    return undefined;
  }

  return {
    id: id ?? name ?? "unknown",
    kind: readAnchorKind(payload[`${endpoint}Kind`]) ?? "symbol",
    name: name ?? id ?? "unknown",
  };
}

function anchorsEquivalent(
  left: ResolvedAnchor,
  right: ResolvedAnchor,
): boolean {
  return (
    left.id === right.id ||
    (left.kind === right.kind &&
      left.name === right.name &&
      (left.path ?? "") === (right.path ?? ""))
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readAnchorKind(value: unknown): AnchorKind | undefined {
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

function toCandidateResult(
  candidate: Awaited<ReturnType<SymbolCandidateStorePort["list"]>>[number],
  path: string | undefined,
): SymbolSearchResult {
  const exactNameMatch = true;
  const exactPathMatch =
    path !== undefined && candidate.path.toLowerCase() === path.toLowerCase();
  const confidence =
    typeof (candidate as { confidence?: unknown }).confidence === "number"
      ? ((candidate as { confidence?: number }).confidence ?? 0)
      : candidate.signature !== undefined
        ? 0.95
        : 0.75;

  return {
    confidence,
    containerName: candidate.containerName,
    evidence: {
      codeLocation: candidate.codeLocation,
      contentHash: candidate.contentHash,
      evidenceId: candidate.evidenceId,
      extractor: candidate.extractor,
      path: candidate.path,
    },
    indexRunId: candidate.indexRunId,
    kind: candidate.kind,
    language: candidate.language,
    name: candidate.name,
    ranking: {
      exactNameMatch,
      exactPathMatch,
      kindMatch: false,
      score: 1000 + (exactPathMatch ? 100 : 0) + confidence,
    },
    scope: candidate.scope,
    signature: candidate.signature,
    sourceType: candidate.sourceType,
  };
}

function compareCandidates(
  left: SymbolSearchResult,
  right: SymbolSearchResult,
): number {
  const leftCodeLocation = left.evidence.codeLocation as
    | { startLine: number }
    | undefined;
  const rightCodeLocation = right.evidence.codeLocation as
    | { startLine: number }
    | undefined;
  const leftStartLine = leftCodeLocation?.startLine ?? Number.MAX_SAFE_INTEGER;
  const rightStartLine =
    rightCodeLocation?.startLine ?? Number.MAX_SAFE_INTEGER;
  const leftScore = left.ranking?.score ?? 0;
  const rightScore = right.ranking?.score ?? 0;
  const leftConfidence = left.confidence ?? 0;
  const rightConfidence = right.confidence ?? 0;

  return (
    rightScore - leftScore ||
    rightConfidence - leftConfidence ||
    left.evidence.path.localeCompare(right.evidence.path) ||
    leftStartLine - rightStartLine ||
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name)
  );
}

function haveEquivalentTopRank(
  left: SymbolSearchResult | undefined,
  right: SymbolSearchResult | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return (
    (left.ranking?.score ?? 0) === (right.ranking?.score ?? 0) &&
    (left.confidence ?? 0) === (right.confidence ?? 0)
  );
}
