import {
  appendFileSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";

import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { LkgConfig } from "../config/load-config.js";

export function createLogger(
  config: Pick<
    LkgConfig,
    "logFile" | "logLevel" | "logMaxBytes" | "logMaxFiles" | "logMode"
  >,
): LoggerPort {
  return new FileLogger(config, {});
}

type LogLevel = LkgConfig["logLevel"];

const LOG_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

class FileLogger implements LoggerPort {
  constructor(
    private readonly config: Pick<
      LkgConfig,
      "logFile" | "logLevel" | "logMaxBytes" | "logMaxFiles" | "logMode"
    >,
    private readonly bindings: Record<string, unknown>,
  ) {}

  child(bindings: Record<string, unknown>): LoggerPort {
    return new FileLogger(this.config, { ...this.bindings, ...bindings });
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write("debug", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.write("error", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write("warn", message, metadata);
  }

  private write(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (LOG_PRIORITIES[level] < LOG_PRIORITIES[this.config.logLevel]) {
      return;
    }

    const normalizedMetadata = metadata ?? {};
    const line = JSON.stringify({
      bindings: this.bindings,
      event: resolveEventName(message, normalizedMetadata),
      level,
      message,
      metadata: normalizedMetadata,
      timestamp: new Date().toISOString(),
    });

    if (this.config.logMode === "std") {
      process.stderr.write(`${line}\n`, "utf8");
      return;
    }

    try {
      this.rotateIfNeeded(line);
      appendFileSync(this.config.logFile, `${line}\n`, "utf8");
    } catch (error) {
      const fallbackLine = JSON.stringify({
        bindings: this.bindings,
        event: "runtime.warn",
        level: "warn",
        message: "Falling back to stderr after log file write failure",
        metadata: {
          error:
            error instanceof Error
              ? error.message
              : "Unknown log write failure",
          logFile: this.config.logFile,
          originalEvent: resolveEventName(message, normalizedMetadata),
          originalLevel: level,
          originalMessage: message,
        },
        timestamp: new Date().toISOString(),
      });
      process.stderr.write(`${fallbackLine}\n`, "utf8");
      process.stderr.write(`${line}\n`, "utf8");
    }
  }

  private rotateIfNeeded(nextLine: string): void {
    if (this.config.logMaxFiles < 1 || !existsSync(this.config.logFile)) {
      return;
    }

    const nextSize =
      statSync(this.config.logFile).size + Buffer.byteLength(nextLine) + 1;
    if (nextSize <= this.config.logMaxBytes) {
      return;
    }

    for (let index = this.config.logMaxFiles - 1; index >= 1; index -= 1) {
      const currentPath = `${this.config.logFile}.${index}`;
      const nextPath = `${this.config.logFile}.${index + 1}`;
      if (!existsSync(currentPath)) {
        continue;
      }

      if (index === this.config.logMaxFiles - 1) {
        unlinkSync(currentPath);
      } else {
        renameSync(currentPath, nextPath);
      }
    }

    renameSync(this.config.logFile, `${this.config.logFile}.1`);
  }
}

function resolveEventName(
  message: string,
  metadata: Record<string, unknown>,
): string {
  const event = metadata.event;
  if (typeof event === "string" && event.length > 0) {
    return event;
  }

  switch (message) {
    case "Starting MCP server":
      return "process.startup";
    case "Shutting down MCP server":
      return "process.shutdown";
    case "Received shutdown signal":
      return "process.signal";
    case "Watcher requested index run":
      return "watcher.triggered";
    case "Accepted index run":
      return "index.accepted";
    case "Completed index run":
      return "index.completed";
    case "Failed index run":
      return "index.failed";
    case "Falling back to stderr after log file write failure":
      return "runtime.warn";
    default:
      return levelFromMessage(message);
  }
}

function levelFromMessage(message: string): string {
  if (message.toLowerCase().includes("error")) {
    return "runtime.error";
  }

  return "runtime.warn";
}
