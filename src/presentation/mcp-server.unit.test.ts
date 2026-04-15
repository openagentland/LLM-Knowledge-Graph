import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { createMcpServer } from "./mcp-server.js";
import type { DaemonResponse } from "../application/dto/daemon.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

type RegisteredTool = ReturnType<ReturnType<typeof createMcpServer>["registerTool"]>;

type TestTool = RegisteredTool & {
  handler: (...args: never[]) => Promise<CallToolResult>;
};

function createDependencies() {
  return {
    daemonClient: {
      isHealthy: vi.fn(),
      request: vi.fn(),
    },
    logger: {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
}

function getTool(server: ReturnType<typeof createMcpServer>, name: string): TestTool {
  const registeredTools = server as unknown as {
    _registeredTools: Partial<Record<string, TestTool>>;
  };
  const tool = registeredTools._registeredTools[name];
  if (tool === undefined) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

describe("createMcpServer", () => {
  it("returns daemon status as both text content and structured content", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request.mockResolvedValue({
      status: {
        activeProjectIdentity: "project-a",
        counters: { errors: 0, filesIndexed: 3, filesTotal: 4 },
        daemonState: "ready",
        indexRunId: "run-1",
        indexScope: "shared",
        lastError: null,
        lastIndexedAt: "2026-05-04T00:00:00.000Z",
        needsReindex: false,
        pendingChanges: false,
        runtimeState: "ready",
        state: "idle",
        watcherState: "enabled",
      },
      type: "status",
    } satisfies Extract<DaemonResponse, { type: "status" }>);

    const server = createMcpServer(dependencies);
    const tool = getTool(server, "lkg.status");
    const result = await tool.handler({});

    expect(dependencies.daemonClient.request).toHaveBeenCalledWith({ type: "status" });
    expect(result.structuredContent).toEqual({
      activeProjectIdentity: "project-a",
      counters: { errors: 0, filesIndexed: 3, filesTotal: 4 },
      daemonState: "ready",
      indexRunId: "run-1",
      indexScope: "shared",
      lastError: null,
      lastIndexedAt: "2026-05-04T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      runtimeState: "ready",
      state: "idle",
      watcherState: "enabled",
    });
    expect(result.content).toEqual([
      {
        text: JSON.stringify(result.structuredContent, null, 2),
        type: "text",
      },
    ]);
  });

  it("remaps top_k to topK and transforms search results", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request.mockResolvedValue({
      result: {
        results: [
          {
            codeLocation: { endLine: 14, startLine: 10 },
            docLocation: { offset: 8, section: "Intro" },
            evidenceId: "evidence-1",
            path: "src/main.ts",
            provenance: {
              contentHash: "hash-1",
              extractor: "parser",
              indexRunId: "run-2",
            },
            score: 0.8,
            snippet: "result snippet",
            sourceType: "code",
          },
        ],
      },
      type: "search.query",
    } satisfies Extract<DaemonResponse, { type: "search.query" }>);

    const server = createMcpServer(dependencies);
    const tool = getTool(server, "lkg.search");
    const result = await tool.handler({ query: "  search term  ", top_k: 7 });

    expect(dependencies.daemonClient.request).toHaveBeenCalledWith({
      command: { query: "  search term  ", topK: 7 },
      type: "search.query",
    });
    expect(result.structuredContent).toEqual({
      results: [
        {
          end_line: 14,
          evidence_id: "evidence-1",
          offset: 8,
          path: "src/main.ts",
          provenance: {
            content_hash: "hash-1",
            extractor: "parser",
            index_run_id: "run-2",
          },
          score: 0.8,
          section: "Intro",
          snippet: "result snippet",
          source_type: "code",
          start_line: 10,
        },
      ],
    });
  });

  it("maps LkgError and unknown errors into tool errors", async () => {
    const knownDependencies = createDependencies();
    knownDependencies.daemonClient.request.mockRejectedValue(
      new LkgError(ERROR_CODES.INVALID_INPUT, "Bad request", { field: "query" }),
    );
    const knownServer = createMcpServer(knownDependencies);
    const knownTool = getTool(knownServer, "lkg.status");
    const knownErrorResult = await knownTool.handler({});

    expect(knownErrorResult.isError).toBe(true);
    expect(knownErrorResult.structuredContent).toEqual({
      code: ERROR_CODES.INVALID_INPUT,
      details: { field: "query" },
      message: "Bad request",
    });

    const unknownDependencies = createDependencies();
    unknownDependencies.daemonClient.request.mockRejectedValue(new Error("boom"));
    const unknownServer = createMcpServer(unknownDependencies);
    const unknownTool = getTool(unknownServer, "lkg.search");
    const unknownErrorResult = await unknownTool.handler({ query: "boom" });

    expect(unknownErrorResult.isError).toBe(true);
    expect(unknownErrorResult.structuredContent).toEqual({
      code: ERROR_CODES.INTERNAL_ERROR,
      details: {},
      message: "Unexpected internal error.",
    });
  });
});
