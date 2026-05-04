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
    options: { homeDir?: string } = {},
  ): Promise<McpStdioClient> {
    cwd = await materializeFixtureProject("mcp-basic");
    client = startMcpServer(envOverrides, { cwd, homeDir: options.homeDir });
    await client.initialize();
    return client;
  }

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  describe("initialize and tool discovery", () => {
    it("completes initialize handshake over stdio", async () => {
      cwd = await materializeFixtureProject("mcp-basic");
      client = startMcpServer({}, { cwd });

      const result = await client.initialize();

      expect(result.serverInfo.name).toBe("lkg");
      expect(result.serverInfo.version).toBe(packageJson.version);
      expect(result.capabilities).toHaveProperty("tools");
    });

    it("lists lkg.status, lkg.index, lkg.search, lkg.symbols, and lkg.symbol tools", async () => {
      const initializedClient = await startInitializedClient();

      const result = await initializedClient.listTools();
      const toolNames = result.tools.map((tool) => {
        const record = tool as { name?: string };
        return record.name;
      });

      expect(toolNames).toContain("lkg.status");
      expect(toolNames).toContain("lkg.index");
      expect(toolNames).toContain("lkg.search");
      expect(toolNames).toContain("lkg.symbols");
      expect(toolNames).toContain("lkg.symbol");
    });
  });

  describe("status and search contracts", () => {
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

    it("returns candidate-first symbol evidence after indexing", async () => {
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
      expect(firstDetailResult?.evidence.code_location.end_line).toBeGreaterThanOrEqual(1);
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

  describe("index lifecycle and validation", () => {
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
