import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, rm } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDaemonRegistration,
  FileDaemonRegistry,
  isDaemonLeaseExpired,
  type DaemonRegistration,
} from "./file-daemon-registry.js";
import { SocketDaemonClient } from "./socket-daemon-client.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { LkgConfig } from "../config/load-config.js";

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

  return registry.acquireStartupLock(
    options.config.activeProjectIdentity,
    async () => ensureDaemonRunningWithLock(options, registry),
  );
}

async function ensureDaemonRunningWithLock(
  options: {
    config: LkgConfig;
    cwd: string;
    logger: LoggerPort;
    pathExists?: (path: string) => Promise<boolean>;
    pollIntervalMs?: number;
    startupTimeoutMs?: number;
  },
  registry: FileDaemonRegistry,
): Promise<{ socketPath: string }> {
  const socketPath = registry.resolveSocketPath(
    options.config.activeProjectIdentity,
  );
  const existing = await registry.read(options.config.activeProjectIdentity);
  const pathExists = options.pathExists ?? exists;

  if (existing) {
    const existingSocketExists = await pathExists(existing.socketPath);
    const matchesCurrentSocket = existing.socketPath === socketPath;
    const matchesCurrentFingerprint =
      existing.configFingerprint === options.config.configFingerprint;

    const existingLeaseExpired = isDaemonLeaseExpired(existing);

    if (
      matchesCurrentFingerprint &&
      matchesCurrentSocket &&
      existingSocketExists &&
      !existingLeaseExpired
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

      await recoverStaleDaemon({
        activeProjectIdentity: options.config.activeProjectIdentity,
        allowProcessTermination: true,
        logger: options.logger,
        reason: "unhealthy_existing_registration",
        registration: existing,
        registry,
        socketPath: existing.socketPath,
      });
    } else {
      await recoverStaleDaemon({
        activeProjectIdentity: options.config.activeProjectIdentity,
        allowProcessTermination:
          existingLeaseExpired ||
          (matchesCurrentSocket &&
            matchesCurrentFingerprint &&
            !existingSocketExists),
        logger: options.logger,
        reason: existingLeaseExpired
          ? "expired_lease"
          : classifyExistingDaemonMismatch({
              existingSocketExists,
              matchesCurrentFingerprint,
              matchesCurrentSocket,
            }),
        registration: existing,
        registry,
        socketPath: existing.socketPath,
      });
    }
  }

  return startDaemonAndWait({
    config: options.config,
    cwd: options.cwd,
    logger: options.logger,
    registry,
    socketPath,
    startupTimeoutMs:
      options.startupTimeoutMs ?? options.config.daemonStartupTimeoutMs,
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
  const daemonId = randomUUID();
  const child = spawn(daemonCommand.command, daemonCommand.args, {
    cwd: options.cwd,
    detached: true,
    env: {
      ...process.env,
      LKG_ACTIVE_PROJECT_IDENTITY: options.config.activeProjectIdentity,
      LKG_CONFIG_FINGERPRINT: options.config.configFingerprint,
      LKG_DAEMON_ID: daemonId,
      LKG_DAEMON_SOCKET_PATH: options.socketPath,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.unref();

  const registration = createDaemonRegistration({
    configFingerprint: options.config.configFingerprint,
    daemonId,
    pid: child.pid ?? -1,
    socketPath: options.socketPath,
  });

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
      const published = await options.registry.read(
        options.config.activeProjectIdentity,
      );
      if (published?.daemonId !== registration.daemonId) {
        options.logger.info("Reused daemon published during startup wait", {
          activeProjectIdentity: options.config.activeProjectIdentity,
          event: "daemon.startup_converged",
          pid: published?.pid,
          socketPath: options.socketPath,
        });
        return { socketPath: published?.socketPath ?? options.socketPath };
      }

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

  await recoverStaleDaemon({
    activeProjectIdentity: options.config.activeProjectIdentity,
    allowProcessTermination: true,
    logger: options.logger,
    reason: "startup_timeout",
    registration,
    daemonId: registration.daemonId,
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

async function recoverStaleDaemon(options: {
  activeProjectIdentity: string;
  allowProcessTermination: boolean;
  daemonId?: string;
  logger: LoggerPort;
  reason: string;
  registration: DaemonRegistration | null;
  registry: FileDaemonRegistry;
  socketPath: string;
}): Promise<void> {
  const terminatedPid = terminateDaemonProcess({
    activeProjectIdentity: options.activeProjectIdentity,
    allowProcessTermination: options.allowProcessTermination,
    logger: options.logger,
    pid: options.registration?.pid,
    reason: options.reason,
  });

  await removeStaleDaemonState({
    activeProjectIdentity: options.activeProjectIdentity,
    daemonId: options.daemonId ?? options.registration?.daemonId,
    logger: options.logger,
    reason: options.reason,
    registry: options.registry,
    socketPath: options.socketPath,
    terminatedPid,
  });
}

function terminateDaemonProcess(options: {
  activeProjectIdentity: string;
  allowProcessTermination: boolean;
  logger: LoggerPort;
  pid: number | undefined;
  reason: string;
}): number | null {
  if (options.pid === undefined || options.pid <= 0) {
    return null;
  }

  if (!options.allowProcessTermination) {
    options.logger.info(
      "Skipped daemon process termination for unverified registration",
      {
        activeProjectIdentity: options.activeProjectIdentity,
        event: "daemon.process_termination_skipped",
        pid: options.pid,
        reason: options.reason,
      },
    );
    return null;
  }

  try {
    process.kill(options.pid, "SIGTERM");
    options.logger.warn("Terminated stale LKG daemon process", {
      activeProjectIdentity: options.activeProjectIdentity,
      event: "daemon.process_terminated",
      pid: options.pid,
      reason: options.reason,
    });
    return options.pid;
  } catch (error) {
    options.logger.warn("Failed to terminate stale LKG daemon process", {
      activeProjectIdentity: options.activeProjectIdentity,
      error: error instanceof Error ? error.message : String(error),
      event: "daemon.process_termination_failed",
      pid: options.pid,
      reason: options.reason,
    });
    return null;
  }
}

async function removeStaleDaemonState(options: {
  activeProjectIdentity: string;
  daemonId: string | undefined;
  logger: LoggerPort;
  reason: string;
  registry: FileDaemonRegistry;
  socketPath: string;
  terminatedPid: number | null;
}): Promise<void> {
  if (options.daemonId === undefined) {
    await options.registry.delete(options.activeProjectIdentity);
  } else {
    await options.registry.deleteIfOwned(
      options.activeProjectIdentity,
      options.daemonId,
    );
  }
  await safeRm(options.socketPath);
  const logMethod =
    options.reason === "missing_socket" ||
    options.reason === "socket_path_changed" ||
    options.reason === "config_changed"
      ? options.logger.info.bind(options.logger)
      : options.logger.warn.bind(options.logger);
  logMethod("Removed stale LKG daemon state", {
    activeProjectIdentity: options.activeProjectIdentity,
    event: "daemon.stale_recovered",
    pid: options.terminatedPid,
    reason: options.reason,
    socketPath: options.socketPath,
  });
}

function classifyExistingDaemonMismatch(options: {
  existingSocketExists: boolean;
  matchesCurrentFingerprint: boolean;
  matchesCurrentSocket: boolean;
}): string {
  if (!options.matchesCurrentFingerprint) {
    return "config_changed";
  }

  if (!options.matchesCurrentSocket) {
    return "socket_path_changed";
  }

  if (!options.existingSocketExists) {
    return "missing_socket";
  }

  return "stale_existing_registration";
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
