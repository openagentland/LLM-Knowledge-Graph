import { createHash } from "node:crypto";

import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import {
  detectRelationEndpointMatch,
  mapOppositeRelationAnchor,
  relationMatchesDirection,
  relationUsesInclude,
  resolveAnalysisAnchor,
  toDerivedEvidence,
  toRelationFlowSegment,
} from "../analysis-anchor-resolution.js";
import type {
  ComputeSliceCommand,
  ComputeSliceResult,
} from "../dto/analysis.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

const DEFAULT_MAX_ITEMS = 40;
const MAX_ITEMS = 200;

export class ComputeSliceUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly derivedFactStore: DerivedFactStorePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(command: ComputeSliceCommand): Promise<ComputeSliceResult> {
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
        "The knowledge index is not ready for slice analysis.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    if (!command.criterion.name.trim()) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "criterion.name must not be empty.",
      );
    }

    const maxItems = normalizeMaxItems(command.maxNodes ?? command.maxEvidence);
    const maxFiles = normalizeOptionalPositive(command.maxFiles, "maxFiles");
    const include = new Set(
      command.include ?? ["calls", "control", "data", "imports", "config"],
    );
    const direction = command.direction ?? "both";
    const resolvedCriterion = await resolveAnalysisAnchor(
      command.criterion,
      this.symbolCandidateStore,
    );
    const facts = await this.derivedFactStore.list();
    const fileSet = new Set<string>();
    const matchingFacts = facts
      .map((fact) => ({
        fact,
        matchedEndpoint: detectRelationEndpointMatch(fact, resolvedCriterion),
      }))
      .filter(
        (
          item,
        ): item is {
          fact: (typeof facts)[number];
          matchedEndpoint: "from" | "to";
        } => item.matchedEndpoint !== undefined,
      )
      .filter((item) =>
        relationMatchesDirection(item.matchedEndpoint, direction),
      )
      .filter((item) => relationUsesInclude(item.fact.kind, include))
      .filter((item) => {
        if (maxFiles === undefined) {
          return true;
        }
        if (fileSet.has(item.fact.path)) {
          return true;
        }
        if (fileSet.size >= maxFiles) {
          return false;
        }
        fileSet.add(item.fact.path);
        return true;
      })
      .slice(0, maxItems);

    const items = matchingFacts.map(({ fact, matchedEndpoint }) => {
      const anchor = mapOppositeRelationAnchor({
        fallbackKind: command.criterion.kind,
        fallbackPath: fact.path,
        matchedEndpoint,
        relation: fact,
      });
      const evidence = toDerivedEvidence(fact);
      const segment = toRelationFlowSegment({
        confidence: fact.confidence,
        evidence,
        from: resolvedCriterion,
        precisionTier: "derived",
        relationKind: fact.kind,
        to: anchor,
      });

      return {
        anchor,
        confidence: fact.confidence,
        evidence,
        inclusionReason: `Included via relation ${fact.kind}`,
        precisionTier: "derived" as const,
        relationPath: [segment],
      };
    });

    return {
      completeness: matchingFacts.length >= maxItems ? "truncated" : "partial",
      criterion: resolvedCriterion,
      items,
      limitations: [
        {
          detail:
            items.length === 0
              ? "No supported evidence-backed slice items were found for the requested anchor within the current bounded derived-relation analysis."
              : "Phase 1 slices are assembled from indexed derived relations only and do not yet include overlay-backed control/data slices.",
          kind: items.length === 0 ? "no-match" : "coverage",
        },
      ],
      sliceId: createHash("sha256")
        .update(JSON.stringify({ criterion: resolvedCriterion, direction }))
        .digest("hex"),
    };
  }
}

function normalizeMaxItems(maxItems: number | undefined): number {
  if (maxItems === undefined) {
    return DEFAULT_MAX_ITEMS;
  }

  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "slice limits must be positive integers.",
      {
        maxItems,
      },
    );
  }

  return Math.min(maxItems, MAX_ITEMS);
}

function normalizeOptionalPositive(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be a positive integer.`,
      {
        [label]: value,
      },
    );
  }

  return Math.min(value, MAX_ITEMS);
}
