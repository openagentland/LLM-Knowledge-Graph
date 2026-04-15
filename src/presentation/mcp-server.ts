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
