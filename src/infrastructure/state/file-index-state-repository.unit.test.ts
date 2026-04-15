import { mkdtemp, readFile } from "node:fs/promises";
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
});
