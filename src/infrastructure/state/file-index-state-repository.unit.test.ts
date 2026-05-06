import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileIndexStateRepository } from "../../infrastructure/state/file-index-state-repository.js";

describe("FileIndexStateRepository", () => {
  it("persists state per project identity and scope", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.saveStatusSnapshot({
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-a",
      counters: {
        errors: 0,
        filesIndexed: 2,
        filesTotal: 4,
      },
      indexRunId: "run-1",
      indexScope: "shared",
      lastError: null,
      lastIndexedAt: "2026-05-03T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle",
      watcherState: "enabled",
    });

    const status = await repository.getStatus("project-a", "shared");
    const persisted = await readFile(
      join(homeDir, "state", "project-a", "shared.json"),
      "utf8",
    );

    expect(status?.indexRunId).toBe("run-1");
    expect(status?.pendingChanges).toBe(false);
    expect(JSON.parse(persisted)).toMatchObject({
      configFingerprint: "fingerprint-a",
      status: {
        activeProjectIdentity: "project-a",
        indexScope: "shared",
        pendingChanges: false,
      },
    });
  });

  it("marks watcher changes as pending and stale", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.markWatcherPending({
      activeProjectIdentity: "project-a",
      indexScope: "shared",
    });

    const status = await repository.getStatus("project-a", "shared");

    expect(status).toMatchObject({
      needsReindex: true,
      pendingChanges: true,
      state: "idle",
    });
  });

  it("allows exactly one concurrent lock holder per project scope", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    const [first, second] = await Promise.all([
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-a",
        indexScope: "shared",
      }),
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-b",
        indexScope: "shared",
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((lock) => lock === null)).toHaveLength(1);
  });

  it("reclaims expired run locks", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.acquireRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-a",
      indexScope: "shared",
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    const lock = await repository.acquireRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-b",
      indexScope: "shared",
      now: new Date("2026-05-05T00:31:00.000Z"),
    });

    expect(lock?.indexRunId).toBe("run-b");
  });

  it("releases only matching run locks", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.acquireRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-a",
      indexScope: "shared",
    });

    await repository.releaseRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-b",
      indexScope: "shared",
    });

    await expect(
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-c",
        indexScope: "shared",
      }),
    ).resolves.toBeNull();

    await repository.releaseRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-a",
      indexScope: "shared",
    });

    await expect(
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-c",
        indexScope: "shared",
      }),
    ).resolves.toMatchObject({ indexRunId: "run-c" });
  });

  it("renews run locks only for the owning run", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.acquireRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-a",
      indexScope: "shared",
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    const renewed = await repository.renewRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-a",
      indexScope: "shared",
      now: new Date("2026-05-05T00:10:00.000Z"),
    });
    const nonOwnerRenewal = await repository.renewRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "run-b",
      indexScope: "shared",
      now: new Date("2026-05-05T00:20:00.000Z"),
    });

    expect(renewed).toMatchObject({
      acquiredAt: "2026-05-05T00:00:00.000Z",
      indexRunId: "run-a",
      lastRenewedAt: "2026-05-05T00:10:00.000Z",
      leaseExpiresAt: "2026-05-05T00:40:00.000Z",
    });
    expect(nonOwnerRenewal).toBeNull();
    await expect(
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-c",
        indexScope: "shared",
        now: new Date("2026-05-05T00:31:00.000Z"),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-c",
        indexScope: "shared",
        now: new Date("2026-05-05T00:41:00.000Z"),
      }),
    ).resolves.toMatchObject({ indexRunId: "run-c" });
  });

  it("persists counters alongside progress updates", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.saveProgress({
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-a",
      counters: {
        errors: 1,
        filesIndexed: 2,
        filesTotal: 3,
      },
      indexRunId: "run-progress",
      indexScope: "shared",
      progress: {
        batchIndex: 1,
        batchTotal: 2,
        checkpointWrittenAt: "2026-05-05T00:00:00.000Z",
        chunksWritten: 4,
        filesProcessed: 2,
      },
    });

    const status = await repository.getStatus("project-a", "shared");

    expect(status).toMatchObject({
      counters: {
        errors: 1,
        filesIndexed: 2,
        filesTotal: 3,
      },
      indexRunId: "run-progress",
      progress: {
        batchIndex: 1,
        batchTotal: 2,
        checkpointWrittenAt: "2026-05-05T00:00:00.000Z",
        chunksWritten: 4,
        filesProcessed: 2,
      },
    });
  });

  it("recovers stale running status when the run lock is missing", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.saveStatusSnapshot({
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-a",
      counters: {
        errors: 0,
        filesIndexed: 1,
        filesTotal: 2,
      },
      indexRunId: "run-stale",
      indexScope: "shared",
      lastError: null,
      lastIndexedAt: "2026-05-05T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: true,
      state: "running",
      watcherState: "enabled",
    });

    const status = await repository.getStatus("project-a", "shared");

    expect(status).toMatchObject({
      indexRunId: "run-stale",
      lastError: {
        code: "INTERNAL_ERROR",
        message: "The previous index run lost its coordination state.",
      },
      lastIndexedAt: "2026-05-05T00:00:00.000Z",
      needsReindex: true,
      pendingChanges: true,
      state: "error",
    });
  });

  it("recovers malformed run locks as stale", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-state-"));
    const repository = new FileIndexStateRepository({ homeDir });
    await repository.acquireRunLock({
      activeProjectIdentity: "project-a",
      indexRunId: "bootstrap",
      indexScope: "shared",
    });
    await writeFile(
      join(homeDir, "state", "project-a", "shared.run.lock", "owner.json"),
      "not-json",
      "utf8",
    );

    await expect(
      repository.acquireRunLock({
        activeProjectIdentity: "project-a",
        indexRunId: "run-a",
        indexScope: "shared",
      }),
    ).resolves.toMatchObject({ indexRunId: "run-a" });
  });
});
