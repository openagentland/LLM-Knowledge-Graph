import { describe, expect, it, vi } from "vitest";

import type { IndexStatePort } from "../../application/ports/index-state-port.js";
import { GetStatusUseCase } from "../../application/use-cases/get-status-use-case.js";

describe("GetStatusUseCase", () => {
  it("marks status as needing reindex when config fingerprint changes", async () => {
    const indexStatePort: IndexStatePort = {
      getRecord: vi.fn().mockResolvedValue({
        configFingerprint: "old-fingerprint",
        status: {
          activeProjectIdentity: "project-a",
          counters: {
            errors: 0,
            filesIndexed: 1,
            filesTotal: 1,
          },
          indexRunId: "run-1",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: "2026-05-03T00:00:00.000Z",
          needsReindex: false,
          pendingChanges: false,
          state: "idle",
          watcherState: "enabled",
        },
      }),
      getStatus: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      markRunning: vi.fn(),
      markWatcherFailed: vi.fn(),
      markWatcherPending: vi.fn(),
      saveProgress: vi.fn(),
      saveStatusSnapshot: vi.fn(),
    };

    const useCase = new GetStatusUseCase(indexStatePort, {
      activeProjectIdentity: "project-a",
      configFingerprint: "new-fingerprint",
      indexScope: "shared",
      watcherState: "enabled",
    });

    const status = await useCase.execute();

    expect(status.needsReindex).toBe(true);
  });

  it("clears stale errors when config fingerprint changes", async () => {
    const indexStatePort: IndexStatePort = {
      getRecord: vi.fn().mockResolvedValue({
        configFingerprint: "old-fingerprint",
        status: {
          activeProjectIdentity: "project-a",
          counters: {
            errors: 1,
            filesIndexed: 196,
            filesTotal: 197,
          },
          indexRunId: "run-1",
          indexScope: "shared",
          lastError: {
            code: "INTERNAL_ERROR",
            message: "package-lock.json failed",
            occurredAt: "2026-05-03T00:00:00.000Z",
          },
          lastIndexedAt: "2026-05-03T00:00:00.000Z",
          needsReindex: false,
          pendingChanges: false,
          state: "idle",
          watcherState: "enabled",
        },
      }),
      getStatus: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      markRunning: vi.fn(),
      markWatcherFailed: vi.fn(),
      markWatcherPending: vi.fn(),
      saveProgress: vi.fn(),
      saveStatusSnapshot: vi.fn(),
    };

    const useCase = new GetStatusUseCase(indexStatePort, {
      activeProjectIdentity: "project-a",
      configFingerprint: "new-fingerprint",
      indexScope: "shared",
      watcherState: "enabled",
    });

    const status = await useCase.execute();

    expect(status.counters).toEqual({
      errors: 0,
      filesIndexed: 196,
      filesTotal: 197,
    });
    expect(status.lastError).toBeNull();
    expect(status.needsReindex).toBe(true);
  });

  it("marks status as needing reindex when watcher has pending changes", async () => {
    const indexStatePort: IndexStatePort = {
      getRecord: vi.fn().mockResolvedValue({
        configFingerprint: "fingerprint-a",
        status: {
          activeProjectIdentity: "project-a",
          counters: {
            errors: 0,
            filesIndexed: 1,
            filesTotal: 1,
          },
          indexRunId: "run-2",
          indexScope: "shared",
          lastError: null,
          lastIndexedAt: "2026-05-03T00:00:00.000Z",
          needsReindex: false,
          pendingChanges: true,
          state: "idle",
          watcherState: "enabled",
        },
      }),
      getStatus: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      markRunning: vi.fn(),
      markWatcherFailed: vi.fn(),
      markWatcherPending: vi.fn(),
      saveProgress: vi.fn(),
      saveStatusSnapshot: vi.fn(),
    };

    const useCase = new GetStatusUseCase(indexStatePort, {
      activeProjectIdentity: "project-a",
      configFingerprint: "fingerprint-a",
      indexScope: "shared",
      watcherState: "enabled",
    });

    const status = await useCase.execute();

    expect(status.pendingChanges).toBe(true);
    expect(status.needsReindex).toBe(true);
  });
});
