import { createHash } from "node:crypto";

import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import {
  detectRelationEndpointMatch,
  mapOppositeRelationAnchor,
  relationMatchesDirection,
  resolveAnalysisAnchor,
  toDerivedEvidence,
  toRelationFlowSegment,
} from "../analysis-anchor-resolution.js";
import type {
  AnalyzeImpactCommand,
  AnalyzeImpactResult,
} from "../dto/analysis.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

const DEFAULT_MAX_RESULTS = 25;
const MAX_RESULTS = 200;
const MODE_RELATION_KINDS = {
  all: new Set([
    "caller-callee-candidate",
    "symbol-references-symbol-candidate",
    "file-imports-file",
    "file-imports-package",
    "workflow-runs-package-script-candidate",
    "workflow-contains-job",
    "job-runs-step",
    "quality-gate-runs-command",
    "quality-gate-runs-script-candidate",
    "task-runs-command",
    "file-declares-entrypoint-candidate",
    "config-selects-entrypoint-candidate",
  ]),
  callees: new Set(["caller-callee-candidate"]),
  callers: new Set(["caller-callee-candidate"]),
  dependents: new Set([
    "symbol-references-symbol-candidate",
    "file-imports-file",
    "file-imports-package",
  ]),
  runtime: new Set([
    "workflow-runs-package-script-candidate",
    "workflow-contains-job",
    "job-runs-step",
    "task-runs-command",
    "file-declares-entrypoint-candidate",
    "config-selects-entrypoint-candidate",
  ]),
  tests: new Set([
    "quality-gate-runs-command",
    "quality-gate-runs-script-candidate",
  ]),
} as const;

export class AnalyzeImpactUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly derivedFactStore: DerivedFactStorePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(command: AnalyzeImpactCommand): Promise<AnalyzeImpactResult> {
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
        "The knowledge index is not ready for impact analysis.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    if (!command.target.name.trim()) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "target.name must not be empty.",
      );
    }

    const maxResults = normalizeMaxResults(command.maxResults);
    const confidenceMin = normalizeConfidenceMin(command.confidenceMin);
    const mode = command.mode ?? "all";
    const supportedRelationKinds = MODE_RELATION_KINDS[mode];
    const resolvedTarget = await resolveAnalysisAnchor(
      command.target,
      this.symbolCandidateStore,
    );
    const facts = await this.derivedFactStore.list();
    const matchingFacts = facts
      .map((fact) => ({
        fact,
        matchedEndpoint: detectRelationEndpointMatch(fact, resolvedTarget),
      }))
      .filter(
        (
          item,
        ): item is {
          fact: (typeof facts)[number];
          matchedEndpoint: "from" | "to";
        } => item.matchedEndpoint !== undefined,
      )
      .filter((item) => supportedRelationKinds.has(item.fact.kind))
      .filter((item) => item.fact.confidence >= confidenceMin)
      .filter((item) =>
        relationMatchesDirection(item.matchedEndpoint, modeToDirection(mode)),
      )
      .slice(0, maxResults);

    const impacts = matchingFacts.map(({ fact, matchedEndpoint }) => {
      const anchor = mapOppositeRelationAnchor({
        fallbackKind: command.target.kind,
        fallbackPath: fact.path,
        matchedEndpoint,
        relation: fact,
      });
      const precisionTier =
        fact.kind === "caller-callee-candidate"
          ? ("derived" as const)
          : ("possible" as const);
      const classification =
        fact.kind === "caller-callee-candidate"
          ? ("direct" as const)
          : ("possible" as const);
      const evidence = toDerivedEvidence(fact);
      const segment = toRelationFlowSegment({
        confidence: fact.confidence,
        evidence,
        from: resolvedTarget,
        precisionTier,
        relationKind: fact.kind,
        to: anchor,
      });

      return {
        anchor,
        classification,
        confidence: fact.confidence,
        evidence,
        impactId: createHash("sha256")
          .update(`${fact.evidenceId}:${anchor.id}`)
          .digest("hex"),
        kind: inferImpactKind(fact.kind),
        paths: [
          {
            confidence: fact.confidence,
            end: anchor,
            precisionTier,
            segments: [segment],
            start: resolvedTarget,
          },
        ],
        precisionTier,
        reasons: [
          {
            detail: `Impact candidate derived from relation ${fact.kind}`,
            evidence,
            precisionTier,
            relationKind: fact.kind,
          },
        ],
      };
    });

    const limitations = [
      {
        detail:
          impacts.length === 0
            ? "No supported impact candidates were found for the requested anchor within the current bounded derived-relation analysis."
            : "Phase 1 impact analysis is constrained to stored derived relations and cannot yet prove full transitive runtime blast radius.",
        kind: impacts.length === 0 ? "no-match" : "coverage",
      },
    ];

    return {
      impacts,
      limitations,
      summary: {
        directCount: impacts.filter(
          (impact) => impact.classification === "direct",
        ).length,
        possibleCount: impacts.filter(
          (impact) => impact.classification === "possible",
        ).length,
        transitiveCount: 0,
        truncated: matchingFacts.length >= maxResults,
      },
      target: resolvedTarget,
    };
  }
}

function normalizeMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined) {
    return DEFAULT_MAX_RESULTS;
  }

  if (!Number.isInteger(maxResults) || maxResults <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "maxResults must be a positive integer.",
      {
        maxResults,
      },
    );
  }

  return Math.min(maxResults, MAX_RESULTS);
}

function normalizeConfidenceMin(confidenceMin: number | undefined): number {
  if (confidenceMin === undefined) {
    return 0;
  }

  if (confidenceMin < 0 || confidenceMin > 1) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "confidenceMin must be between 0 and 1.",
      { confidenceMin },
    );
  }

  return confidenceMin;
}

function modeToDirection(
  mode: NonNullable<AnalyzeImpactCommand["mode"]>,
): "forward" | "backward" | "both" {
  switch (mode) {
    case "callers":
      return "backward";
    case "callees":
    case "dependents":
    case "tests":
    case "runtime":
      return "forward";
    case "all":
    default:
      return "both";
  }
}

function inferImpactKind(
  kind: string,
):
  | "symbol"
  | "file"
  | "module"
  | "package"
  | "test"
  | "workflow"
  | "entrypoint" {
  switch (kind) {
    case "workflow-runs-package-script-candidate":
      return "workflow";
    case "quality-gate-runs-script-candidate":
    case "quality-gate-runs-command":
      return "test";
    case "file-declares-entrypoint-candidate":
    case "config-selects-entrypoint-candidate":
      return "entrypoint";
    case "file-imports-file":
      return "file";
    default:
      return "symbol";
  }
}
