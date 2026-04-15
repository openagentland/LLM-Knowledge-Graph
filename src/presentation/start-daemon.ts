import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { DaemonRequestHandler } from "../application/daemon-request-handler.js";
import type {
  DaemonRequest,
  DaemonResponse,
} from "../application/dto/daemon.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { composeDaemonHandler, composeMainLogger } from "../main.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

type DaemonWireResponse =
  | {
      ok: true;
      response: DaemonResponse;
    }
  | {
      error: {
        code: string;
        details?: Record<string, unknown>;
        message: string;
      };
      ok: false;
    };

export async function startDaemon(): Promise<void> {
  const socketPath = process.env.LKG_DAEMON_SOCKET_PATH?.trim();
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error("LKG_DAEMON_SOCKET_PATH is required for daemon mode.");
  }

  const cwd = process.cwd();
  const { logger } = composeMainLogger({ cwd });
  const handler = composeDaemonHandler({ cwd, logger });

  await startDaemonServer({
    handler,
    logger,
    socketPath,
  });
}

export async function startDaemonServer(options: {
  handler: DaemonRequestHandler;
  logger: LoggerPort;
  socketPath: string;
}): Promise<void> {
  await mkdir(dirname(options.socketPath), { recursive: true });
  await rm(options.socketPath, { force: true });

  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        return;
      }

      void handleLine(line, options.handler, socket, options.logger);
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  options.logger.info("Started LKG daemon server", {
    event: "daemon.listening",
    socketPath: options.socketPath,
  });

  const healthCheck = await options.handler.handle({ type: "health.check" });
  if (
    healthCheck.type !== "health.check" ||
    healthCheck.runtimeState !== "ready"
  ) {
    throw new Error(
      "LKG daemon failed its readiness check after binding the socket.",
    );
  }

  options.logger.info("Started LKG daemon server", {
    event: "daemon.ready",
    socketPath: options.socketPath,
  });

  const shutdown = async (signal: string) => {
    options.logger.info("Shutting down LKG daemon", {
      event: "daemon.shutdown",
      signal,
      socketPath: options.socketPath,
    });
    server.close();
    await options.handler.close();
    await rm(options.socketPath, { force: true });
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function handleLine(
  line: string,
  handler: DaemonRequestHandler,
  socket: NodeJS.WritableStream,
  logger: LoggerPort,
): Promise<void> {
  try {
    const request = JSON.parse(line) as DaemonRequest;
    const response = await handler.handle(request);
    writeResponse(socket, {
      ok: true,
      response,
    });
  } catch (error) {
    logger.error("Failed daemon request", {
      error: error instanceof Error ? error.message : String(error),
      event: "daemon.request_failed",
    });
    if (error instanceof LkgError) {
      writeResponse(socket, {
        error: {
          code: error.code,
          details: error.details,
          message: error.message,
        },
        ok: false,
      });
      return;
    }

    writeResponse(socket, {
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message:
          error instanceof Error ? error.message : "Unexpected daemon error.",
      },
      ok: false,
    });
  }
}

function writeResponse(
  socket: NodeJS.WritableStream,
  response: DaemonWireResponse,
): void {
  socket.write(`${JSON.stringify(response)}\n`, "utf8");
}

function wasExecutedDirectly(
  moduleUrl: string,
  argvPath: string | undefined,
): boolean {
  if (argvPath === undefined || argvPath.length === 0) {
    return false;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

if (wasExecutedDirectly(import.meta.url, process.argv[1])) {
  startDaemon().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "daemon.error",
        level: "error",
        message:
          error instanceof Error ? error.message : "Unexpected daemon error.",
        timestamp: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    process.exit(1);
  });
}
