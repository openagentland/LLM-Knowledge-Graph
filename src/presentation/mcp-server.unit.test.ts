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

  it("registers symbol tools and maps candidate-first outputs", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request
      .mockResolvedValueOnce({
        result: {
          results: [
            {
              confidence: 0.91,
              containerName: "exports",
              evidence: {
                codeLocation: { endLine: 4, startLine: 1 },
                contentHash: "hash-1",
                evidenceId: "evidence-1",
                extractor: "ast-grep:function_declaration",
                path: "main.ts",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              language: "ts",
              name: "mcpFixtureEntry",
              ranking: {
                exactNameMatch: true,
                exactPathMatch: true,
                kindMatch: false,
                score: 10,
              },
              scope: "file",
              signature: "function mcpFixtureEntry()",
              sourceType: "code",
            },
          ],
        },
        type: "symbols.query",
      } satisfies Extract<DaemonResponse, { type: "symbols.query" }>)
      .mockResolvedValueOnce({
        result: {
          callers: [
            {
              confidence: 0.55,
              containerName: "handlers",
              evidence: {
                codeLocation: { endLine: 12, startLine: 9 },
                contentHash: "hash-caller",
                evidenceId: "evidence-caller",
                extractor: "derived-fact",
                path: "main.ts",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              language: "ts",
              name: "mcpFixtureEntry",
              relationshipKind: "caller-callee-candidate",
              scope: "file",
              sourceType: "code",
            },
          ],
          candidates: [
            {
              confidence: 0.91,
              evidence: {
                codeLocation: { endLine: 4, startLine: 1 },
                contentHash: "hash-1",
                evidenceId: "evidence-1",
                extractor: "ast-grep:function_declaration",
                path: "main.ts",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              language: "ts",
              name: "mcpFixtureEntry",
              ranking: {
                exactNameMatch: true,
                exactPathMatch: true,
                kindMatch: false,
                score: 10,
              },
              scope: "file",
              sourceType: "code",
            },
          ],
          references: [
            {
              confidence: 0.7,
              evidence: {
                codeLocation: { endLine: 20, startLine: 18 },
                contentHash: "hash-ref",
                evidenceId: "evidence-ref",
                extractor: "derived-fact",
                path: "main.ts",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              label: "toId",
              language: "ts",
              name: "mcpFixtureEntry",
              scope: "file",
              sourceType: "code",
            },
          ],
          repoContext: [
            {
              confidence: 0.6,
              evidence: {
                codeLocation: { endLine: 1, startLine: 1 },
                contentHash: "hash-repo",
                evidenceId: "evidence-repo",
                extractor: "graph",
                path: "package.json",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              label: "build",
              language: "ts",
              name: "mcpFixtureEntry",
              scope: "file",
              sourceType: "code",
            },
          ],
          symbol: {
            confidence: 1,
            evidence: {
              codeLocation: { endLine: 4, startLine: 1 },
              contentHash: "hash-1",
              evidenceId: "evidence-1",
              extractor: "ast-grep:function_declaration",
              path: "main.ts",
            },
            indexRunId: "run-3",
            kind: "function_declaration",
            language: "ts",
            name: "mcpFixtureEntry",
            ranking: {
              exactNameMatch: true,
              exactPathMatch: true,
              kindMatch: false,
              score: 10,
            },
            scope: "file",
            sourceType: "code",
          },
          tests: [
            {
              confidence: 0.5,
              evidence: {
                codeLocation: { endLine: 30, startLine: 24 },
                contentHash: "hash-test",
                evidenceId: "evidence-test",
                extractor: "graph",
                path: "main.test.ts",
              },
              indexRunId: "run-3",
              kind: "function_declaration",
              label: "main test",
              language: "ts",
              name: "mcpFixtureEntry",
              scope: "file",
              sourceType: "code",
            },
          ],
        },
        type: "symbol.get",
      } satisfies Extract<DaemonResponse, { type: "symbol.get" }>);

    const server = createMcpServer(dependencies);
    const symbolsTool = getTool(server, "lkg.symbols");
    const symbolTool = getTool(server, "lkg.symbol");

    const listResult = await symbolsTool.handler({
      path: "main.ts",
      query: "fixture",
      source_type: "code",
    });
    const detailResult = await symbolTool.handler({
      path: "main.ts",
      symbol: "mcpFixtureEntry",
    });

    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(1, {
      command: { kind: undefined, path: "main.ts", query: "fixture", sourceType: "code" },
      type: "symbols.query",
    });
    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(2, {
      command: { path: "main.ts", symbol: "mcpFixtureEntry" },
      type: "symbol.get",
    });
    expect(listResult.structuredContent).toEqual({
      results: [
        {
          confidence: 0.91,
          container_name: "exports",
          evidence: {
            code_location: { end_line: 4, start_line: 1 },
            content_hash: "hash-1",
            evidence_id: "evidence-1",
            extractor: "ast-grep:function_declaration",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: {
            exact_name_match: true,
            exact_path_match: true,
            kind_match: false,
            score: 10,
          },
          scope: "file",
          signature: "function mcpFixtureEntry()",
          source_type: "code",
        },
      ],
    });
    expect(detailResult.structuredContent).toEqual({
      callers: [
        {
          confidence: 0.55,
          container_name: "handlers",
          evidence: {
            code_location: { end_line: 12, start_line: 9 },
            content_hash: "hash-caller",
            evidence_id: "evidence-caller",
            extractor: "derived-fact",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: undefined,
          relationship_kind: "caller-callee-candidate",
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
      candidates: [
        {
          confidence: 0.91,
          container_name: undefined,
          evidence: {
            code_location: { end_line: 4, start_line: 1 },
            content_hash: "hash-1",
            evidence_id: "evidence-1",
            extractor: "ast-grep:function_declaration",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: {
            exact_name_match: true,
            exact_path_match: true,
            kind_match: false,
            score: 10,
          },
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
      references: [
        {
          confidence: 0.7,
          container_name: undefined,
          evidence: {
            code_location: { end_line: 20, start_line: 18 },
            content_hash: "hash-ref",
            evidence_id: "evidence-ref",
            extractor: "derived-fact",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          label: "toId",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: undefined,
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
      repo_context: [
        {
          confidence: 0.6,
          container_name: undefined,
          evidence: {
            code_location: { end_line: 1, start_line: 1 },
            content_hash: "hash-repo",
            evidence_id: "evidence-repo",
            extractor: "graph",
            path: "package.json",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          label: "build",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: undefined,
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
      symbol: {
        confidence: 1,
        container_name: undefined,
        evidence: {
          code_location: { end_line: 4, start_line: 1 },
          content_hash: "hash-1",
          evidence_id: "evidence-1",
          extractor: "ast-grep:function_declaration",
          path: "main.ts",
        },
        index_run_id: "run-3",
        kind: "function_declaration",
        language: "ts",
        name: "mcpFixtureEntry",
        ranking: {
          exact_name_match: true,
          exact_path_match: true,
          kind_match: false,
          score: 10,
        },
        scope: "file",
        signature: undefined,
        source_type: "code",
      },
      tests: [
        {
          confidence: 0.5,
          container_name: undefined,
          evidence: {
            code_location: { end_line: 30, start_line: 24 },
            content_hash: "hash-test",
            evidence_id: "evidence-test",
            extractor: "graph",
            path: "main.test.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          label: "main test",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: undefined,
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
    });
  });

  it("maps explicit ambiguous symbol errors into MCP tool errors", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request.mockRejectedValue(
      new LkgError(ERROR_CODES.AMBIGUOUS_SYMBOL, "Symbol is ambiguous", {
        candidates: [
          {
            confidence: 0.8,
            evidence: {
              codeLocation: { endLine: 4, startLine: 1 },
              contentHash: "hash-1",
              evidenceId: "evidence-1",
              extractor: "ast-grep:function_declaration",
              path: "main.ts",
            },
            indexRunId: "run-3",
            kind: "function_declaration",
            language: "ts",
            name: "mcpFixtureEntry",
            scope: "file",
            sourceType: "code",
          },
        ],
      }),
    );

    const server = createMcpServer(dependencies);
    const tool = getTool(server, "lkg.symbol");
    const result = await tool.handler({ path: "main.ts", symbol: "mcpFixtureEntry" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: ERROR_CODES.AMBIGUOUS_SYMBOL,
      details: {
        candidates: [
          {
            confidence: 0.8,
            evidence: {
              codeLocation: { endLine: 4, startLine: 1 },
              contentHash: "hash-1",
              evidenceId: "evidence-1",
              extractor: "ast-grep:function_declaration",
              path: "main.ts",
            },
            indexRunId: "run-3",
            kind: "function_declaration",
            language: "ts",
            name: "mcpFixtureEntry",
            scope: "file",
            sourceType: "code",
          },
        ],
      },
      message: "Symbol is ambiguous",
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
    const unknownTool = getTool(unknownServer, "lkg.symbols");
    const unknownErrorResult = await unknownTool.handler({ query: "boom" });

    expect(unknownErrorResult.isError).toBe(true);
    expect(unknownErrorResult.structuredContent).toEqual({
      code: ERROR_CODES.INTERNAL_ERROR,
      details: {},
      message: "Unexpected internal error.",
    });
  });
});
