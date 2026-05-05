import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const packageJsonPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  version: string;
};

import type {
  AnalyzeImpactResult,
  ComputeSliceResult,
  EntrypointKind,
  EntrypointResult,
  ListEntrypointsResult,
  TraceFlowResult,
} from "../application/dto/analysis.js";
import type { DaemonResponse } from "../application/dto/daemon.js";
import type { SearchKnowledgeResult } from "../application/dto/search.js";
import type {
  ListSymbolsResult,
  SymbolContextResult,
  SymbolDetailResult,
  SymbolRelationResult,
  SymbolSearchResult,
} from "../application/dto/symbols.js";
import type { DaemonClientPort } from "../application/ports/daemon-client-port.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

const statusOutputSchema = {
  activeProjectIdentity: z.string(),
  counters: z.object({
    errors: z.number().int().nonnegative(),
    filesIndexed: z.number().int().nonnegative(),
    filesTotal: z.number().int().nonnegative(),
  }),
  daemonState: z.enum(["starting", "ready", "degraded", "stopped"]).optional(),
  indexRunId: z.string().nullable(),
  indexScope: z.enum(["shared", "branch"]),
  lastError: z
    .object({
      code: z.string(),
      message: z.string(),
      occurredAt: z.string(),
    })
    .nullable(),
  lastIndexedAt: z.string().nullable(),
  needsReindex: z.boolean(),
  pendingChanges: z.boolean(),
  runtimeState: z.enum(["cold", "warming", "ready", "error"]).optional(),
  state: z.enum(["idle", "running", "error"]),
  watcherState: z.enum(["enabled", "disabled"]),
};

const runIndexOutputSchema = {
  acceptedAt: z.string(),
  indexRunId: z.string(),
  mode: z.enum(["full", "incremental", "rebuild"]),
  state: z.literal("idle"),
};

const provenanceSchema = z.object({
  content_hash: z.string(),
  evidence_id: z.string(),
  extractor: z.string(),
  index_run_id: z.string(),
  path: z.string(),
});

const evidenceOutputSchema = z.object({
  end_line: z.number().int().positive().optional(),
  evidence_id: z.string(),
  offset: z.number().int().nonnegative().optional(),
  path: z.string(),
  precision_tier: z.enum([
    "resolved",
    "derived",
    "heuristic",
    "possible",
    "unknown",
  ]),
  provenance: provenanceSchema,
  section: z.string().optional(),
  snippet: z.string().optional(),
  source_type: z.enum(["code", "doc"]),
  start_line: z.number().int().positive().optional(),
});

const anchorOutputSchema = z.object({
  end_line: z.number().int().positive().optional(),
  id: z.string().optional(),
  kind: z.enum([
    "symbol",
    "file",
    "module",
    "package",
    "entrypoint",
    "workflow",
    "task",
    "quality_gate",
    "config_artifact",
  ]),
  name: z.string(),
  path: z.string().optional(),
  source_type: z.enum(["code", "doc"]).optional(),
  start_line: z.number().int().positive().optional(),
});

const limitationOutputSchema = z.object({
  detail: z.string(),
  failure_class: z
    .enum([
      "INSUFFICIENT_INDEX",
      "UNSUPPORTED_CONSTRUCT",
      "AMBIGUOUS_RESOLUTION",
      "BUDGET_EXHAUSTED",
      "STALE_SNAPSHOT",
      "RULE_PREREQUISITE_MISSING",
    ])
    .optional(),
  kind: z.string(),
});

const flowSegmentOutputSchema = z.object({
  confidence: z.number(),
  evidence: z.array(evidenceOutputSchema),
  from: anchorOutputSchema,
  precision_tier: z.enum([
    "resolved",
    "derived",
    "heuristic",
    "possible",
    "unknown",
  ]),
  relation_kind: z.string(),
  to: anchorOutputSchema,
});

const searchOutputSchema = {
  results: z.array(
    z.object({
      artifact_kind: z.enum([
        "code",
        "config",
        "doc",
        "generated",
        "lockfile",
        "schema",
        "script",
        "test",
        "workflow",
      ]),
      evidence_id: z.string(),
      partition_id: z.string().optional(),
      partition_index: z.number().int().nonnegative().optional(),
      partition_status: z
        .enum(["complete", "degraded", "failed", "partial", "skipped"])
        .optional(),
      partition_total: z.number().int().positive().optional(),
      path: z.string(),
      provenance: z.object({
        content_hash: z.string(),
        extractor: z.string(),
        index_run_id: z.string(),
      }),
      score: z.number().optional(),
      section: z.string().optional(),
      offset: z.number().int().nonnegative().optional(),
      snippet: z.string(),
      source_type: z.enum(["code", "doc"]),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    }),
  ),
};

const symbolCandidateOutputSchema = z.object({
  confidence: z.number().optional(),
  container_name: z.string().optional(),
  evidence: z.object({
    code_location: z.object({
      end_line: z.number().int().positive(),
      start_line: z.number().int().positive(),
    }),
    content_hash: z.string(),
    evidence_id: z.string(),
    extractor: z.string(),
    path: z.string(),
  }),
  index_run_id: z.string(),
  kind: z.string(),
  language: z.string().nullable(),
  name: z.string(),
  ranking: z
    .object({
      exact_name_match: z.boolean(),
      exact_path_match: z.boolean(),
      kind_match: z.boolean(),
      score: z.number(),
    })
    .optional(),
  scope: z.literal("file"),
  signature: z.string().optional(),
  source_type: z.enum(["code", "doc"]),
});

const symbolContextOutputSchema = symbolCandidateOutputSchema.extend({
  label: z.string().optional(),
});

const symbolRelationOutputSchema = symbolCandidateOutputSchema.extend({
  relationship_kind: z.string().optional(),
});

const listSymbolsOutputSchema = {
  results: z.array(symbolCandidateOutputSchema),
};

const getSymbolOutputSchema = {
  ambiguity: z.array(symbolCandidateOutputSchema).optional(),
  callers: z.array(symbolRelationOutputSchema).optional(),
  callees: z.array(symbolRelationOutputSchema).optional(),
  candidates: z.array(symbolCandidateOutputSchema),
  exports: z.array(symbolContextOutputSchema).optional(),
  imports: z.array(symbolContextOutputSchema).optional(),
  references: z.array(symbolContextOutputSchema).optional(),
  repo_context: z.array(symbolContextOutputSchema).optional(),
  symbol: symbolCandidateOutputSchema.optional(),
  tests: z.array(symbolContextOutputSchema).optional(),
};

const entrypointOutputSchema = z.object({
  command: z.string().optional(),
  confidence: z.number(),
  detection_reason: z.string(),
  end_line: z.number().int().positive().optional(),
  entrypoint_id: z.string(),
  evidence: z.array(evidenceOutputSchema),
  kind: z.enum([
    "mcp_tool",
    "cli",
    "script",
    "http",
    "worker",
    "test",
    "library_export",
    "workflow",
    "entrypoint",
  ]),
  name: z.string(),
  path: z.string(),
  precision_tier: z.enum([
    "resolved",
    "derived",
    "heuristic",
    "possible",
    "unknown",
  ]),
  start_line: z.number().int().positive().optional(),
  symbol_id: z.string().optional(),
  trigger: z.string().optional(),
});

const listEntrypointsOutputSchema = {
  limitations: z.array(limitationOutputSchema).optional(),
  results: z.array(entrypointOutputSchema),
};

const traceFlowOutputSchema = {
  limitations: z.array(limitationOutputSchema).optional(),
  traces: z.array(
    z.object({
      completeness: z.enum(["complete", "partial", "truncated", "ambiguous"]),
      confidence: z.number(),
      end: anchorOutputSchema.optional(),
      precision_tier: z.enum([
        "resolved",
        "derived",
        "heuristic",
        "possible",
        "unknown",
      ]),
      segments: z.array(flowSegmentOutputSchema),
      start: anchorOutputSchema,
      trace_id: z.string(),
    }),
  ),
};

const impactOutputSchema = {
  impacts: z.array(
    z.object({
      anchor: anchorOutputSchema,
      classification: z.enum(["direct", "transitive", "possible"]),
      confidence: z.number(),
      evidence: z.array(evidenceOutputSchema),
      impact_id: z.string(),
      kind: z.enum([
        "symbol",
        "file",
        "module",
        "package",
        "test",
        "workflow",
        "entrypoint",
      ]),
      paths: z.array(
        z.object({
          confidence: z.number(),
          end: anchorOutputSchema,
          precision_tier: z.enum([
            "resolved",
            "derived",
            "heuristic",
            "possible",
            "unknown",
          ]),
          segments: z.array(flowSegmentOutputSchema),
          start: anchorOutputSchema,
        }),
      ),
      precision_tier: z.enum([
        "resolved",
        "derived",
        "heuristic",
        "possible",
        "unknown",
      ]),
      reasons: z.array(
        z.object({
          detail: z.string(),
          evidence: z.array(evidenceOutputSchema),
          precision_tier: z.enum([
            "resolved",
            "derived",
            "heuristic",
            "possible",
            "unknown",
          ]),
          relation_kind: z.string(),
        }),
      ),
    }),
  ),
  limitations: z.array(limitationOutputSchema).optional(),
  summary: z.object({
    direct_count: z.number().int().nonnegative(),
    possible_count: z.number().int().nonnegative(),
    transitive_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  target: anchorOutputSchema,
};

const sliceOutputSchema = {
  completeness: z.enum(["complete", "partial", "truncated", "ambiguous"]),
  criterion: anchorOutputSchema,
  items: z.array(
    z.object({
      anchor: anchorOutputSchema,
      confidence: z.number(),
      evidence: z.array(evidenceOutputSchema),
      inclusion_reason: z.string(),
      precision_tier: z.enum([
        "resolved",
        "derived",
        "heuristic",
        "possible",
        "unknown",
      ]),
      relation_path: z.array(flowSegmentOutputSchema),
    }),
  ),
  limitations: z.array(limitationOutputSchema).optional(),
  slice_id: z.string(),
};

export function createMcpServer(dependencies: {
  daemonClient: DaemonClientPort;
  logger: LoggerPort;
}): McpServer {
  const server = new McpServer(
    {
      name: "lkg",
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    "lkg.status",
    {
      description:
        "Return the current index lifecycle status for the active project scope.",
      outputSchema: statusOutputSchema,
    },
    async () => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "status" }>
        >({
          type: "status",
        });
        const structuredContent = response.status;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.index",
    {
      description: "Start an index lifecycle run for the active project scope.",
      inputSchema: {
        mode: z.enum(["full", "incremental", "rebuild"]),
      },
      outputSchema: runIndexOutputSchema,
    },
    async ({ mode }) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "index.start" }>
        >({
          command: { mode },
          type: "index.start",
        });
        const structuredContent = response.result;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.search",
    {
      description:
        "Search indexed project knowledge and return ranked evidence with provenance.",
      inputSchema: {
        query: z.string().trim().min(1),
        top_k: z.number().int().positive().max(50).optional(),
      },
      outputSchema: searchOutputSchema,
    },
    async ({ query, top_k: topK }) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "search.query" }>
        >({
          command: { query, topK },
          type: "search.query",
        });
        const structuredContent = toSearchToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.symbols",
    {
      description:
        "List symbol candidates by path, kind, source type, or text query with provenance-rich evidence.",
      inputSchema: {
        kind: z.string().trim().min(1).optional(),
        path: z.string().trim().min(1).optional(),
        query: z.string().trim().min(1).optional(),
        source_type: z.enum(["code", "doc"]).optional(),
      },
      outputSchema: listSymbolsOutputSchema,
    },
    async ({ kind, path, query, source_type: sourceType }) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "symbols.query" }>
        >({
          command: { kind, path, query, sourceType },
          type: "symbols.query",
        });
        const structuredContent = toListSymbolsToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.symbol",
    {
      description:
        "Return candidate-first detail for a symbol in a path with provenance-rich evidence.",
      inputSchema: {
        path: z.string().trim().min(1),
        symbol: z.string().trim().min(1),
      },
      outputSchema: getSymbolOutputSchema,
    },
    async ({ path, symbol }) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "symbol.get" }>
        >({
          command: { path, symbol },
          type: "symbol.get",
        });
        const structuredContent = toGetSymbolToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.entrypoints",
    {
      description:
        "List evidence-backed entrypoint candidates for the active project scope.",
      inputSchema: {
        confidence_min: z.number().min(0).max(1).optional(),
        kind: z
          .enum([
            "mcp_tool",
            "cli",
            "script",
            "http",
            "worker",
            "test",
            "library_export",
            "workflow",
            "entrypoint",
          ] satisfies [EntrypointKind, ...EntrypointKind[]])
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
        package: z.string().trim().min(1).optional(),
        path: z.string().trim().min(1).optional(),
        query: z.string().trim().min(1).optional(),
      },
      outputSchema: listEntrypointsOutputSchema,
    },
    async ({
      confidence_min: confidenceMin,
      kind,
      limit,
      package: packageName,
      path,
      query,
    }) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "entrypoints.list" }>
        >({
          command: {
            confidenceMin,
            kind,
            limit,
            package: packageName,
            path,
            query,
          },
          type: "entrypoints.list",
        });
        const structuredContent = toEntrypointsToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.flow",
    {
      description:
        "Trace bounded evidence-backed flow segments from an anchor.",
      inputSchema: {
        confidence_min: z.number().min(0).max(1).optional(),
        direction: z.enum(["forward", "backward", "both"]).optional(),
        from: z
          .object({
            id: z.string().optional(),
            kind: anchorOutputSchema.shape.kind,
            name: z.string().trim().min(1),
            path: z.string().optional(),
            source_type: z.enum(["code", "doc"]).optional(),
            start_line: z.number().int().positive().optional(),
            end_line: z.number().int().positive().optional(),
          })
          .optional(),
        include: z
          .array(
            z.enum([
              "calls",
              "imports",
              "exports",
              "control",
              "data",
              "config",
              "workflow",
            ]),
          )
          .optional(),
        max_depth: z.number().int().positive().max(8).optional(),
        max_nodes: z.number().int().positive().max(800).optional(),
        time_budget_ms: z.number().int().positive().max(5000).optional(),
        to: z
          .object({
            id: z.string().optional(),
            kind: anchorOutputSchema.shape.kind,
            name: z.string().trim().min(1),
            path: z.string().optional(),
            source_type: z.enum(["code", "doc"]).optional(),
            start_line: z.number().int().positive().optional(),
            end_line: z.number().int().positive().optional(),
          })
          .optional(),
      },
      outputSchema: traceFlowOutputSchema,
    },
    async (input) => {
      try {
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "flow.trace" }>
        >({
          command: {
            confidenceMin: input.confidence_min,
            direction: input.direction,
            from: fromToolAnchor(input.from),
            include: input.include,
            maxDepth: input.max_depth,
            maxNodes: input.max_nodes,
            timeBudgetMs: input.time_budget_ms,
            to: fromToolAnchor(input.to),
          },
          type: "flow.trace",
        });
        const structuredContent = toFlowToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.impact",
    {
      description:
        "Analyze bounded evidence-backed impact from a target anchor.",
      inputSchema: {
        confidence_min: z.number().min(0).max(1).optional(),
        max_depth: z.number().int().positive().max(8).optional(),
        max_results: z.number().int().positive().max(200).optional(),
        mode: z
          .enum(["callers", "callees", "dependents", "tests", "runtime", "all"])
          .optional(),
        target: z.object({
          id: z.string().optional(),
          kind: anchorOutputSchema.shape.kind,
          name: z.string().trim().min(1),
          path: z.string().optional(),
          source_type: z.enum(["code", "doc"]).optional(),
          start_line: z.number().int().positive().optional(),
          end_line: z.number().int().positive().optional(),
        }),
      },
      outputSchema: impactOutputSchema,
    },
    async ({
      confidence_min: confidenceMin,
      max_depth: maxDepth,
      max_results: maxResults,
      mode,
      target,
    }) => {
      try {
        const resolvedTarget = fromToolAnchor(target);
        if (resolvedTarget === undefined) {
          throw new LkgError(
            ERROR_CODES.INTERNAL_ERROR,
            "target anchor is required.",
          );
        }
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "impact.analyze" }>
        >({
          command: {
            confidenceMin,
            maxDepth,
            maxResults,
            mode,
            target: resolvedTarget,
          },
          type: "impact.analyze",
        });
        const structuredContent = toImpactToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  server.registerTool(
    "lkg.slice",
    {
      description: "Return a bounded evidence slice around a criterion anchor.",
      inputSchema: {
        criterion: z.object({
          id: z.string().optional(),
          kind: anchorOutputSchema.shape.kind,
          name: z.string().trim().min(1),
          path: z.string().optional(),
          source_type: z.enum(["code", "doc"]).optional(),
          start_line: z.number().int().positive().optional(),
          end_line: z.number().int().positive().optional(),
        }),
        direction: z.enum(["forward", "backward", "both"]).optional(),
        include: z
          .array(z.enum(["calls", "control", "data", "imports", "config"]))
          .optional(),
        max_evidence: z.number().int().positive().max(200).optional(),
        max_files: z.number().int().positive().optional(),
        max_nodes: z.number().int().positive().max(800).optional(),
      },
      outputSchema: sliceOutputSchema,
    },
    async ({
      criterion,
      direction,
      include,
      max_evidence: maxEvidence,
      max_files: maxFiles,
      max_nodes: maxNodes,
    }) => {
      try {
        const resolvedCriterion = fromToolAnchor(criterion);
        if (resolvedCriterion === undefined) {
          throw new LkgError(
            ERROR_CODES.INTERNAL_ERROR,
            "criterion anchor is required.",
          );
        }
        const response = await dependencies.daemonClient.request<
          Extract<DaemonResponse, { type: "slice.compute" }>
        >({
          command: {
            criterion: resolvedCriterion,
            direction,
            include,
            maxEvidence,
            maxFiles,
            maxNodes,
          },
          type: "slice.compute",
        });
        const structuredContent = toSliceToolOutput(response.result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return mapToolError(error);
      }
    },
  );

  return server;
}

function toSearchToolOutput(result: SearchKnowledgeResult) {
  return {
    results: result.results.map((evidence) => ({
      artifact_kind: evidence.artifactKind,
      evidence_id: evidence.evidenceId,
      partition_id: evidence.partitionId,
      partition_index: evidence.partitionIndex,
      partition_status: evidence.partitionStatus,
      partition_total: evidence.partitionTotal,
      path: evidence.path,
      provenance: {
        content_hash: evidence.provenance.contentHash,
        extractor: evidence.provenance.extractor,
        index_run_id: evidence.provenance.indexRunId,
      },
      score: evidence.score,
      section: evidence.docLocation?.section,
      offset: evidence.docLocation?.offset,
      snippet: evidence.snippet,
      source_type: evidence.sourceType,
      start_line: evidence.codeLocation?.startLine,
      end_line: evidence.codeLocation?.endLine,
    })),
  };
}

function toEntrypointsToolOutput(result: ListEntrypointsResult) {
  return {
    limitations: result.limitations?.map(toLimitationOutput),
    results: result.results.map(toEntrypointOutput),
  };
}

function toFlowToolOutput(result: TraceFlowResult) {
  return {
    limitations: result.limitations?.map(toLimitationOutput),
    traces: result.traces.map((trace) => ({
      completeness: trace.completeness,
      confidence: trace.confidence,
      end: trace.end ? toAnchorOutput(trace.end) : undefined,
      precision_tier: trace.precisionTier,
      segments: trace.segments.map(toFlowSegmentOutput),
      start: toAnchorOutput(trace.start),
      trace_id: trace.traceId,
    })),
  };
}

function toImpactToolOutput(result: AnalyzeImpactResult) {
  return {
    impacts: result.impacts.map((impact) => ({
      anchor: toAnchorOutput(impact.anchor),
      classification: impact.classification,
      confidence: impact.confidence,
      evidence: impact.evidence.map(toEvidenceOutput),
      impact_id: impact.impactId,
      kind: impact.kind,
      paths: impact.paths.map((path) => ({
        confidence: path.confidence,
        end: toAnchorOutput(path.end),
        precision_tier: path.precisionTier,
        segments: path.segments.map(toFlowSegmentOutput),
        start: toAnchorOutput(path.start),
      })),
      precision_tier: impact.precisionTier,
      reasons: impact.reasons.map((reason) => ({
        detail: reason.detail,
        evidence: reason.evidence.map(toEvidenceOutput),
        precision_tier: reason.precisionTier,
        relation_kind: reason.relationKind,
      })),
    })),
    limitations: result.limitations?.map(toLimitationOutput),
    summary: {
      direct_count: result.summary.directCount,
      possible_count: result.summary.possibleCount,
      transitive_count: result.summary.transitiveCount,
      truncated: result.summary.truncated,
    },
    target: toAnchorOutput(result.target),
  };
}

function toSliceToolOutput(result: ComputeSliceResult) {
  return {
    completeness: result.completeness,
    criterion: toAnchorOutput(result.criterion),
    items: result.items.map((item) => ({
      anchor: toAnchorOutput(item.anchor),
      confidence: item.confidence,
      evidence: item.evidence.map(toEvidenceOutput),
      inclusion_reason: item.inclusionReason,
      precision_tier: item.precisionTier,
      relation_path: item.relationPath.map(toFlowSegmentOutput),
    })),
    limitations: result.limitations?.map(toLimitationOutput),
    slice_id: result.sliceId,
  };
}

function toListSymbolsToolOutput(result: ListSymbolsResult) {
  return {
    results: result.results.map(toSymbolCandidateOutput),
  };
}

function toAnchorOutput(anchor: {
  codeLocation?: { endLine: number; startLine: number };
  id?: string;
  kind: string;
  name: string;
  path?: string;
  sourceType?: "code" | "doc";
}) {
  return {
    end_line: anchor.codeLocation?.endLine,
    id: anchor.id,
    kind: anchor.kind,
    name: anchor.name,
    path: anchor.path,
    source_type: anchor.sourceType,
    start_line: anchor.codeLocation?.startLine,
  };
}

function toEvidenceOutput(evidence: {
  codeLocation?: { endLine: number; startLine: number };
  docLocation?: { offset?: number; section?: string };
  path: string;
  precisionTier: string;
  provenance: {
    contentHash: string;
    evidenceId: string;
    extractor: string;
    indexRunId: string;
    path: string;
  };
  snippet?: string;
  sourceType: "code" | "doc";
}) {
  return {
    end_line: evidence.codeLocation?.endLine,
    evidence_id: evidence.provenance.evidenceId,
    offset: evidence.docLocation?.offset,
    path: evidence.path,
    precision_tier: evidence.precisionTier,
    provenance: {
      content_hash: evidence.provenance.contentHash,
      evidence_id: evidence.provenance.evidenceId,
      extractor: evidence.provenance.extractor,
      index_run_id: evidence.provenance.indexRunId,
      path: evidence.provenance.path,
    },
    section: evidence.docLocation?.section,
    snippet: evidence.snippet,
    source_type: evidence.sourceType,
    start_line: evidence.codeLocation?.startLine,
  };
}

function toLimitationOutput(limitation: {
  detail: string;
  failureClass?: string;
  kind: string;
}) {
  return {
    detail: limitation.detail,
    failure_class: limitation.failureClass,
    kind: limitation.kind,
  };
}

function toFlowSegmentOutput(segment: {
  confidence: number;
  evidence: Array<Parameters<typeof toEvidenceOutput>[0]>;
  from: Parameters<typeof toAnchorOutput>[0];
  precisionTier: string;
  relationKind: string;
  to: Parameters<typeof toAnchorOutput>[0];
}) {
  return {
    confidence: segment.confidence,
    evidence: segment.evidence.map(toEvidenceOutput),
    from: toAnchorOutput(segment.from),
    precision_tier: segment.precisionTier,
    relation_kind: segment.relationKind,
    to: toAnchorOutput(segment.to),
  };
}

function toEntrypointOutput(entrypoint: EntrypointResult) {
  return {
    command: entrypoint.command,
    confidence: entrypoint.confidence,
    detection_reason: entrypoint.detectionReason,
    end_line: entrypoint.endLine,
    entrypoint_id: entrypoint.entrypointId,
    evidence: entrypoint.evidence.map(toEvidenceOutput),
    kind: entrypoint.kind,
    name: entrypoint.name,
    path: entrypoint.path,
    precision_tier: entrypoint.precisionTier,
    start_line: entrypoint.startLine,
    symbol_id: entrypoint.symbolId,
    trigger: entrypoint.trigger,
  };
}

function fromToolAnchor(
  anchor:
    | {
        end_line?: number;
        id?: string;
        kind:
          | "symbol"
          | "file"
          | "module"
          | "package"
          | "entrypoint"
          | "workflow"
          | "task"
          | "quality_gate"
          | "config_artifact";
        name: string;
        path?: string;
        source_type?: "code" | "doc";
        start_line?: number;
      }
    | undefined,
):
  | {
      codeLocation?: { endLine: number; startLine: number };
      id?: string;
      kind:
        | "symbol"
        | "file"
        | "module"
        | "package"
        | "entrypoint"
        | "workflow"
        | "task"
        | "quality_gate"
        | "config_artifact";
      name: string;
      path?: string;
      sourceType?: "code" | "doc";
    }
  | undefined {
  if (anchor === undefined) {
    return undefined;
  }

  return {
    codeLocation:
      anchor.start_line !== undefined && anchor.end_line !== undefined
        ? {
            endLine: anchor.end_line,
            startLine: anchor.start_line,
          }
        : undefined,
    id: anchor.id,
    kind: anchor.kind,
    name: anchor.name,
    path: anchor.path,
    sourceType: anchor.source_type,
  };
}

function toGetSymbolToolOutput(result: SymbolDetailResult) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const structuredContent: Record<string, unknown> = {
    candidates: candidates.map(toSymbolCandidateOutput),
  };

  if ("symbol" in result && result.symbol !== undefined) {
    structuredContent.symbol = toSymbolCandidateOutput(result.symbol);
  }

  if ("ambiguity" in result && result.ambiguity !== undefined) {
    structuredContent.ambiguity = result.ambiguity.map(toSymbolCandidateOutput);
  }

  if ("references" in result && result.references !== undefined) {
    structuredContent.references = result.references.map(toSymbolContextOutput);
  }

  if ("imports" in result && result.imports !== undefined) {
    structuredContent.imports = result.imports.map(toSymbolContextOutput);
  }

  if ("exports" in result && result.exports !== undefined) {
    structuredContent.exports = result.exports.map(toSymbolContextOutput);
  }

  if ("tests" in result && result.tests !== undefined) {
    structuredContent.tests = result.tests.map(toSymbolContextOutput);
  }

  if ("repoContext" in result && result.repoContext !== undefined) {
    structuredContent.repo_context = result.repoContext.map(
      toSymbolContextOutput,
    );
  }

  if ("callers" in result && result.callers !== undefined) {
    structuredContent.callers = result.callers.map(toSymbolRelationOutput);
  }

  if ("callees" in result && result.callees !== undefined) {
    structuredContent.callees = result.callees.map(toSymbolRelationOutput);
  }

  return structuredContent;
}

function toSymbolCandidateOutput(candidate: SymbolSearchResult) {
  const codeLocation = candidate.evidence.codeLocation as
    | { endLine: number; startLine: number }
    | undefined;

  return {
    confidence: candidate.confidence,
    container_name: candidate.containerName,
    evidence: {
      code_location:
        codeLocation === undefined
          ? undefined
          : {
              end_line: codeLocation.endLine,
              start_line: codeLocation.startLine,
            },
      content_hash: candidate.evidence.contentHash,
      evidence_id: candidate.evidence.evidenceId,
      extractor: candidate.evidence.extractor,
      path: candidate.evidence.path,
    },
    index_run_id: candidate.indexRunId,
    kind: candidate.kind,
    language: candidate.language,
    name: candidate.name,
    ranking:
      candidate.ranking === undefined
        ? undefined
        : {
            exact_name_match: candidate.ranking.exactNameMatch,
            exact_path_match: candidate.ranking.exactPathMatch,
            kind_match: candidate.ranking.kindMatch,
            score: candidate.ranking.score,
          },
    scope: candidate.scope,
    signature: candidate.signature,
    source_type: candidate.sourceType,
  };
}

function toSymbolContextOutput(candidate: SymbolContextResult) {
  return {
    ...toSymbolCandidateOutput(candidate),
    label: candidate.label,
  };
}

function toSymbolRelationOutput(candidate: SymbolRelationResult) {
  return {
    ...toSymbolCandidateOutput(candidate),
    relationship_kind: candidate.relationshipKind,
  };
}

function mapToolError(error: unknown) {
  if (error instanceof LkgError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              code: error.code,
              details: error.details ?? {},
              message: error.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
      structuredContent: {
        code: error.code,
        details: error.details ?? {},
        message: error.message,
      },
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: "Unexpected internal error.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
    structuredContent: {
      code: ERROR_CODES.INTERNAL_ERROR,
      details: {},
      message: "Unexpected internal error.",
    },
  };
}
