import type { LoggerPort } from "../../application/ports/logger-port.js";

export function installProcessHandlers(
  logger: LoggerPort,
  shutdown: (signal: string) => void,
): void {
  process.on("unhandledRejection", (reason) => {
    logger.warn("Unhandled promise rejection", {
      event: "runtime.warn",
      reason: serializeUnknown(reason),
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      error: serializeUnknown(error),
      event: "runtime.error",
    });
    process.exit(1);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.stdin.on("end", () => shutdown("stdin EOF"));
  process.stdin.on("error", () => shutdown("stdin error"));
  process.stdin.on("close", () => shutdown("stdin close"));
}

function serializeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}
