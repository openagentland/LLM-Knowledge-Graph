import { describe, expect, it } from "vitest";

import type { LoggerPort } from "../../src/application/ports/logger-port.js";
import { GetStatusUseCase } from "../../src/application/use-cases/get-status-use-case.js";
import { RunIndexUseCase } from "../../src/application/use-cases/run-index-use-case.js";
import { loadConfig } from "../../src/infrastructure/config/load-config.js";
import { FileIndexStateRepository } from "../../src/infrastructure/state/file-index-state-repository.js";
import {
  createIntegrationPipeline,
  createTempHomeDir,
  readStatusRecord,
  TEST_SCOPE,
} from "../helpers/integration-runtime.js";
import { materializeFixtureProject } from "../helpers/materialize-fixture-project.js";

function createStatusContext(
  overrides: Partial<{
    activeProjectIdentity: string;
    configFingerprint: string;
    indexScope: "shared" | "branch";
    watcherState: "enabled" | "disabled";
  }> = {},
) {
  return {
    activeProjectIdentity: TEST_SCOPE.activeProjectIdentity,
    configFingerprint: "fingerprint-a",
    indexScope: TEST_SCOPE.indexScope,
    watcherState: "disabled" as const,
    ...overrides,
  };
}

function createTestLogger(): LoggerPort {
  return {
    child: () => ({
      child: () => {
        throw new Error("not used");
      },
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    }),
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  };
}

describe("Status freshness integration", () => {
  it("reports needsReindex before first index and clears it after a successful run", async () => {
    const cwd = await materializeFixtureProject("ingestion-basic");
    const homeDir = await createTempHomeDir("lkg-status-");
    const repository = new FileIndexStateRepository({ homeDir });
    const context = createStatusContext();

    const before = await new GetStatusUseCase(repository, context).execute();
    await new RunIndexUseCase(
      repository,
      createIntegrationPipeline(cwd, homeDir),
      createTestLogger(),
      context,
    ).execute({ mode: "full" });
    const after = await new GetStatusUseCase(repository, context).execute();

    expect(before.needsReindex).toBe(true);
    expect(before.state).toBe("idle");
    expect(after.needsReindex).toBe(false);
    expect(after.state).toBe("idle");
    expect(after.lastIndexedAt).toEqual(expect.any(String));
  });

  it("marks status stale when config fingerprint changes", async () => {
    const cwd = await materializeFixtureProject("ingestion-basic");
    const homeDir = await createTempHomeDir("lkg-status-");
    const repository = new FileIndexStateRepository({ homeDir });
    const baseContext = createStatusContext({
      configFingerprint: "fingerprint-a",
    });

    await new RunIndexUseCase(
      repository,
      createIntegrationPipeline(cwd, homeDir),
      createTestLogger(),
      baseContext,
    ).execute({ mode: "full" });

    const status = await new GetStatusUseCase(
      repository,
      createStatusContext({ configFingerprint: "fingerprint-b" }),
    ).execute();

    expect(status.needsReindex).toBe(true);
    expect(status.indexRunId).toEqual(expect.any(String));
  });

  it("scopes persisted state to active project identity and index scope", async () => {
    const homeDir = await createTempHomeDir("lkg-status-");
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.saveStatusSnapshot({
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-a",
      counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
      indexRunId: "run-a",
      indexScope: "shared",
      lastError: null,
      lastIndexedAt: "2026-05-04T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle",
      watcherState: "disabled",
    });
    await repository.saveStatusSnapshot({
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-b",
      counters: { errors: 0, filesIndexed: 2, filesTotal: 2 },
      indexRunId: "run-b",
      indexScope: "branch",
      lastError: null,
      lastIndexedAt: "2026-05-04T01:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle",
      watcherState: "disabled",
    });

    const sharedStatus = await repository.getStatus("project-a", "shared");
    const branchStatus = await repository.getStatus("project-a", "branch");

    expect(sharedStatus?.indexRunId).toBe("run-a");
    expect(branchStatus?.indexRunId).toBe("run-b");
    expect(sharedStatus?.counters.filesIndexed).toBe(1);
    expect(branchStatus?.counters.filesIndexed).toBe(2);
  });

  it("lets project id override branch-aware identity", () => {
    const config = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_BRANCH_AWARE: "true",
        LKG_PROJECT_ID: "shared-identity",
      },
      gitBranch: "feature/test-branch",
    });

    expect(config.activeProjectIdentity).toBe("shared-identity");
    expect(config.indexScope).toBe("shared");
  });

  it("persists the active scope record shape used by status", async () => {
    const homeDir = await createTempHomeDir("lkg-status-");
    const repository = new FileIndexStateRepository({ homeDir });

    await repository.saveStatusSnapshot({
      activeProjectIdentity: TEST_SCOPE.activeProjectIdentity,
      configFingerprint: "fingerprint-a",
      counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
      indexRunId: "run-1",
      indexScope: TEST_SCOPE.indexScope,
      lastError: null,
      lastIndexedAt: "2026-05-04T00:00:00.000Z",
      needsReindex: false,
      pendingChanges: false,
      state: "idle",
      watcherState: "disabled",
    });

    const record = await readStatusRecord(homeDir);

    expect(record.configFingerprint).toBe("fingerprint-a");
    expect(record.status).toMatchObject({
      activeProjectIdentity: TEST_SCOPE.activeProjectIdentity,
      indexScope: TEST_SCOPE.indexScope,
    });
  });
});
