import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

type JsonArray = JsonValue[];

type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: JsonObject;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: JsonObject;
};

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number;
  result: JsonObject;
};

type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcMessage = JsonRpcSuccess | JsonRpcFailure;

type PendingRequest = {
  reject: (error: unknown) => void;
  resolve: (value: JsonObject) => void;
};

export type InitializeResult = {
  capabilities: JsonObject;
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
};

export class McpStdioClient {
  private buffer = "";
  private nextId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly stderrChunks: string[] = [];
  private readonly process: ChildProcessWithoutNullStreams;

  constructor(
    process: ChildProcessWithoutNullStreams,
    readonly runtime: {
      homeDir: string;
      logFile: string;
    },
  ) {
    this.process = process;

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drainMessages();
    });
    process.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
    process.on("exit", (code, signal) => {
      const suffix = this.stderrText ? `\n${this.stderrText}` : "";
      const error = new Error(
        `MCP server exited before all requests completed (code=${code}, signal=${signal})${suffix}`,
      );
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
    });
  }

  get stderrText(): string {
    return this.stderrChunks.join("");
  }

  async initialize(): Promise<InitializeResult> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "vitest-e2e",
        version: "0.0.0",
      },
      capabilities: {},
      protocolVersion: LATEST_PROTOCOL_VERSION,
    });

    this.notify("notifications/initialized");

    return result as InitializeResult;
  }

  async listTools(): Promise<{ tools: unknown[] }> {
    return this.request("tools/list") as Promise<{ tools: unknown[] }>;
  }

  async callTool(
    name: string,
    arguments_: JsonObject = {},
  ): Promise<JsonObject> {
    return this.request("tools/call", {
      name,
      arguments: arguments_,
    });
  }

  async request(method: string, params?: JsonObject): Promise<JsonObject> {
    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = new Promise<JsonObject>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.writeMessage(message);

    return response;
  }

  notify(method: string, params?: JsonObject): void {
    const message: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.writeMessage(message);
  }

  async close(): Promise<void> {
    if (this.process.exitCode !== null || this.process.killed) {
      return;
    }

    this.process.stdin.end();

    const exitPromise = once(this.process, "exit");
    const timeout = setTimeout(() => {
      this.process.kill("SIGTERM");
    }, 2_000);

    try {
      await exitPromise;
    } finally {
      clearTimeout(timeout);
    }
  }

  private drainMessages(): void {
    while (true) {
      const separatorIndex = this.buffer.indexOf("\n");
      if (separatorIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, separatorIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(separatorIndex + 1);

      if (!line) {
        continue;
      }

      const message = JSON.parse(line) as JsonRpcMessage;
      this.resolveMessage(message);
    }
  }

  private resolveMessage(message: JsonRpcMessage): void {
    if (!("id" in message) || typeof message.id !== "number") {
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);

    if ("error" in message) {
      pending.reject(
        new Error(
          `MCP request failed (${message.error.code}): ${message.error.message}`,
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private writeMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  }
}

export function startMcpServer(
  envOverrides: NodeJS.ProcessEnv = {},
  options: { cwd?: string; homeDir?: string } = {},
): McpStdioClient {
  const testsDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(testsDir, "../..");
  const serverEntrypoint = resolve(projectRoot, "src/main.ts");
  const lkgHome = options.homeDir ?? mkdtempSync(resolve(tmpdir(), "lkg-e2e-"));
  const logFile = resolve(lkgHome, "log.txt");
  const cwd = options.cwd ?? projectRoot;

  const serverProcess = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), serverEntrypoint],
    {
      cwd,
      env: {
        ...process.env,
        ...envOverrides,
        LKG_DISABLE_WATCHER: envOverrides.LKG_DISABLE_WATCHER ?? "true",
        LKG_HOME: lkgHome,
        LKG_LLAMA_CPP_MODEL_DIR:
          envOverrides.LKG_LLAMA_CPP_MODEL_DIR ??
          resolve(homedir(), ".lkg", "llm"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return new McpStdioClient(serverProcess, {
    homeDir: lkgHome,
    logFile,
  });
}
