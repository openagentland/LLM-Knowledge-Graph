import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  DaemonRequest,
  DaemonResponse,
} from "../../application/dto/daemon.js";
import { SocketDaemonClient } from "../../infrastructure/daemon/socket-daemon-client.js";

let socketPath = "";

describe("SocketDaemonClient", () => {
  let server: ReturnType<typeof createServer> | undefined;

  beforeEach(async () => {
    socketPath = join(
      mkdtempSync(join(tmpdir(), "lkg-daemon-client-")),
      "socket.sock",
    );
    server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        const request = JSON.parse(chunk.trim()) as DaemonRequest;
        const response: DaemonResponse =
          request.type === "health.check"
            ? {
                runtimeState: "ready",
                type: "health.check",
              }
            : request.type === "status"
              ? {
                  status: {
                    activeProjectIdentity: "project-a",
                    counters: { errors: 0, filesIndexed: 0, filesTotal: 0 },
                    daemonState: "ready",
                    indexRunId: null,
                    indexScope: "shared",
                    lastError: null,
                    lastIndexedAt: null,
                    needsReindex: true,
                    pendingChanges: false,
                    runtimeState: "ready",
                    state: "idle",
                    watcherState: "disabled",
                  },
                  type: "status",
                }
              : {
                  result: {
                    acceptedAt: "2026-05-03T00:00:00.000Z",
                    indexRunId: "run-1",
                    mode: "full",
                    state: "idle",
                  },
                  type: "index.start",
                };
        socket.write(`${JSON.stringify({ ok: true, response })}\n`, "utf8");
      });
    });

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(socketPath, () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    if (socketPath) {
      rmSync(socketPath, { force: true });
      rmSync(dirname(socketPath), { force: true, recursive: true });
    }
    server = undefined;
  });

  it("reads newline-delimited daemon responses", async () => {
    const client = new SocketDaemonClient({ socketPath });

    const result = await client.request<
      Extract<DaemonResponse, { type: "status" }>
    >({
      type: "status",
    });

    expect(result.type).toBe("status");
    expect(result.status.daemonState).toBe("ready");
  });

  it("reports daemon health from the readiness probe", async () => {
    const client = new SocketDaemonClient({ socketPath });

    await expect(client.isHealthy()).resolves.toBe(true);
  });
});
