import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { createMcpServer } from "./mcp-server.js";
import type { DaemonResponse } from "../application/dto/daemon.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

type RegisteredTool = ReturnType<
  ReturnType<typeof createMcpServer>["registerTool"]
>;

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

function getTool(
  server: ReturnType<typeof createMcpServer>,
  name: string,
): TestTool {
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

    expect(dependencies.daemonClient.request).toHaveBeenCalledWith({
      type: "status",
    });
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
            artifactKind: "workflow",
            codeLocation: { endLine: 14, startLine: 10 },
            docLocation: { offset: 8, section: "Intro" },
            evidenceId: "evidence-1",
            partitionId: "src/main.ts:0",
            partitionIndex: 0,
            partitionStatus: "partial",
            partitionTotal: 2,
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
          artifact_kind: "workflow",
          end_line: 14,
          evidence_id: "evidence-1",
          offset: 8,
          partition_id: "src/main.ts:0",
          partition_index: 0,
          partition_status: "partial",
          partition_total: 2,
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

  it("maps symbols and symbol detail responses to MCP output", async () => {
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
      command: {
        kind: undefined,
        path: "main.ts",
        query: "fixture",
        sourceType: "code",
      },
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

  it("maps symbol candidates safely when codeLocation is absent", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request
      .mockResolvedValueOnce({
        result: {
          results: [
            {
              confidence: 0.91,
              evidence: {
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
        type: "symbols.query",
      } satisfies Extract<DaemonResponse, { type: "symbols.query" }>)
      .mockResolvedValueOnce({
        result: {
          candidates: [
            {
              confidence: 0.91,
              evidence: {
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
        type: "symbol.get",
      } satisfies Extract<DaemonResponse, { type: "symbol.get" }>);

    const server = createMcpServer(dependencies);
    const symbolsTool = getTool(server, "lkg.symbols");
    const symbolTool = getTool(server, "lkg.symbol");

    const listResult = await symbolsTool.handler({ query: "fixture" });
    const detailResult = await symbolTool.handler({
      path: "main.ts",
      symbol: "mcpFixtureEntry",
    });

    expect(listResult.isError).not.toBe(true);
    expect(listResult.structuredContent).toEqual({
      results: [
        {
          confidence: 0.91,
          container_name: undefined,
          evidence: {
            code_location: undefined,
            content_hash: "hash-1",
            evidence_id: "evidence-1",
            extractor: "ast-grep:function_declaration",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
          language: "ts",
          name: "mcpFixtureEntry",
          ranking: undefined,
          scope: "file",
          signature: undefined,
          source_type: "code",
        },
      ],
    });
    expect(detailResult.isError).not.toBe(true);
    expect(detailResult.structuredContent).toEqual({
      candidates: [
        {
          confidence: 0.91,
          container_name: undefined,
          evidence: {
            code_location: undefined,
            content_hash: "hash-1",
            evidence_id: "evidence-1",
            extractor: "ast-grep:function_declaration",
            path: "main.ts",
          },
          index_run_id: "run-3",
          kind: "function_declaration",
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

  it("maps entrypoints, flow, impact, and slice responses to MCP output", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request
      .mockResolvedValueOnce({
        result: {
          limitations: [
            {
              detail: "bounded entrypoint analysis",
              kind: "bounded-analysis",
            },
          ],
          results: [
            {
              command: "node dist/main.js",
              confidence: 0.95,
              detectionReason: "Derived from canonical fact package_script",
              endLine: 9,
              entrypointId: "entrypoint-1",
              evidence: [
                {
                  codeLocation: { endLine: 9, startLine: 3 },
                  path: "package.json",
                  precisionTier: "derived",
                  provenance: {
                    contentHash: "hash-entry",
                    evidenceId: "evidence-entry",
                    extractor: "artifact:repo-config",
                    indexRunId: "run-1",
                    path: "package.json",
                  },
                  sourceType: "code",
                },
              ],
              kind: "script",
              name: "start",
              path: "package.json",
              precisionTier: "derived",
              startLine: 3,
              symbolId: "symbol-start",
              trigger: "startup",
            },
          ],
        },
        type: "entrypoints.list",
      } satisfies Extract<DaemonResponse, { type: "entrypoints.list" }>)
      .mockResolvedValueOnce({
        result: {
          limitations: [
            {
              detail: "bounded flow analysis",
              failureClass: "BUDGET_EXHAUSTED",
              kind: "budget",
            },
          ],
          traces: [
            {
              completeness: "truncated",
              confidence: 0.7,
              end: {
                codeLocation: { endLine: 7, startLine: 6 },
                id: "symbol-b",
                kind: "symbol",
                name: "b",
                path: "src/main.ts",
                sourceType: "code",
              },
              precisionTier: "possible",
              segments: [
                {
                  confidence: 0.7,
                  evidence: [
                    {
                      codeLocation: { endLine: 4, startLine: 1 },
                      path: "src/main.ts",
                      precisionTier: "possible",
                      provenance: {
                        contentHash: "hash-flow",
                        evidenceId: "evidence-flow",
                        extractor: "derived-fact",
                        indexRunId: "run-1",
                        path: "src/main.ts",
                      },
                      sourceType: "code",
                    },
                  ],
                  from: {
                    codeLocation: { endLine: 2, startLine: 1 },
                    id: "symbol-a",
                    kind: "symbol",
                    name: "a",
                    path: "src/main.ts",
                    sourceType: "code",
                  },
                  precisionTier: "possible",
                  relationKind: "caller-callee-candidate",
                  to: {
                    codeLocation: { endLine: 7, startLine: 6 },
                    id: "symbol-b",
                    kind: "symbol",
                    name: "b",
                    path: "src/main.ts",
                    sourceType: "code",
                  },
                },
              ],
              start: {
                codeLocation: { endLine: 2, startLine: 1 },
                id: "symbol-a",
                kind: "symbol",
                name: "a",
                path: "src/main.ts",
                sourceType: "code",
              },
              traceId: "trace-1",
            },
          ],
        },
        type: "flow.trace",
      } satisfies Extract<DaemonResponse, { type: "flow.trace" }>)
      .mockResolvedValueOnce({
        result: {
          impacts: [
            {
              anchor: {
                codeLocation: { endLine: 12, startLine: 10 },
                id: "workflow:ci",
                kind: "workflow",
                name: "ci",
                path: ".github/workflows/ci.yml",
                sourceType: "code",
              },
              classification: "possible",
              confidence: 0.8,
              evidence: [
                {
                  codeLocation: { endLine: 12, startLine: 10 },
                  path: ".github/workflows/ci.yml",
                  precisionTier: "possible",
                  provenance: {
                    contentHash: "hash-impact",
                    evidenceId: "evidence-impact",
                    extractor: "derived-fact",
                    indexRunId: "run-1",
                    path: ".github/workflows/ci.yml",
                  },
                  sourceType: "code",
                },
              ],
              impactId: "impact-1",
              kind: "workflow",
              paths: [
                {
                  confidence: 0.8,
                  end: {
                    id: "workflow:ci",
                    kind: "workflow",
                    name: "ci",
                    path: ".github/workflows/ci.yml",
                    sourceType: "code",
                  },
                  precisionTier: "possible",
                  segments: [
                    {
                      confidence: 0.8,
                      evidence: [
                        {
                          path: ".github/workflows/ci.yml",
                          precisionTier: "possible",
                          provenance: {
                            contentHash: "hash-impact",
                            evidenceId: "evidence-impact",
                            extractor: "derived-fact",
                            indexRunId: "run-1",
                            path: ".github/workflows/ci.yml",
                          },
                          sourceType: "code",
                        },
                      ],
                      from: {
                        id: "task:start",
                        kind: "task",
                        name: "start",
                        path: "package.json",
                        sourceType: "code",
                      },
                      precisionTier: "possible",
                      relationKind: "workflow-runs-package-script-candidate",
                      to: {
                        id: "workflow:ci",
                        kind: "workflow",
                        name: "ci",
                        path: ".github/workflows/ci.yml",
                        sourceType: "code",
                      },
                    },
                  ],
                  start: {
                    id: "task:start",
                    kind: "task",
                    name: "start",
                    path: "package.json",
                    sourceType: "code",
                  },
                },
              ],
              precisionTier: "possible",
              reasons: [
                {
                  detail:
                    "Impact candidate derived from relation workflow-runs-package-script-candidate",
                  evidence: [
                    {
                      path: ".github/workflows/ci.yml",
                      precisionTier: "possible",
                      provenance: {
                        contentHash: "hash-impact",
                        evidenceId: "evidence-impact",
                        extractor: "derived-fact",
                        indexRunId: "run-1",
                        path: ".github/workflows/ci.yml",
                      },
                      sourceType: "code",
                    },
                  ],
                  precisionTier: "possible",
                  relationKind: "workflow-runs-package-script-candidate",
                },
              ],
            },
          ],
          limitations: [
            {
              detail: "bounded impact analysis",
              kind: "coverage",
            },
          ],
          summary: {
            directCount: 0,
            possibleCount: 1,
            transitiveCount: 0,
            truncated: false,
          },
          target: {
            codeLocation: { endLine: 5, startLine: 1 },
            id: "task:start",
            kind: "task",
            name: "start",
            path: "package.json",
            sourceType: "code",
          },
        },
        type: "impact.analyze",
      } satisfies Extract<DaemonResponse, { type: "impact.analyze" }>)
      .mockResolvedValueOnce({
        result: {
          completeness: "partial",
          criterion: {
            codeLocation: { endLine: 5, startLine: 1 },
            id: "symbol-main",
            kind: "symbol",
            name: "main",
            path: "src/main.ts",
            sourceType: "code",
          },
          items: [
            {
              anchor: {
                id: "symbol-helper",
                kind: "symbol",
                name: "helper",
                path: "src/main.ts",
                sourceType: "code",
              },
              confidence: 0.77,
              evidence: [
                {
                  path: "src/main.ts",
                  precisionTier: "derived",
                  provenance: {
                    contentHash: "hash-slice",
                    evidenceId: "evidence-slice",
                    extractor: "derived-fact",
                    indexRunId: "run-1",
                    path: "src/main.ts",
                  },
                  sourceType: "code",
                },
              ],
              inclusionReason: "Included via relation caller-callee-candidate",
              precisionTier: "derived",
              relationPath: [
                {
                  confidence: 0.77,
                  evidence: [
                    {
                      path: "src/main.ts",
                      precisionTier: "derived",
                      provenance: {
                        contentHash: "hash-slice",
                        evidenceId: "evidence-slice",
                        extractor: "derived-fact",
                        indexRunId: "run-1",
                        path: "src/main.ts",
                      },
                      sourceType: "code",
                    },
                  ],
                  from: {
                    id: "symbol-main",
                    kind: "symbol",
                    name: "main",
                    path: "src/main.ts",
                    sourceType: "code",
                  },
                  precisionTier: "derived",
                  relationKind: "caller-callee-candidate",
                  to: {
                    id: "symbol-helper",
                    kind: "symbol",
                    name: "helper",
                    path: "src/main.ts",
                    sourceType: "code",
                  },
                },
              ],
            },
          ],
          limitations: [
            {
              detail: "bounded slice analysis",
              kind: "coverage",
            },
          ],
          sliceId: "slice-1",
        },
        type: "slice.compute",
      } satisfies Extract<DaemonResponse, { type: "slice.compute" }>);

    const server = createMcpServer(dependencies);

    const entrypointsResult = await getTool(server, "lkg.entrypoints").handler({
      confidence_min: 0.9,
      kind: "script",
      limit: 5,
      package: "app",
      path: "package.json",
      query: "start",
    });
    const flowResult = await getTool(server, "lkg.flow").handler({
      confidence_min: 0.7,
      direction: "both",
      from: {
        end_line: 2,
        id: "symbol-a",
        kind: "symbol",
        name: "a",
        path: "src/main.ts",
        source_type: "code",
        start_line: 1,
      },
      include: ["calls", "workflow"],
      max_depth: 3,
      max_nodes: 9,
      time_budget_ms: 1200,
      to: {
        end_line: 7,
        id: "symbol-b",
        kind: "symbol",
        name: "b",
        path: "src/main.ts",
        source_type: "code",
        start_line: 6,
      },
    });
    const impactResult = await getTool(server, "lkg.impact").handler({
      confidence_min: 0.5,
      max_depth: 4,
      max_results: 10,
      mode: "runtime",
      target: {
        end_line: 5,
        id: "task:start",
        kind: "task",
        name: "start",
        path: "package.json",
        source_type: "code",
        start_line: 1,
      },
    });
    const sliceResult = await getTool(server, "lkg.slice").handler({
      criterion: {
        end_line: 5,
        id: "symbol-main",
        kind: "symbol",
        name: "main",
        path: "src/main.ts",
        source_type: "code",
        start_line: 1,
      },
      direction: "forward",
      include: ["calls", "config"],
      max_evidence: 20,
      max_files: 5,
      max_nodes: 25,
    });

    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(1, {
      command: {
        confidenceMin: 0.9,
        kind: "script",
        limit: 5,
        package: "app",
        path: "package.json",
        query: "start",
      },
      type: "entrypoints.list",
    });
    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(2, {
      command: {
        confidenceMin: 0.7,
        direction: "both",
        from: {
          codeLocation: { endLine: 2, startLine: 1 },
          id: "symbol-a",
          kind: "symbol",
          name: "a",
          path: "src/main.ts",
          sourceType: "code",
        },
        include: ["calls", "workflow"],
        maxDepth: 3,
        maxNodes: 9,
        timeBudgetMs: 1200,
        to: {
          codeLocation: { endLine: 7, startLine: 6 },
          id: "symbol-b",
          kind: "symbol",
          name: "b",
          path: "src/main.ts",
          sourceType: "code",
        },
      },
      type: "flow.trace",
    });
    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(3, {
      command: {
        confidenceMin: 0.5,
        maxDepth: 4,
        maxResults: 10,
        mode: "runtime",
        target: {
          codeLocation: { endLine: 5, startLine: 1 },
          id: "task:start",
          kind: "task",
          name: "start",
          path: "package.json",
          sourceType: "code",
        },
      },
      type: "impact.analyze",
    });
    expect(dependencies.daemonClient.request).toHaveBeenNthCalledWith(4, {
      command: {
        criterion: {
          codeLocation: { endLine: 5, startLine: 1 },
          id: "symbol-main",
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
        direction: "forward",
        include: ["calls", "config"],
        maxEvidence: 20,
        maxFiles: 5,
        maxNodes: 25,
      },
      type: "slice.compute",
    });

    expect(entrypointsResult.structuredContent).toEqual({
      limitations: [
        {
          detail: "bounded entrypoint analysis",
          failure_class: undefined,
          kind: "bounded-analysis",
        },
      ],
      results: [
        {
          command: "node dist/main.js",
          confidence: 0.95,
          detection_reason: "Derived from canonical fact package_script",
          end_line: 9,
          entrypoint_id: "entrypoint-1",
          evidence: [
            {
              end_line: 9,
              evidence_id: "evidence-entry",
              offset: undefined,
              path: "package.json",
              precision_tier: "derived",
              provenance: {
                content_hash: "hash-entry",
                evidence_id: "evidence-entry",
                extractor: "artifact:repo-config",
                index_run_id: "run-1",
                path: "package.json",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: 3,
            },
          ],
          kind: "script",
          name: "start",
          path: "package.json",
          precision_tier: "derived",
          start_line: 3,
          symbol_id: "symbol-start",
          trigger: "startup",
        },
      ],
    });
    expect(flowResult.structuredContent).toEqual({
      limitations: [
        {
          detail: "bounded flow analysis",
          failure_class: "BUDGET_EXHAUSTED",
          kind: "budget",
        },
      ],
      traces: [
        {
          completeness: "truncated",
          confidence: 0.7,
          end: {
            end_line: 7,
            id: "symbol-b",
            kind: "symbol",
            name: "b",
            path: "src/main.ts",
            source_type: "code",
            start_line: 6,
          },
          precision_tier: "possible",
          segments: [
            {
              confidence: 0.7,
              evidence: [
                {
                  end_line: 4,
                  evidence_id: "evidence-flow",
                  offset: undefined,
                  path: "src/main.ts",
                  precision_tier: "possible",
                  provenance: {
                    content_hash: "hash-flow",
                    evidence_id: "evidence-flow",
                    extractor: "derived-fact",
                    index_run_id: "run-1",
                    path: "src/main.ts",
                  },
                  section: undefined,
                  snippet: undefined,
                  source_type: "code",
                  start_line: 1,
                },
              ],
              from: {
                end_line: 2,
                id: "symbol-a",
                kind: "symbol",
                name: "a",
                path: "src/main.ts",
                source_type: "code",
                start_line: 1,
              },
              precision_tier: "possible",
              relation_kind: "caller-callee-candidate",
              to: {
                end_line: 7,
                id: "symbol-b",
                kind: "symbol",
                name: "b",
                path: "src/main.ts",
                source_type: "code",
                start_line: 6,
              },
            },
          ],
          start: {
            end_line: 2,
            id: "symbol-a",
            kind: "symbol",
            name: "a",
            path: "src/main.ts",
            source_type: "code",
            start_line: 1,
          },
          trace_id: "trace-1",
        },
      ],
    });
    expect(impactResult.structuredContent).toEqual({
      impacts: [
        {
          anchor: {
            end_line: 12,
            id: "workflow:ci",
            kind: "workflow",
            name: "ci",
            path: ".github/workflows/ci.yml",
            source_type: "code",
            start_line: 10,
          },
          classification: "possible",
          confidence: 0.8,
          evidence: [
            {
              end_line: 12,
              evidence_id: "evidence-impact",
              offset: undefined,
              path: ".github/workflows/ci.yml",
              precision_tier: "possible",
              provenance: {
                content_hash: "hash-impact",
                evidence_id: "evidence-impact",
                extractor: "derived-fact",
                index_run_id: "run-1",
                path: ".github/workflows/ci.yml",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: 10,
            },
          ],
          impact_id: "impact-1",
          kind: "workflow",
          paths: [
            {
              confidence: 0.8,
              end: {
                end_line: undefined,
                id: "workflow:ci",
                kind: "workflow",
                name: "ci",
                path: ".github/workflows/ci.yml",
                source_type: "code",
                start_line: undefined,
              },
              precision_tier: "possible",
              segments: [
                {
                  confidence: 0.8,
                  evidence: [
                    {
                      end_line: undefined,
                      evidence_id: "evidence-impact",
                      offset: undefined,
                      path: ".github/workflows/ci.yml",
                      precision_tier: "possible",
                      provenance: {
                        content_hash: "hash-impact",
                        evidence_id: "evidence-impact",
                        extractor: "derived-fact",
                        index_run_id: "run-1",
                        path: ".github/workflows/ci.yml",
                      },
                      section: undefined,
                      snippet: undefined,
                      source_type: "code",
                      start_line: undefined,
                    },
                  ],
                  from: {
                    end_line: undefined,
                    id: "task:start",
                    kind: "task",
                    name: "start",
                    path: "package.json",
                    source_type: "code",
                    start_line: undefined,
                  },
                  precision_tier: "possible",
                  relation_kind: "workflow-runs-package-script-candidate",
                  to: {
                    end_line: undefined,
                    id: "workflow:ci",
                    kind: "workflow",
                    name: "ci",
                    path: ".github/workflows/ci.yml",
                    source_type: "code",
                    start_line: undefined,
                  },
                },
              ],
              start: {
                end_line: undefined,
                id: "task:start",
                kind: "task",
                name: "start",
                path: "package.json",
                source_type: "code",
                start_line: undefined,
              },
            },
          ],
          precision_tier: "possible",
          reasons: [
            {
              detail:
                "Impact candidate derived from relation workflow-runs-package-script-candidate",
              evidence: [
                {
                  end_line: undefined,
                  evidence_id: "evidence-impact",
                  offset: undefined,
                  path: ".github/workflows/ci.yml",
                  precision_tier: "possible",
                  provenance: {
                    content_hash: "hash-impact",
                    evidence_id: "evidence-impact",
                    extractor: "derived-fact",
                    index_run_id: "run-1",
                    path: ".github/workflows/ci.yml",
                  },
                  section: undefined,
                  snippet: undefined,
                  source_type: "code",
                  start_line: undefined,
                },
              ],
              precision_tier: "possible",
              relation_kind: "workflow-runs-package-script-candidate",
            },
          ],
        },
      ],
      limitations: [
        {
          detail: "bounded impact analysis",
          failure_class: undefined,
          kind: "coverage",
        },
      ],
      summary: {
        direct_count: 0,
        possible_count: 1,
        transitive_count: 0,
        truncated: false,
      },
      target: {
        end_line: 5,
        id: "task:start",
        kind: "task",
        name: "start",
        path: "package.json",
        source_type: "code",
        start_line: 1,
      },
    });
    expect(sliceResult.structuredContent).toEqual({
      completeness: "partial",
      criterion: {
        end_line: 5,
        id: "symbol-main",
        kind: "symbol",
        name: "main",
        path: "src/main.ts",
        source_type: "code",
        start_line: 1,
      },
      items: [
        {
          anchor: {
            end_line: undefined,
            id: "symbol-helper",
            kind: "symbol",
            name: "helper",
            path: "src/main.ts",
            source_type: "code",
            start_line: undefined,
          },
          confidence: 0.77,
          evidence: [
            {
              end_line: undefined,
              evidence_id: "evidence-slice",
              offset: undefined,
              path: "src/main.ts",
              precision_tier: "derived",
              provenance: {
                content_hash: "hash-slice",
                evidence_id: "evidence-slice",
                extractor: "derived-fact",
                index_run_id: "run-1",
                path: "src/main.ts",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: undefined,
            },
          ],
          inclusion_reason: "Included via relation caller-callee-candidate",
          precision_tier: "derived",
          relation_path: [
            {
              confidence: 0.77,
              evidence: [
                {
                  end_line: undefined,
                  evidence_id: "evidence-slice",
                  offset: undefined,
                  path: "src/main.ts",
                  precision_tier: "derived",
                  provenance: {
                    content_hash: "hash-slice",
                    evidence_id: "evidence-slice",
                    extractor: "derived-fact",
                    index_run_id: "run-1",
                    path: "src/main.ts",
                  },
                  section: undefined,
                  snippet: undefined,
                  source_type: "code",
                  start_line: undefined,
                },
              ],
              from: {
                end_line: undefined,
                id: "symbol-main",
                kind: "symbol",
                name: "main",
                path: "src/main.ts",
                source_type: "code",
                start_line: undefined,
              },
              precision_tier: "derived",
              relation_kind: "caller-callee-candidate",
              to: {
                end_line: undefined,
                id: "symbol-helper",
                kind: "symbol",
                name: "helper",
                path: "src/main.ts",
                source_type: "code",
                start_line: undefined,
              },
            },
          ],
        },
      ],
      limitations: [
        {
          detail: "bounded slice analysis",
          failure_class: undefined,
          kind: "coverage",
        },
      ],
      slice_id: "slice-1",
    });
  });

  it("maps analysis outputs safely when optional coordinates are absent", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request
      .mockResolvedValueOnce({
        result: {
          results: [
            {
              confidence: 0.9,
              detectionReason:
                "Derived from relation file-declares-entrypoint-candidate",
              entrypointId: "entrypoint-1",
              evidence: [
                {
                  path: "src/main.ts",
                  precisionTier: "possible",
                  provenance: {
                    contentHash: "hash-entry",
                    evidenceId: "evidence-entry",
                    extractor: "derived-fact",
                    indexRunId: "run-1",
                    path: "src/main.ts",
                  },
                  sourceType: "code",
                },
              ],
              kind: "entrypoint",
              name: "main",
              path: "src/main.ts",
              precisionTier: "possible",
            },
          ],
        },
        type: "entrypoints.list",
      } satisfies Extract<DaemonResponse, { type: "entrypoints.list" }>)
      .mockResolvedValueOnce({
        result: {
          traces: [
            {
              completeness: "partial",
              confidence: 0.7,
              precisionTier: "derived",
              segments: [
                {
                  confidence: 0.7,
                  evidence: [
                    {
                      path: "src/main.ts",
                      precisionTier: "derived",
                      provenance: {
                        contentHash: "hash-flow",
                        evidenceId: "evidence-flow",
                        extractor: "derived-fact",
                        indexRunId: "run-1",
                        path: "src/main.ts",
                      },
                      sourceType: "code",
                    },
                  ],
                  from: { id: "symbol-a", kind: "symbol", name: "a" },
                  precisionTier: "derived",
                  relationKind: "caller-callee-candidate",
                  to: { id: "symbol-b", kind: "symbol", name: "b" },
                },
              ],
              start: { id: "symbol-a", kind: "symbol", name: "a" },
              traceId: "trace-1",
            },
          ],
        },
        type: "flow.trace",
      } satisfies Extract<DaemonResponse, { type: "flow.trace" }>)
      .mockResolvedValueOnce({
        result: {
          impacts: [
            {
              anchor: { id: "symbol-b", kind: "symbol", name: "b" },
              classification: "direct",
              confidence: 0.7,
              evidence: [
                {
                  path: "src/main.ts",
                  precisionTier: "derived",
                  provenance: {
                    contentHash: "hash-impact",
                    evidenceId: "evidence-impact",
                    extractor: "derived-fact",
                    indexRunId: "run-1",
                    path: "src/main.ts",
                  },
                  sourceType: "code",
                },
              ],
              impactId: "impact-1",
              kind: "symbol",
              paths: [
                {
                  confidence: 0.7,
                  end: { id: "symbol-b", kind: "symbol", name: "b" },
                  precisionTier: "derived",
                  segments: [],
                  start: { id: "symbol-a", kind: "symbol", name: "a" },
                },
              ],
              precisionTier: "derived",
              reasons: [
                {
                  detail:
                    "Impact candidate derived from relation caller-callee-candidate",
                  evidence: [],
                  precisionTier: "derived",
                  relationKind: "caller-callee-candidate",
                },
              ],
            },
          ],
          summary: {
            directCount: 1,
            possibleCount: 0,
            transitiveCount: 0,
            truncated: false,
          },
          target: { id: "symbol-a", kind: "symbol", name: "a" },
        },
        type: "impact.analyze",
      } satisfies Extract<DaemonResponse, { type: "impact.analyze" }>)
      .mockResolvedValueOnce({
        result: {
          completeness: "partial",
          criterion: { id: "symbol-a", kind: "symbol", name: "a" },
          items: [
            {
              anchor: { id: "symbol-b", kind: "symbol", name: "b" },
              confidence: 0.7,
              evidence: [
                {
                  path: "src/main.ts",
                  precisionTier: "derived",
                  provenance: {
                    contentHash: "hash-slice",
                    evidenceId: "evidence-slice",
                    extractor: "derived-fact",
                    indexRunId: "run-1",
                    path: "src/main.ts",
                  },
                  sourceType: "code",
                },
              ],
              inclusionReason: "Included via relation caller-callee-candidate",
              precisionTier: "derived",
              relationPath: [],
            },
          ],
          sliceId: "slice-1",
        },
        type: "slice.compute",
      } satisfies Extract<DaemonResponse, { type: "slice.compute" }>);

    const server = createMcpServer(dependencies);

    const entrypointsResult = await getTool(server, "lkg.entrypoints").handler(
      {},
    );
    const flowResult = await getTool(server, "lkg.flow").handler({
      from: { kind: "symbol", name: "a" },
    });
    const impactResult = await getTool(server, "lkg.impact").handler({
      target: { kind: "symbol", name: "a" },
    });
    const sliceResult = await getTool(server, "lkg.slice").handler({
      criterion: { kind: "symbol", name: "a" },
    });

    expect(entrypointsResult.isError).not.toBe(true);
    expect(flowResult.isError).not.toBe(true);
    expect(impactResult.isError).not.toBe(true);
    expect(sliceResult.isError).not.toBe(true);

    expect(entrypointsResult.structuredContent).toEqual({
      limitations: undefined,
      results: [
        {
          command: undefined,
          confidence: 0.9,
          detection_reason:
            "Derived from relation file-declares-entrypoint-candidate",
          end_line: undefined,
          entrypoint_id: "entrypoint-1",
          evidence: [
            {
              end_line: undefined,
              evidence_id: "evidence-entry",
              offset: undefined,
              path: "src/main.ts",
              precision_tier: "possible",
              provenance: {
                content_hash: "hash-entry",
                evidence_id: "evidence-entry",
                extractor: "derived-fact",
                index_run_id: "run-1",
                path: "src/main.ts",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: undefined,
            },
          ],
          kind: "entrypoint",
          name: "main",
          path: "src/main.ts",
          precision_tier: "possible",
          start_line: undefined,
          symbol_id: undefined,
          trigger: undefined,
        },
      ],
    });
    expect(flowResult.structuredContent).toEqual({
      limitations: undefined,
      traces: [
        {
          completeness: "partial",
          confidence: 0.7,
          end: undefined,
          precision_tier: "derived",
          segments: [
            {
              confidence: 0.7,
              evidence: [
                {
                  end_line: undefined,
                  evidence_id: "evidence-flow",
                  offset: undefined,
                  path: "src/main.ts",
                  precision_tier: "derived",
                  provenance: {
                    content_hash: "hash-flow",
                    evidence_id: "evidence-flow",
                    extractor: "derived-fact",
                    index_run_id: "run-1",
                    path: "src/main.ts",
                  },
                  section: undefined,
                  snippet: undefined,
                  source_type: "code",
                  start_line: undefined,
                },
              ],
              from: {
                end_line: undefined,
                id: "symbol-a",
                kind: "symbol",
                name: "a",
                path: undefined,
                source_type: undefined,
                start_line: undefined,
              },
              precision_tier: "derived",
              relation_kind: "caller-callee-candidate",
              to: {
                end_line: undefined,
                id: "symbol-b",
                kind: "symbol",
                name: "b",
                path: undefined,
                source_type: undefined,
                start_line: undefined,
              },
            },
          ],
          start: {
            end_line: undefined,
            id: "symbol-a",
            kind: "symbol",
            name: "a",
            path: undefined,
            source_type: undefined,
            start_line: undefined,
          },
          trace_id: "trace-1",
        },
      ],
    });
    expect(impactResult.structuredContent).toEqual({
      impacts: [
        {
          anchor: {
            end_line: undefined,
            id: "symbol-b",
            kind: "symbol",
            name: "b",
            path: undefined,
            source_type: undefined,
            start_line: undefined,
          },
          classification: "direct",
          confidence: 0.7,
          evidence: [
            {
              end_line: undefined,
              evidence_id: "evidence-impact",
              offset: undefined,
              path: "src/main.ts",
              precision_tier: "derived",
              provenance: {
                content_hash: "hash-impact",
                evidence_id: "evidence-impact",
                extractor: "derived-fact",
                index_run_id: "run-1",
                path: "src/main.ts",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: undefined,
            },
          ],
          impact_id: "impact-1",
          kind: "symbol",
          paths: [
            {
              confidence: 0.7,
              end: {
                end_line: undefined,
                id: "symbol-b",
                kind: "symbol",
                name: "b",
                path: undefined,
                source_type: undefined,
                start_line: undefined,
              },
              precision_tier: "derived",
              segments: [],
              start: {
                end_line: undefined,
                id: "symbol-a",
                kind: "symbol",
                name: "a",
                path: undefined,
                source_type: undefined,
                start_line: undefined,
              },
            },
          ],
          precision_tier: "derived",
          reasons: [
            {
              detail:
                "Impact candidate derived from relation caller-callee-candidate",
              evidence: [],
              precision_tier: "derived",
              relation_kind: "caller-callee-candidate",
            },
          ],
        },
      ],
      limitations: undefined,
      summary: {
        direct_count: 1,
        possible_count: 0,
        transitive_count: 0,
        truncated: false,
      },
      target: {
        end_line: undefined,
        id: "symbol-a",
        kind: "symbol",
        name: "a",
        path: undefined,
        source_type: undefined,
        start_line: undefined,
      },
    });
    expect(sliceResult.structuredContent).toEqual({
      completeness: "partial",
      criterion: {
        end_line: undefined,
        id: "symbol-a",
        kind: "symbol",
        name: "a",
        path: undefined,
        source_type: undefined,
        start_line: undefined,
      },
      items: [
        {
          anchor: {
            end_line: undefined,
            id: "symbol-b",
            kind: "symbol",
            name: "b",
            path: undefined,
            source_type: undefined,
            start_line: undefined,
          },
          confidence: 0.7,
          evidence: [
            {
              end_line: undefined,
              evidence_id: "evidence-slice",
              offset: undefined,
              path: "src/main.ts",
              precision_tier: "derived",
              provenance: {
                content_hash: "hash-slice",
                evidence_id: "evidence-slice",
                extractor: "derived-fact",
                index_run_id: "run-1",
                path: "src/main.ts",
              },
              section: undefined,
              snippet: undefined,
              source_type: "code",
              start_line: undefined,
            },
          ],
          inclusion_reason: "Included via relation caller-callee-candidate",
          precision_tier: "derived",
          relation_path: [],
        },
      ],
      limitations: undefined,
      slice_id: "slice-1",
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
    const result = await tool.handler({
      path: "main.ts",
      symbol: "mcpFixtureEntry",
    });

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

  it("maps Milestone 4.1 analysis LkgErrors into MCP tool errors", async () => {
    const dependencies = createDependencies();
    dependencies.daemonClient.request
      .mockRejectedValueOnce(
        new LkgError(
          ERROR_CODES.ANALYSIS_NOT_READY,
          "The knowledge index is not ready for entrypoint analysis.",
        ),
      )
      .mockRejectedValueOnce(
        new LkgError(
          ERROR_CODES.ANCHOR_NOT_FOUND,
          "Anchor not found: missing",
          {
            anchor: { kind: "symbol", name: "missing" },
          },
        ),
      )
      .mockRejectedValueOnce(
        new LkgError(
          ERROR_CODES.AMBIGUOUS_ANCHOR,
          "Anchor is ambiguous: main",
          {
            candidates: [{ id: "symbol-main" }],
          },
        ),
      )
      .mockRejectedValueOnce(
        new LkgError(
          ERROR_CODES.INVALID_INPUT,
          "criterion.name must not be empty.",
        ),
      );

    const server = createMcpServer(dependencies);

    const entrypointsError = await getTool(server, "lkg.entrypoints").handler({
      query: "start",
    });
    const flowError = await getTool(server, "lkg.flow").handler({
      from: { kind: "symbol", name: "missing" },
    });
    const impactError = await getTool(server, "lkg.impact").handler({
      target: { kind: "symbol", name: "main" },
    });
    const sliceError = await getTool(server, "lkg.slice").handler({
      criterion: { kind: "symbol", name: "criterion" },
    });

    expect(entrypointsError.structuredContent).toEqual({
      code: ERROR_CODES.ANALYSIS_NOT_READY,
      details: {},
      message: "The knowledge index is not ready for entrypoint analysis.",
    });
    expect(flowError.structuredContent).toEqual({
      code: ERROR_CODES.ANCHOR_NOT_FOUND,
      details: {
        anchor: { kind: "symbol", name: "missing" },
      },
      message: "Anchor not found: missing",
    });
    expect(impactError.structuredContent).toEqual({
      code: ERROR_CODES.AMBIGUOUS_ANCHOR,
      details: {
        candidates: [{ id: "symbol-main" }],
      },
      message: "Anchor is ambiguous: main",
    });
    expect(sliceError.structuredContent).toEqual({
      code: ERROR_CODES.INVALID_INPUT,
      details: {},
      message: "criterion.name must not be empty.",
    });
  });

  it("maps LkgError and unknown errors into tool errors", async () => {
    const knownDependencies = createDependencies();
    knownDependencies.daemonClient.request.mockRejectedValue(
      new LkgError(ERROR_CODES.INVALID_INPUT, "Bad request", {
        field: "query",
      }),
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
    unknownDependencies.daemonClient.request.mockRejectedValue(
      new Error("boom"),
    );
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
