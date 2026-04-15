import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../../infrastructure/logging/create-logger.js";

describe("createLogger", () => {
  const stderrWrites: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  afterEach(() => {
    stderrWrites.length = 0;
    process.stderr.write = originalStderrWrite;
  });

  it("adds structured lifecycle events to file logs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lkg-logger-"));
    const logFile = join(tempDir, "lkg.log");
    const logger = createLogger({
      logFile,
      logLevel: "info",
      logMaxBytes: 2 * 1024 * 1024,
      logMaxFiles: 3,
      logMode: "file",
    }).child({ activeProjectIdentity: "project-a", indexScope: "shared" });

    logger.info("Accepted index run", {
      event: "index.accepted",
      indexMode: "full",
      indexRunId: "run-1",
      trigger: "manual",
      watcherState: "enabled",
    });

    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0] ?? "{}") as {
      bindings?: Record<string, unknown>;
      event?: string;
      metadata?: Record<string, unknown>;
    };

    expect(entry.event).toBe("index.accepted");
    expect(entry.bindings).toMatchObject({
      activeProjectIdentity: "project-a",
      indexScope: "shared",
    });
    expect(entry.metadata).toMatchObject({
      indexMode: "full",
      indexRunId: "run-1",
      trigger: "manual",
      watcherState: "enabled",
    });
  });

  it("rotates retained files when the log exceeds the configured max size", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lkg-logger-"));
    const logFile = join(tempDir, "lkg.log");
    const logger = createLogger({
      logFile,
      logLevel: "info",
      logMaxBytes: 160,
      logMaxFiles: 2,
      logMode: "file",
    });

    logger.info("first entry", {
      event: "runtime.warn",
      payload: "x".repeat(120),
    });
    logger.info("second entry", {
      event: "runtime.warn",
      payload: "y".repeat(120),
    });

    const activeLog = readFileSync(logFile, "utf8");
    const rotatedLog = readFileSync(`${logFile}.1`, "utf8");

    expect(activeLog).toContain("second entry");
    expect(rotatedLog).toContain("first entry");
  });

  it("falls back to stderr when file logging fails", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lkg-logger-"));
    const logFile = join(tempDir, "lkg.log");
    writeFileSync(logFile, "seed\n", "utf8");
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      );
      return true;
    };

    writeFileSync(logFile, "", { encoding: "utf8", mode: 0o444 });
    const impossiblePathLogger = createLogger({
      logFile: join(logFile, "child.log"),
      logLevel: "info",
      logMaxBytes: 2 * 1024 * 1024,
      logMaxFiles: 1,
      logMode: "file",
    });
    impossiblePathLogger.info("Accepted index run", {
      event: "index.accepted",
      indexRunId: "run-1",
    });

    expect(stderrWrites.join("")).toContain(
      "Falling back to stderr after log file write failure",
    );
    expect(stderrWrites.join("")).toContain("Accepted index run");
  });
});
