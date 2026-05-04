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

const searchOutputSchema = {
  results: z.array(
    z.object({
      evidence_id: z.string(),
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

  return server;
}

function toSearchToolOutput(result: SearchKnowledgeResult) {
  return {
    results: result.results.map((evidence) => ({
      evidence_id: evidence.evidenceId,
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

function toListSymbolsToolOutput(result: ListSymbolsResult) {
  return {
    results: result.results.map(toSymbolCandidateOutput),
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
    structuredContent.repo_context = result.repoContext.map(toSymbolContextOutput);
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
  return {
    confidence: candidate.confidence,
    container_name: candidate.containerName,
    evidence: {
      code_location: {
        end_line: candidate.evidence.codeLocation.endLine,
        start_line: candidate.evidence.codeLocation.startLine,
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
