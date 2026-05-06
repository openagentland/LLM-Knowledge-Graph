import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { materializeFixtureProject } from "../helpers/materialize-fixture-project.js";
import { parseToolTextPayload } from "../helpers/mcp-payload.js";
import type { McpStdioClient } from "../helpers/mcp-stdio-client.js";
import { startMcpServer } from "../helpers/mcp-stdio-client.js";

describe("MCP server e2e", () => {
  let cwd: string;
  let client: McpStdioClient | undefined;

  async function startInitializedClient(
    envOverrides: NodeJS.ProcessEnv = {},
    options: { fixtureName?: string; homeDir?: string } = {},
  ): Promise<McpStdioClient> {
    cwd = await materializeFixtureProject(options.fixtureName ?? "mcp-basic");
    client = startMcpServer(envOverrides, { cwd, homeDir: options.homeDir });
    await client.initialize();
    return client;
  }

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  describe("tool discovery and pre-index contracts", () => {
    it("completes initialize handshake over stdio", async () => {
      cwd = await materializeFixtureProject("mcp-basic");
      client = startMcpServer({}, { cwd });

      const result = await client.initialize();

      expect(result.serverInfo.name).toBe("lkg");
      expect(result.serverInfo.version).toBe(packageJson.version);
      expect(result.capabilities).toHaveProperty("tools");
    });

    it("lists the full stable MCP tool surface", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.listTools();
      const toolNames = result.tools.map((tool) => {
        const record = tool as { name?: string };
        return record.name;
      });

      expect(toolNames).toEqual(
        expect.arrayContaining([
          "lkg.status",
          "lkg.index",
          "lkg.search",
          "lkg.symbols",
          "lkg.symbol",
          "lkg.entrypoints",
          "lkg.flow",
          "lkg.impact",
          "lkg.slice",
        ]),
      );
      expect(new Set(toolNames).size).toBe(toolNames.length);
    });
  });

  describe("runtime recovery and post-index MCP payloads", () => {
    it("recovers from a stale daemon registry entry during startup", async () => {
      const homeDir = mkdtempSync(join(tmpdir(), "lkg-e2e-stale-daemon-"));
      const initializedClient = await startInitializedClient({}, { homeDir });
      const staleProjectIdentity = parseToolTextPayload<{
        activeProjectIdentity: string;
      }>(await initializedClient.callTool("lkg.status")).activeProjectIdentity;
      await initializedClient.close();
      client = undefined;

      const daemonDir = join(homeDir, "daemon");
      mkdirSync(daemonDir, { recursive: true });
      writeFileSync(
        join(daemonDir, `${staleProjectIdentity}.json`),
        `${JSON.stringify({
          configFingerprint: "stale-fingerprint",
          pid: 999999,
          socketPath: join(daemonDir, "missing.sock"),
          startedAt: "2026-05-03T00:00:00.000Z",
        })}\n`,
        "utf8",
      );

      client = startMcpServer({}, { cwd, homeDir });
      await client.initialize();

      const result = await client.callTool("lkg.status");
      const structuredContent = parseToolTextPayload<{
        daemonState: string;
        runtimeState: string;
      }>(result);

      expect(structuredContent.daemonState).toBe("ready");
      expect(structuredContent.runtimeState).toBe("ready");
      expect(readFileSync(client.runtime.logFile, "utf8")).toContain(
        '"event":"daemon.started"',
      );
    });

    it("returns the status snapshot after initialize", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.callTool("lkg.status");
      const structuredContent = parseToolTextPayload<{
        activeProjectIdentity: string;
        daemonState: string;
        indexScope: string;
        needsReindex: boolean;
        pendingChanges: boolean;
        runtimeState: string;
        state: string;
        watcherState: string;
      }>(result);

      expect(structuredContent.state).toBe("idle");
      expect(structuredContent.needsReindex).toBe(true);
      expect(structuredContent.pendingChanges).toBe(false);
      expect(structuredContent.watcherState).toBe("disabled");
      expect(structuredContent.daemonState).toBe("ready");
      expect(structuredContent.runtimeState).toBe("ready");
      expect(structuredContent.indexScope).toMatch(/^(shared|branch)$/);
      expect(structuredContent.activeProjectIdentity.length).toBeGreaterThan(0);
    });

    it("returns an MCP tool error payload when lkg.search runs before indexing", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.callTool("lkg.search", {
        query: "architecture",
      });
      const payload = parseToolTextPayload<{ code: string }>(result);

      expect(result.isError).toBe(true);
      expect(payload.code).toBe("INDEX_NOT_READY");
    });

    it("returns an MCP tool error payload when lkg.symbols runs before indexing", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.callTool("lkg.symbols", {
        query: "fixture",
      });
      const payload = parseToolTextPayload<{ code: string }>(result);

      expect(result.isError).toBe(true);
      expect(payload.code).toBe("INDEX_NOT_READY");
    });

    it("returns post-index search payloads with provenance and partition metadata", async () => {
      const initializedClient = await startInitializedClient();

      await initializedClient.callTool("lkg.index", { mode: "full" });

      const result = await initializedClient.callTool("lkg.search", {
        query: "fixture",
      });
      const payload = parseToolTextPayload<{
        results: Array<{
          artifact_kind: string;
          evidence_id: string;
          partition_id?: string;
          partition_index?: number;
          partition_status?: string;
          partition_total?: number;
          path: string;
          provenance: {
            content_hash: string;
            extractor: string;
            index_run_id: string;
          };
          snippet: string;
          source_type: string;
        }>;
      }>(result);
      const firstResult = payload.results[0];

      expect(result.isError).not.toBe(true);
      expect(payload.results.length).toBeGreaterThan(0);
      expect(firstResult?.artifact_kind).toMatch(
        /^(code|config|doc|generated|lockfile|schema|script|test|workflow)$/,
      );
      expect(firstResult?.evidence_id).toEqual(expect.any(String));
      expect(firstResult?.path).toEqual(expect.any(String));
      expect(firstResult?.provenance.content_hash).toEqual(expect.any(String));
      expect(firstResult?.provenance.extractor).toEqual(expect.any(String));
      expect(firstResult?.provenance.index_run_id).toEqual(expect.any(String));
      expect(firstResult?.snippet).toEqual(expect.any(String));
      expect(firstResult?.source_type).toMatch(/^(code|doc)$/);
      if (firstResult?.partition_id !== undefined) {
        expect(firstResult.partition_index).toEqual(expect.any(Number));
        expect(firstResult.partition_status).toMatch(
          /^(complete|degraded|failed|partial|skipped)$/,
        );
        expect(firstResult.partition_total).toEqual(expect.any(Number));
      }
    });

    it("returns deterministic fixture-backed search, symbol, and entrypoint evidence", async () => {
      const initializedClient = await startInitializedClient(
        {},
        { fixtureName: "report-workspace" },
      );

      await initializedClient.callTool("lkg.index", { mode: "full" });

      const searchPayload = parseToolTextPayload<{
        results: Array<{
          path: string;
          snippet: string;
          source_type: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.search", {
          query: "report pipeline",
          topK: 5,
        }),
      );
      const symbolsPayload = parseToolTextPayload<{
        results: Array<{
          evidence: { path: string };
          kind: string;
          name: string;
          source_type: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.symbols", {
          query: "reportPipeline",
          source_type: "code",
        }),
      );
      const entrypointsPayload = parseToolTextPayload<{
        results: Array<{
          kind: string;
          name: string;
          path: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.entrypoints", {
          query: "run-report",
          kind: "script",
        }),
      );

      expect(
        searchPayload.results.slice(0, 2).map((result) => result.path),
      ).toEqual(expect.arrayContaining(["README.md", "src/report.ts"]));
      expect(
        searchPayload.results.some(
          (result) =>
            result.path === "README.md" &&
            result.source_type === "doc" &&
            result.snippet.includes("report pipeline"),
        ),
      ).toBe(true);
      expect(
        searchPayload.results.some(
          (result) =>
            result.path === "src/report.ts" &&
            result.source_type === "code" &&
            result.snippet.includes("report pipeline"),
        ),
      ).toBe(true);

      expect(symbolsPayload.results[0]).toMatchObject({
        evidence: { path: "src/report.ts" },
        kind: "function",
        name: "reportPipeline",
        source_type: "code",
      });

      expect(entrypointsPayload.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "script",
            name: "run-report",
            path: "package.json",
          }),
        ]),
      );
    });

    it("returns deterministic workspace structure evidence from docs, config, and code", async () => {
      const initializedClient = await startInitializedClient(
        {},
        { fixtureName: "mini-workspace" },
      );

      await initializedClient.callTool("lkg.index", { mode: "full" });

      const searchPayload = parseToolTextPayload<{
        results: Array<{
          path: string;
          snippet: string;
          source_type: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.search", {
          query: "workspaceLayout appsDir bootstrapApi",
          topK: 5,
        }),
      );
      const symbolsPayload = parseToolTextPayload<{
        results: Array<{
          evidence: { path: string };
          kind: string;
          name: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.symbols", {
          query: "bootstrapApi",
          source_type: "code",
        }),
      );
      const entrypointsPayload = parseToolTextPayload<{
        results: Array<{
          evidence: Array<{ path: string; source_type: string }>;
          kind: string;
          name: string;
          path: string;
        }>;
      }>(
        await initializedClient.callTool("lkg.entrypoints", {
          query: "nx",
          kind: "entrypoint",
        }),
      );

      expect(
        searchPayload.results.slice(0, 3).map((result) => result.path),
      ).toEqual(expect.arrayContaining(["README.md", "apps/api/main.ts"]));
      expect(
        searchPayload.results.some(
          (result) =>
            result.path === "README.md" &&
            result.source_type === "doc" &&
            result.snippet.includes("bootstrapApi"),
        ),
      ).toBe(true);
      expect(symbolsPayload.results[0]).toMatchObject({
        evidence: { path: "apps/api/main.ts" },
        kind: "function",
        name: "bootstrapApi",
      });

      expect(
        entrypointsPayload.results.some(
          (result) =>
            result.kind === "entrypoint" &&
            result.name === "nx" &&
            result.path === "nx.json" &&
            result.evidence.some((evidence) => evidence.path === "nx.json"),
        ),
      ).toBe(true);
    });

    it("returns post-index analysis tool payloads", async () => {
      const initializedClient = await startInitializedClient();

      await initializedClient.callTool("lkg.index", { mode: "full" });

      const entrypointsResult = await initializedClient.callTool(
        "lkg.entrypoints",
        {
          query: "main",
        },
      );
      const entrypointsPayload = parseToolTextPayload<{
        limitations?: Array<{ detail: string; kind: string }>;
        results: Array<{
          confidence: number;
          detection_reason: string;
          evidence: Array<{
            path: string;
            source_type: string;
          }>;
          kind: string;
          name: string;
          path: string;
          precision_tier: string;
        }>;
      }>(entrypointsResult);

      const flowResult = await initializedClient.callTool("lkg.flow", {
        from: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
          start_line: 1,
          end_line: 3,
        },
      });
      const flowPayload = parseToolTextPayload<{
        limitations?: Array<{ detail: string; kind: string }>;
        traces: Array<{
          completeness: string;
          precision_tier: string;
          segments: Array<{
            relation_kind: string;
            to: { name: string; path?: string };
          }>;
          start: { name: string };
        }>;
      }>(flowResult);

      const impactResult = await initializedClient.callTool("lkg.impact", {
        target: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
          start_line: 1,
          end_line: 3,
        },
      });
      const impactPayload = parseToolTextPayload<{
        impacts: Array<{
          classification: string;
          kind: string;
          precision_tier: string;
          reasons: Array<{ detail: string; relation_kind: string }>;
        }>;
        limitations?: Array<{ detail: string; kind: string }>;
        summary: {
          direct_count: number;
          possible_count: number;
          transitive_count: number;
          truncated: boolean;
        };
      }>(impactResult);

      const sliceResult = await initializedClient.callTool("lkg.slice", {
        criterion: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
          start_line: 1,
          end_line: 3,
        },
      });
      const slicePayload = parseToolTextPayload<{
        completeness: string;
        criterion: { name: string };
        items: Array<{
          inclusion_reason: string;
          precision_tier: string;
        }>;
        limitations?: Array<{ detail: string; kind: string }>;
      }>(sliceResult);

      expect(entrypointsResult.isError).not.toBe(true);
      expect(Array.isArray(entrypointsPayload.results)).toBe(true);
      expect(entrypointsPayload.limitations?.[0]?.detail).toContain(
        "Phase 1 entrypoint detection",
      );

      expect(flowResult.isError).not.toBe(true);
      expect(flowPayload.traces).toHaveLength(1);
      expect(flowPayload.traces[0]?.start.name).toBe("mcpFixtureEntry");
      expect(flowPayload.traces[0]?.precision_tier).toMatch(
        /^(derived|unknown)$/,
      );
      expect(Array.isArray(flowPayload.traces[0]?.segments)).toBe(true);
      expect(flowPayload.limitations?.[0]?.detail).toContain("analysis budget");

      expect(impactResult.isError).not.toBe(true);
      expect(impactPayload.summary.direct_count).toBeGreaterThanOrEqual(0);
      expect(impactPayload.summary.possible_count).toBeGreaterThanOrEqual(0);
      expect(impactPayload.limitations?.[0]?.detail).toMatch(
        /Phase 1 impact analysis|bounded derived-relation analysis/,
      );

      expect(sliceResult.isError).not.toBe(true);
      expect(slicePayload.criterion.name).toBe("mcpFixtureEntry");
      expect(slicePayload.completeness).toMatch(/^(partial|truncated)$/);
      expect(slicePayload.limitations?.[0]?.detail).toMatch(
        /Phase 1 slices|bounded derived-relation analysis/,
      );
    });

    it("returns an MCP tool error payload when analysis tools run before indexing", async () => {
      const initializedClient = await startInitializedClient();

      const entrypointsResult = await initializedClient.callTool(
        "lkg.entrypoints",
        {
          query: "main",
        },
      );
      const flowResult = await initializedClient.callTool("lkg.flow", {
        from: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
        },
      });
      const impactResult = await initializedClient.callTool("lkg.impact", {
        target: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
        },
      });
      const sliceResult = await initializedClient.callTool("lkg.slice", {
        criterion: {
          kind: "symbol",
          name: "mcpFixtureEntry",
          path: "main.ts",
          source_type: "code",
        },
      });

      expect(
        parseToolTextPayload<{ code: string }>(entrypointsResult).code,
      ).toBe("ANALYSIS_NOT_READY");
      expect(parseToolTextPayload<{ code: string }>(flowResult).code).toBe(
        "ANALYSIS_NOT_READY",
      );
      expect(parseToolTextPayload<{ code: string }>(impactResult).code).toBe(
        "ANALYSIS_NOT_READY",
      );
      expect(parseToolTextPayload<{ code: string }>(sliceResult).code).toBe(
        "ANALYSIS_NOT_READY",
      );
    });

    it("returns post-index candidate-first symbol payloads", async () => {
      const initializedClient = await startInitializedClient();

      await initializedClient.callTool("lkg.index", { mode: "full" });

      const listResult = await initializedClient.callTool("lkg.symbols", {
        path: "main.ts",
        query: "fixture",
        source_type: "code",
      });
      const listPayload = parseToolTextPayload<{
        results: Array<{
          container_name?: string;
          evidence: {
            code_location: {
              end_line: number;
              start_line: number;
            };
            content_hash: string;
            evidence_id: string;
            extractor: string;
            path: string;
          };
          index_run_id: string;
          kind: string;
          language: string | null;
          name: string;
          scope: string;
          signature?: string;
          source_type: string;
        }>;
      }>(listResult);
      const detailResult = await initializedClient.callTool("lkg.symbol", {
        path: "main.ts",
        symbol: "mcpFixtureEntry",
      });
      const detailPayload = parseToolTextPayload<{
        candidates: Array<{
          evidence: {
            code_location: {
              end_line: number;
              start_line: number;
            };
            content_hash: string;
            evidence_id: string;
            extractor: string;
            path: string;
          };
          index_run_id: string;
          kind: string;
          language: string | null;
          name: string;
          scope: string;
          source_type: string;
        }>;
      }>(detailResult);
      const firstListResult = listPayload.results[0];
      const firstDetailResult = detailPayload.candidates[0];

      expect(listResult.isError).not.toBe(true);
      expect(listPayload.results.length).toBeGreaterThan(0);
      expect(firstListResult?.name).toBe("mcpFixtureEntry");
      expect(firstListResult?.evidence.path).toBe("main.ts");
      expect(firstListResult?.evidence.code_location.start_line).toBe(1);
      expect(firstListResult?.evidence.extractor).toEqual(expect.any(String));
      expect(firstListResult?.index_run_id).toEqual(expect.any(String));
      expect(firstListResult?.source_type).toBe("code");

      expect(detailResult.isError).not.toBe(true);
      expect(detailPayload.candidates).toHaveLength(1);
      expect(firstDetailResult?.name).toBe("mcpFixtureEntry");
      expect(firstDetailResult?.evidence.path).toBe("main.ts");
      expect(
        firstDetailResult?.evidence.code_location.end_line,
      ).toBeGreaterThanOrEqual(1);
    });

    it("returns an MCP tool error payload for invalid lkg.symbol input", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.callTool("lkg.symbol", {
        path: "main.ts",
        symbol: "",
      });
      const content = result.content as Array<{ text?: string; type: string }>;

      expect(result.isError).toBe(true);
      expect(content[0]?.text).toContain("MCP error -32602");
    });
  });

  describe("input validation and index lifecycle", () => {
    it("runs lkg.index twice without regressing lifecycle state", async () => {
      const initializedClient = await startInitializedClient();

      const firstIndexPayload = parseToolTextPayload<{
        indexRunId: string;
        state: string;
      }>(await initializedClient.callTool("lkg.index", { mode: "full" }));

      const secondIndexPayload = parseToolTextPayload<{
        indexRunId: string;
        state: string;
      }>(
        await initializedClient.callTool("lkg.index", { mode: "incremental" }),
      );

      const statusPayload = parseToolTextPayload<{
        counters: {
          filesIndexed: number;
          filesTotal: number;
        };
        indexRunId: string | null;
        needsReindex: boolean;
        pendingChanges: boolean;
        state: string;
      }>(await initializedClient.callTool("lkg.status"));

      expect(firstIndexPayload.state).toBe("idle");
      expect(firstIndexPayload.indexRunId.length).toBeGreaterThan(0);
      expect(secondIndexPayload.state).toBe("idle");
      expect(secondIndexPayload.indexRunId.length).toBeGreaterThan(0);
      expect(secondIndexPayload.indexRunId).not.toBe(
        firstIndexPayload.indexRunId,
      );
      expect(statusPayload.state).toBe("idle");
      expect(statusPayload.needsReindex).toBe(false);
      expect(statusPayload.pendingChanges).toBe(false);
      expect(statusPayload.indexRunId).toBe(secondIndexPayload.indexRunId);
      expect(statusPayload.counters.filesTotal).toBeGreaterThan(0);
      expect(statusPayload.counters.filesIndexed).toBeGreaterThan(0);
    });

    it("returns an MCP tool error payload for invalid lkg.index input", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.callTool("lkg.index", {
        mode: "invalid-mode",
      });
      const content = result.content as Array<{ text?: string; type: string }>;

      expect(result.isError).toBe(true);
      expect(content[0]?.text).toContain("MCP error -32602");
    });
  });

  describe("logging modes", () => {
    it("preserves MCP tool contracts while writing lifecycle logs", async () => {
      const initializedClient = await startInitializedClient({
        LKG_LOG_MAX_SIZE_MB: "1",
        LKG_LOG_MODE: "file",
      });

      const payload = parseToolTextPayload<{
        acceptedAt: string;
        indexRunId: string;
        mode: string;
        state: string;
      }>(await initializedClient.callTool("lkg.index", { mode: "full" }));

      const logLines = readFileSync(initializedClient.runtime.logFile, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              event?: string;
              metadata?: Record<string, unknown>;
            },
        );

      expect(payload.acceptedAt).toEqual(expect.any(String));
      expect(payload.indexRunId).toEqual(expect.any(String));
      expect(payload.mode).toBe("full");
      expect(payload.state).toBe("idle");
      expect(logLines.some((entry) => entry.event === "process.startup")).toBe(
        true,
      );
      expect(
        logLines.some(
          (entry) =>
            entry.event === "index.accepted" &&
            entry.metadata?.indexRunId === payload.indexRunId,
        ),
      ).toBe(true);
      expect(
        logLines.some(
          (entry) =>
            entry.event === "index.completed" &&
            entry.metadata?.indexRunId === payload.indexRunId,
        ),
      ).toBe(true);
    });

    it("keeps MCP contracts unchanged when logging to stderr", async () => {
      const initializedClient = await startInitializedClient({
        LKG_LOG_MODE: "std",
      });

      const result = await initializedClient.callTool("lkg.index", {
        mode: "full",
      });
      const payload = parseToolTextPayload<{
        indexRunId: string;
        mode: string;
        state: string;
      }>(result);

      expect(result.isError).not.toBe(true);
      expect(payload.indexRunId).toEqual(expect.any(String));
      expect(payload.mode).toBe("full");
      expect(payload.state).toBe("idle");
      expect(initializedClient.stderrText).toContain(
        '"event":"index.accepted"',
      );
      expect(initializedClient.stderrText).toContain(
        '"event":"index.completed"',
      );
    });
  });
});
