import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isHealthyMock, socketDaemonClientMock, spawnMock } = vi.hoisted(() => ({
  isHealthyMock: vi.fn(),
  socketDaemonClientMock: vi.fn(function SocketDaemonClientMock() {
    return {
      isHealthy: isHealthyMock,
    };
  }),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../../infrastructure/daemon/socket-daemon-client.js", () => ({
  SocketDaemonClient: socketDaemonClientMock,
}));

import { ensureDaemonRunning } from "../../infrastructure/daemon/ensure-daemon-running.js";
import type { LkgError } from "../../shared/errors/lkg-error.js";

describe("ensureDaemonRunning", () => {
  beforeEach(() => {
    isHealthyMock.mockReset();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({
      pid: 456,
      unref: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses an existing daemon only when the socket is healthy", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-daemon-registry-"));
    const expectedSocketPath = join(
      homeDir,
      "daemon",
      `${createHash("sha256").update("project-a").digest("hex").slice(0, 16)}.sock`,
    );
    const pathExists = vi.fn().mockResolvedValue(true);
    isHealthyMock.mockResolvedValue(true);
    await mkdir(join(homeDir, "daemon"), { recursive: true });
    await writeFile(expectedSocketPath, "", "utf8");
    await writeFile(
      join(homeDir, "daemon", "project-a.json"),
      `${JSON.stringify({
        configFingerprint: "fingerprint-a",
        pid: 123,
        socketPath: expectedSocketPath,
        startedAt: "2026-05-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const result = await ensureDaemonRunning({
      config: {
        activeProjectIdentity: "project-a",
        configFingerprint: "fingerprint-a",
        embeddingContextLength: null,
        embeddingDimension: null,
        embeddingModel: null,
        embeddingProvider: "llama_cpp",
        embeddingThreads: 1,
        homeDir,
        indexScope: "shared",
        inferenceThreads: 1,
        llamaCppModelDir: null,
        llamaCppUri: "preset:nomic-v1.5-q8",
        logFile: join(homeDir, "log.txt"),
        logLevel: "info",
        logMaxBytes: 1024,
        logMaxFiles: 5,
        logMode: "file",
        maxFileSizeBytes: 1024,
        resolvedLlamaCppModel: {
          contextLength: 2048,
          dimension: 768,
          preset: {
            contextLength: 2048,
            dimension: 768,
            downloadUrl: "https://example.com/model.gguf",
            filename: "model.gguf",
          },
          type: "preset",
        },
        vectorDbProvider: "lancedb",
        vectorDbUri: join(homeDir, "vectordb"),
        watcherState: "disabled",
      },
      cwd: "/repo/project",
      logger: createLogger(),
      pathExists,
    });

    expect(result.socketPath).toBe(expectedSocketPath);
    expect(pathExists).toHaveBeenCalledWith(expectedSocketPath);
    expect(isHealthyMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("replaces stale daemon state and starts a new daemon", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-daemon-registry-"));
    const socketPath = join(
      homeDir,
      "daemon",
      `${createHash("sha256").update("project-b").digest("hex").slice(0, 16)}.sock`,
    );
    const pathExists = vi.fn().mockResolvedValue(true);
    isHealthyMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await mkdir(join(homeDir, "daemon"), { recursive: true });
    await writeFile(socketPath, "", "utf8");
    await writeFile(
      join(homeDir, "daemon", "project-b.json"),
      `${JSON.stringify({
        configFingerprint: "fingerprint-b",
        pid: 123,
        socketPath,
        startedAt: "2026-05-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const result = await ensureDaemonRunning({
      config: {
        activeProjectIdentity: "project-b",
        configFingerprint: "fingerprint-b",
        embeddingContextLength: null,
        embeddingDimension: null,
        embeddingModel: null,
        embeddingProvider: "llama_cpp",
        embeddingThreads: 1,
        homeDir,
        indexScope: "shared",
        inferenceThreads: 1,
        llamaCppModelDir: null,
        llamaCppUri: "preset:nomic-v1.5-q8",
        logFile: join(homeDir, "log.txt"),
        logLevel: "info",
        logMaxBytes: 1024,
        logMaxFiles: 5,
        logMode: "file",
        maxFileSizeBytes: 1024,
        resolvedLlamaCppModel: {
          contextLength: 2048,
          dimension: 768,
          preset: {
            contextLength: 2048,
            dimension: 768,
            downloadUrl: "https://example.com/model.gguf",
            filename: "model.gguf",
          },
          type: "preset",
        },
        vectorDbProvider: "lancedb",
        vectorDbUri: join(homeDir, "vectordb"),
        watcherState: "disabled",
      },
      cwd: "/repo/project",
      logger: createLogger(),
      pathExists,
    });

    expect(result.socketPath).toBe(socketPath);
    expect(isHealthyMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    await expect(readFile(socketPath, "utf8")).rejects.toThrow();
    const daemonRegistration = JSON.parse(
      await readFile(join(homeDir, "daemon", "project-b.json"), "utf8"),
    ) as {
      configFingerprint: string;
      pid: number;
      socketPath: string;
    };

    expect(daemonRegistration).toMatchObject({
      configFingerprint: "fingerprint-b",
      pid: 456,
      socketPath,
    });
  });

  it("fails with an actionable timeout when daemon readiness never succeeds", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-daemon-registry-"));
    const socketPath = join(
      homeDir,
      "daemon",
      `${createHash("sha256").update("project-c").digest("hex").slice(0, 16)}.sock`,
    );
    isHealthyMock.mockResolvedValue(false);

    const promise = ensureDaemonRunning({
      config: {
        activeProjectIdentity: "project-c",
        configFingerprint: "fingerprint-c",
        embeddingContextLength: null,
        embeddingDimension: null,
        embeddingModel: null,
        embeddingProvider: "llama_cpp",
        embeddingThreads: 1,
        homeDir,
        indexScope: "shared",
        inferenceThreads: 1,
        llamaCppModelDir: null,
        llamaCppUri: "preset:nomic-v1.5-q8",
        logFile: join(homeDir, "log.txt"),
        logLevel: "info",
        logMaxBytes: 1024,
        logMaxFiles: 5,
        logMode: "file",
        maxFileSizeBytes: 1024,
        resolvedLlamaCppModel: {
          contextLength: 2048,
          dimension: 768,
          preset: {
            contextLength: 2048,
            dimension: 768,
            downloadUrl: "https://example.com/model.gguf",
            filename: "model.gguf",
          },
          type: "preset",
        },
        vectorDbProvider: "lancedb",
        vectorDbUri: join(homeDir, "vectordb"),
        watcherState: "disabled",
      },
      cwd: "/repo/project",
      logger: createLogger(),
      startupTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    await expect(promise).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: {
        socketPath,
        timeoutMs: 20,
      },
      message: "Timed out waiting for the LKG daemon to become ready.",
    } satisfies Partial<LkgError>);
  });
});

function createLogger() {
  const logger = {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}
