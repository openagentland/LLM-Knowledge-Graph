import { createHash } from "node:crypto";

import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type {
  EntrypointKind,
  EntrypointResult,
  ListEntrypointsCommand,
  ListEntrypointsResult,
} from "../dto/analysis.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type { CanonicalFactStorePort } from "../ports/canonical-fact-store-port.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class DetectEntrypointsUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly canonicalFactStore: CanonicalFactStorePort,
    private readonly derivedFactStore: DerivedFactStorePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(
    command: ListEntrypointsCommand,
  ): Promise<ListEntrypointsResult> {
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
        "The knowledge index is not ready for entrypoint analysis.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    const query = normalizeOptionalString(command.query, "query");
    const path = normalizeOptionalString(command.path, "path");
    const packageName = normalizeOptionalString(command.package, "package");
    const limit = normalizeLimit(command.limit);
    const confidenceMin = normalizeConfidenceMin(command.confidenceMin);

    const [canonicalFacts, derivedFacts, symbols] = await Promise.all([
      this.canonicalFactStore.list(),
      this.derivedFactStore.list(),
      this.symbolCandidateStore.list(path !== undefined ? { path } : undefined),
    ]);

    const entrypoints: EntrypointResult[] = [];

    for (const fact of canonicalFacts) {
      const mappedKind = mapCanonicalEntrypointKind(fact.kind);
      if (mappedKind === null) {
        continue;
      }
      if (path !== undefined && fact.path !== path) {
        continue;
      }

      const name =
        readString(fact.payload.workflowName) ??
        readString(fact.payload.scriptName) ??
        readString(fact.payload.taskName) ??
        readString(fact.payload.artifactName) ??
        readString(fact.payload.tool) ??
        fact.path;

      const commandText =
        readString(fact.payload.command) ?? readString(fact.payload.scriptName);
      const trigger =
        readString(fact.payload.workflowName) ??
        readString(fact.payload.taskName);
      const symbolMatch = symbols.find((symbol) => symbol.path === fact.path);
      const confidence = fact.confidence;

      if (confidence < confidenceMin) {
        continue;
      }
      if (
        !matchesFilters(
          { kind: command.kind, packageName, path, query },
          { kind: mappedKind, name, path: fact.path },
        )
      ) {
        continue;
      }

      entrypoints.push({
        command: commandText,
        confidence,
        detectionReason: `Derived from canonical fact ${fact.kind}`,
        endLine: fact.codeLocation?.endLine,
        entrypointId: createStableId(fact.evidenceId, fact.kind, name),
        evidence: [
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
        ],
        kind: mappedKind,
        name,
        path: fact.path,
        precisionTier: "derived",
        startLine: fact.codeLocation?.startLine,
        symbolId: symbolMatch?.evidenceId,
        trigger,
      });
    }

    for (const fact of derivedFacts) {
      if (fact.kind !== "file-declares-entrypoint-candidate") {
        continue;
      }
      if (path !== undefined && fact.path !== path) {
        continue;
      }

      const name =
        readString(fact.payload.toLabel) ??
        readString(fact.payload.toId) ??
        readString(fact.payload.fromLabel) ??
        fact.path;
      const entrypointPath = readString(fact.payload.path) ?? fact.path;
      const confidence = fact.confidence;

      if (confidence < confidenceMin) {
        continue;
      }
      if (
        !matchesFilters(
          { kind: command.kind, packageName, path, query },
          { kind: "entrypoint", name, path: entrypointPath },
        )
      ) {
        continue;
      }

      entrypoints.push({
        confidence,
        detectionReason: `Derived from relation ${fact.kind}`,
        entrypointId: createStableId(fact.evidenceId, fact.kind, name),
        evidence: [
          {
            codeLocation: fact.codeLocation,
            path: fact.path,
            precisionTier: "possible",
            provenance: {
              contentHash: fact.contentHash,
              evidenceId: fact.evidenceId,
              extractor: fact.extractor,
              indexRunId: fact.indexRunId,
              path: fact.path,
            },
            sourceType: fact.sourceType,
          },
        ],
        kind: "entrypoint",
        name,
        path: entrypointPath,
        precisionTier: "possible",
      });
    }

    const results = dedupeEntrypoints(entrypoints)
      .sort(compareEntrypoints)
      .slice(0, limit);

    return {
      limitations: [
        {
          detail:
            "Phase 1 entrypoint detection is limited to indexed facts, derived relations, and artifact-backed evidence.",
          kind: "bounded-analysis",
        },
      ],
      results,
    };
  }
}

function normalizeOptionalString(value: string | undefined, field: string) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      `${field} must not be empty.`,
    );
  }

  return normalized;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "limit must be a positive integer.",
      {
        limit,
      },
    );
  }

  return Math.min(limit, MAX_LIMIT);
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

function mapCanonicalEntrypointKind(kind: string): EntrypointKind | null {
  switch (kind) {
    case "workflow":
      return "workflow";
    case "package_script":
      return "script";
    case "workspace_task":
      return "worker";
    case "quality_gate":
      return "test";
    case "config_artifact":
      return "entrypoint";
    case "entrypoint_candidate":
      return "entrypoint";
    default:
      return null;
  }
}

function matchesFilters(
  filters: {
    kind?: EntrypointKind;
    packageName?: string;
    path?: string;
    query?: string;
  },
  candidate: { kind: EntrypointKind; name: string; path: string },
): boolean {
  if (filters.kind && filters.kind !== candidate.kind) {
    return false;
  }

  if (
    filters.packageName !== undefined &&
    !candidate.path.includes(filters.packageName)
  ) {
    return false;
  }

  if (filters.query !== undefined) {
    const query = filters.query.toLowerCase();
    if (
      !candidate.name.toLowerCase().includes(query) &&
      !candidate.path.toLowerCase().includes(query)
    ) {
      return false;
    }
  }

  return true;
}

function compareEntrypoints(
  left: EntrypointResult,
  right: EntrypointResult,
): number {
  return (
    right.confidence - left.confidence ||
    left.path.localeCompare(right.path) ||
    left.name.localeCompare(right.name)
  );
}

function dedupeEntrypoints(results: EntrypointResult[]): EntrypointResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.kind}:${result.path}:${result.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createStableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
