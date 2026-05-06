import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  DaemonRequestHandler,
  DaemonRuntimePort,
} from "../application/daemon-request-handler.js";
import type {
  DaemonRequest,
  DaemonResponse,
} from "../application/dto/daemon.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { composeDaemonHandler, composeMainLogger } from "../compose.js";
import {
  DAEMON_LEASE_DURATION_MS,
  FileDaemonRegistry,
  isDaemonLeaseExpired,
} from "../infrastructure/daemon/file-daemon-registry.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

const DAEMON_HEARTBEAT_INTERVAL_MS = Math.floor(DAEMON_LEASE_DURATION_MS / 3);

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

type DaemonHeartbeatOptions = {
  activeProjectIdentity?: string;
  configFingerprint?: string;
  daemonId?: string;
  homeDir?: string;
  logger: LoggerPort;
  pid?: number;
  socketPath: string;
};

export async function startDaemon(): Promise<void> {
  const socketPath = process.env.LKG_DAEMON_SOCKET_PATH?.trim();
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error("LKG_DAEMON_SOCKET_PATH is required for daemon mode.");
  }

  const daemonId = process.env.LKG_DAEMON_ID?.trim();
  if (daemonId === undefined || daemonId.length === 0) {
    throw new Error("LKG_DAEMON_ID is required for daemon mode.");
  }

  const cwd = process.cwd();
  const { config, logger } = composeMainLogger({ cwd });
  const { handler, indexStatePort, runtime, statusContext } =
    composeDaemonHandler({ cwd, logger });

  await startDaemonServer({
    activeProjectIdentity: config.activeProjectIdentity,
    daemonId,
    handler,
    homeDir: config.homeDir,
    indexStatePort,
    logger,
    runtime,
    socketPath,
    statusContext,
  });
}

export async function startDaemonServer(options: {
  activeProjectIdentity?: string;
  daemonId?: string;
  handler: DaemonRequestHandler;
  homeDir?: string;
  indexStatePort?: {
    getStatus(identity: string, scope: string): Promise<unknown>;
  };
  logger: LoggerPort;
  runtime?: DaemonRuntimePort;
  socketPath: string;
  statusContext?: { activeProjectIdentity: string; indexScope: string };
}): Promise<void> {
  await prepareSocketPathForBind(options);

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

  const cleanupRuntimeArtifacts = createRuntimeArtifactCleanup(options);

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
    await cleanupRuntimeArtifacts();
    throw new Error(
      "LKG daemon failed its readiness check after binding the socket.",
    );
  }

  options.logger.info("Started LKG daemon server", {
    event: "daemon.ready",
    socketPath: options.socketPath,
  });

  if (options.indexStatePort && options.statusContext) {
    await options.indexStatePort.getStatus(
      options.statusContext.activeProjectIdentity,
      options.statusContext.indexScope,
    );
    options.logger.info("Daemon startup state recovery completed", {
      event: "daemon.startup_recovery",
    });
  }

  const heartbeat = createDaemonHeartbeat({
    activeProjectIdentity: options.activeProjectIdentity,
    daemonId: options.daemonId,
    homeDir: options.homeDir,
    logger: options.logger,
    pid: process.pid,
    socketPath: options.socketPath,
  });
  heartbeat.start();

  const shutdown = async (signal: string) => {
    heartbeat.stop();
    options.logger.info("Shutting down LKG daemon", {
      event: "daemon.shutdown",
      signal,
      socketPath: options.socketPath,
    });
    server.close();
    await options.runtime?.close();
    await cleanupRuntimeArtifacts();
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
    if (error instanceof LkgError) {
      logger.info("Daemon request returned structured error", {
        code: error.code,
        error: error.message,
        event: "daemon.request_rejected",
      });
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

    logger.error("Failed daemon request", {
      error: error instanceof Error ? error.message : String(error),
      event: "daemon.request_failed",
    });

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

function createDaemonHeartbeat(options: DaemonHeartbeatOptions): {
  start: () => void;
  stop: () => void;
} {
  const activeProjectIdentity = options.activeProjectIdentity;
  const daemonId = options.daemonId;
  if (
    options.homeDir === undefined ||
    activeProjectIdentity === undefined ||
    daemonId === undefined
  ) {
    return {
      start: () => undefined,
      stop: () => undefined,
    };
  }

  const registry = new FileDaemonRegistry({ homeDir: options.homeDir });
  let timer: NodeJS.Timeout | null = null;

  const renew = async () => {
    const renewed = await registry.renewLease(
      activeProjectIdentity,
      daemonId,
      options.socketPath,
      options.pid ?? process.pid,
    );
    if (!renewed) {
      options.logger.warn("Lost LKG daemon registry ownership", {
        activeProjectIdentity,
        daemonId,
        event: "daemon.lease_lost",
      });
      process.kill(process.pid, "SIGTERM");
    }
  };

  return {
    start: () => {
      timer = setInterval(() => {
        void renew();
      }, DAEMON_HEARTBEAT_INTERVAL_MS);
      timer.unref();
    },
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

async function prepareSocketPathForBind(options: {
  activeProjectIdentity?: string;
  daemonId?: string;
  homeDir?: string;
  socketPath: string;
}): Promise<void> {
  await mkdir(dirname(options.socketPath), { recursive: true });

  if (
    options.activeProjectIdentity === undefined ||
    options.daemonId === undefined ||
    options.homeDir === undefined
  ) {
    return;
  }

  const registry = new FileDaemonRegistry({ homeDir: options.homeDir });
  const registration = await registry.read(options.activeProjectIdentity);
  if (registration === null) {
    return;
  }

  if (registration.daemonId === options.daemonId) {
    await rm(options.socketPath, { force: true });
    return;
  }

  if (isDaemonLeaseExpired(registration)) {
    await rm(options.socketPath, { force: true });
    return;
  }

  throw new Error(
    `Another LKG daemon owns the socket for project ${options.activeProjectIdentity}.`,
  );
}

function createRuntimeArtifactCleanup(options: {
  activeProjectIdentity?: string;
  daemonId?: string;
  homeDir?: string;
  logger: LoggerPort;
  socketPath: string;
}): () => Promise<void> {
  const registry =
    options.homeDir === undefined || options.activeProjectIdentity === undefined
      ? null
      : new FileDaemonRegistry({ homeDir: options.homeDir });

  return async () => {
    if (registry !== null && options.activeProjectIdentity !== undefined) {
      const registration = await registry.read(options.activeProjectIdentity);
      const isOwner =
        options.daemonId !== undefined &&
        registration?.daemonId === options.daemonId;

      if (isOwner) {
        await registry.deleteIfOwned(
          options.activeProjectIdentity,
          options.daemonId!,
        );
        await rm(options.socketPath, { force: true });
      }

      return;
    }

    await rm(options.socketPath, { force: true });
  };
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
