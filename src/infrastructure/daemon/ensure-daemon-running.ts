import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, rm } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FileDaemonRegistry,
  type DaemonRegistration,
} from "./file-daemon-registry.js";
import { SocketDaemonClient } from "./socket-daemon-client.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { LkgConfig } from "../config/load-config.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export async function ensureDaemonRunning(options: {
  config: LkgConfig;
  cwd: string;
  logger: LoggerPort;
  pathExists?: (path: string) => Promise<boolean>;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
}): Promise<{ socketPath: string }> {
  const registry = new FileDaemonRegistry({ homeDir: options.config.homeDir });
  const socketPath = registry.resolveSocketPath(
    options.config.activeProjectIdentity,
  );
  const existing = await registry.read(options.config.activeProjectIdentity);
  const pathExists = options.pathExists ?? exists;

  if (
    existing &&
    existing.configFingerprint === options.config.configFingerprint &&
    existing.socketPath === socketPath &&
    (await pathExists(socketPath))
  ) {
    const daemonClient = new SocketDaemonClient({ socketPath });
    if (await daemonClient.isHealthy()) {
      options.logger.info("Reused healthy LKG daemon", {
        activeProjectIdentity: options.config.activeProjectIdentity,
        event: "daemon.reused",
        pid: existing.pid,
        socketPath,
      });
      return { socketPath };
    }

    await removeStaleDaemonState({
      activeProjectIdentity: options.config.activeProjectIdentity,
      logger: options.logger,
      registry,
      socketPath,
    });
  }

  return startDaemonAndWait({
    config: options.config,
    cwd: options.cwd,
    logger: options.logger,
    registry,
    socketPath,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  });
}

async function startDaemonAndWait(options: {
  config: LkgConfig;
  cwd: string;
  logger: LoggerPort;
  registry: FileDaemonRegistry;
  socketPath: string;
  pollIntervalMs: number;
  startupTimeoutMs: number;
}): Promise<{ socketPath: string }> {
  const daemonCommand = resolveDaemonCommand();
  const child = spawn(daemonCommand.command, daemonCommand.args, {
    cwd: options.cwd,
    detached: true,
    env: {
      ...process.env,
      LKG_ACTIVE_PROJECT_IDENTITY: options.config.activeProjectIdentity,
      LKG_CONFIG_FINGERPRINT: options.config.configFingerprint,
      LKG_DAEMON_SOCKET_PATH: options.socketPath,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.unref();

  const registration: DaemonRegistration = {
    configFingerprint: options.config.configFingerprint,
    pid: child.pid ?? -1,
    socketPath: options.socketPath,
    startedAt: new Date().toISOString(),
  };

  await options.registry.write(
    options.config.activeProjectIdentity,
    registration,
  );

  options.logger.info("Started LKG daemon", {
    activeProjectIdentity: options.config.activeProjectIdentity,
    event: "daemon.started",
    pid: child.pid ?? -1,
    socketPath: options.socketPath,
  });

  const daemonClient = new SocketDaemonClient({
    socketPath: options.socketPath,
  });
  const deadline = Date.now() + options.startupTimeoutMs;

  while (Date.now() < deadline) {
    if (await daemonClient.isHealthy()) {
      options.logger.info("Confirmed LKG daemon readiness", {
        activeProjectIdentity: options.config.activeProjectIdentity,
        event: "daemon.ready_confirmed",
        pid: child.pid ?? -1,
        socketPath: options.socketPath,
      });
      return { socketPath: options.socketPath };
    }

    await wait(options.pollIntervalMs);
  }

  await removeStaleDaemonState({
    activeProjectIdentity: options.config.activeProjectIdentity,
    logger: options.logger,
    registry: options.registry,
    socketPath: options.socketPath,
  });

  throw new LkgError(
    ERROR_CODES.INTERNAL_ERROR,
    "Timed out waiting for the LKG daemon to become ready.",
    {
      socketPath: options.socketPath,
      timeoutMs: options.startupTimeoutMs,
    },
  );
}

async function removeStaleDaemonState(options: {
  activeProjectIdentity: string;
  logger: LoggerPort;
  registry: FileDaemonRegistry;
  socketPath: string;
}): Promise<void> {
  await options.registry.delete(options.activeProjectIdentity);
  await safeRm(options.socketPath);
  options.logger.warn("Removed stale LKG daemon state", {
    activeProjectIdentity: options.activeProjectIdentity,
    event: "daemon.stale_recovered",
    socketPath: options.socketPath,
  });
}

function resolveDaemonCommand(): { args: string[]; command: string } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = extname(currentFilePath);
  const projectRoot = resolve(dirname(currentFilePath), "../../..");

  if (extension === ".ts") {
    return {
      args: [
        resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"),
        resolve(projectRoot, "src/presentation/start-daemon.ts"),
      ],
      command: process.execPath,
    };
  }

  return {
    args: [resolve(projectRoot, "dist/presentation/start-daemon.js")],
    command: process.execPath,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeRm(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    return;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
