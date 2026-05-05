import { describe, expect, it, vi } from "vitest";

import type { StatusSnapshot } from "../../src/application/dto/index-lifecycle.js";
import { IncrementalWatcherRuntime } from "../../src/infrastructure/watcher/incremental-watcher-runtime.js";
import { ERROR_CODES } from "../../src/shared/errors/lkg-error.js";

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

type WatcherFailureInput = {
  activeProjectIdentity: string;
  error: NonNullable<StatusSnapshot["lastError"]>;
  indexScope: StatusSnapshot["indexScope"];
};

describe("Watcher runtime integration", () => {
  it("marks pending and debounces burst changes into one incremental run", async () => {
    let scheduledCallback: (() => void) | null = null;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();

    try {
      const markWatcherPending = vi.fn().mockResolvedValue({});
      const indexRunner = {
        execute: vi.fn().mockResolvedValue({
          acceptedAt: "2026-05-04T00:00:00.000Z",
          indexRunId: "run-1",
          mode: "incremental",
          state: "idle",
        }),
      };
      const runtime = new IncrementalWatcherRuntime({
        cwd: "/repo/project",
        debounceMs: 25,
        gitignore: "",
        indexRunner,
        indexStatePort: {
          getRecord: vi.fn(),
          getStatus: vi.fn(),
          markCompleted: vi.fn(),
          markFailed: vi.fn(),
          markRunning: vi.fn(),
          markWatcherFailed: vi.fn(),
          markWatcherPending,
          saveProgress: vi.fn(),
          saveStatusSnapshot: vi.fn(),
        },
        logger: createLogger(),
        statusContext: {
          activeProjectIdentity: "project-a",
          indexScope: "shared",
        },
        watchFactory: () =>
          Promise.resolve({
            unsubscribe: vi.fn().mockResolvedValue(undefined),
          }),
      });

      await runtime.notifyPathsChanged(["/repo/project/src/a.ts"]);
      await runtime.notifyPathsChanged(["/repo/project/src/b.ts"]);
      scheduledCallback?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(markWatcherPending).toHaveBeenCalledTimes(2);
      expect(indexRunner.execute).toHaveBeenCalledTimes(1);
      expect(indexRunner.execute).toHaveBeenCalledWith({ mode: "incremental" });

      await runtime.close();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  it("schedules a follow-up run when changes arrive during an active run", async () => {
    let scheduledCallback: (() => void) | null = null;
    let resolveRun: (() => void) | undefined;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();

    try {
      const indexRunner = {
        execute: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveRun = () =>
                resolve({
                  acceptedAt: "2026-05-04T00:00:00.000Z",
                  indexRunId: "run-2",
                  mode: "incremental",
                  state: "idle",
                });
            }),
        ),
      };
      const runtime = new IncrementalWatcherRuntime({
        cwd: "/repo/project",
        debounceMs: 25,
        gitignore: "",
        indexRunner,
        indexStatePort: {
          getRecord: vi.fn(),
          getStatus: vi.fn(),
          markCompleted: vi.fn(),
          markFailed: vi.fn(),
          markRunning: vi.fn(),
          markWatcherFailed: vi.fn(),
          markWatcherPending: vi.fn().mockResolvedValue({}),
          saveProgress: vi.fn(),
          saveStatusSnapshot: vi.fn(),
        },
        logger: createLogger(),
        statusContext: {
          activeProjectIdentity: "project-a",
          indexScope: "shared",
        },
        watchFactory: () =>
          Promise.resolve({
            unsubscribe: vi.fn().mockResolvedValue(undefined),
          }),
      });

      await runtime.notifyPathsChanged(["/repo/project/src/a.ts"]);
      scheduledCallback?.();
      await Promise.resolve();
      await runtime.notifyPathsChanged(["/repo/project/src/b.ts"]);
      resolveRun?.();
      await Promise.resolve();
      scheduledCallback?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(indexRunner.execute).toHaveBeenCalledTimes(2);

      await runtime.close();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  it("ignores watcher-only noise and does not schedule incremental work", async () => {
    let scheduledCallback: (() => void) | null = null;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();

    try {
      const markWatcherPending = vi.fn().mockResolvedValue({});
      const logger = createLogger();
      const indexRunner = {
        execute: vi.fn().mockResolvedValue({
          acceptedAt: "2026-05-04T00:00:00.000Z",
          indexRunId: "run-ignored",
          mode: "incremental",
          state: "idle",
        }),
      };
      const runtime = new IncrementalWatcherRuntime({
        cwd: "/repo/project",
        debounceMs: 25,
        gitignore: "",
        indexRunner,
        indexStatePort: {
          getRecord: vi.fn(),
          getStatus: vi.fn(),
          markCompleted: vi.fn(),
          markFailed: vi.fn(),
          markRunning: vi.fn(),
          markWatcherFailed: vi.fn(),
          markWatcherPending,
          saveProgress: vi.fn(),
          saveStatusSnapshot: vi.fn(),
        },
        logger,
        statusContext: {
          activeProjectIdentity: "project-a",
          indexScope: "shared",
        },
        watchFactory: () =>
          Promise.resolve({
            unsubscribe: vi.fn().mockResolvedValue(undefined),
          }),
      });

      await runtime.notifyPathsChanged([
        "/repo/project/.git/FETCH_HEAD",
        "/repo/project/.git/index.lock",
        "/repo/project/.claude/plan-4.1.md",
      ]);

      expect(markWatcherPending).not.toHaveBeenCalled();
      expect(indexRunner.execute).not.toHaveBeenCalled();
      expect(scheduledCallback).toBeNull();
      expect(logger.info).not.toHaveBeenCalledWith(
        "Watcher requested index run",
        expect.anything(),
      );

      await runtime.close();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  it("keeps relevant source changes after filtering ignored noise", async () => {
    let scheduledCallback: (() => void) | null = null;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();

    try {
      const markWatcherPending = vi.fn().mockResolvedValue({});
      const logger = createLogger();
      const indexRunner = {
        execute: vi.fn().mockResolvedValue({
          acceptedAt: "2026-05-04T00:00:00.000Z",
          indexRunId: "run-mixed",
          mode: "incremental",
          state: "idle",
        }),
      };
      const runtime = new IncrementalWatcherRuntime({
        cwd: "/repo/project",
        debounceMs: 25,
        gitignore: "",
        indexRunner,
        indexStatePort: {
          getRecord: vi.fn(),
          getStatus: vi.fn(),
          markCompleted: vi.fn(),
          markFailed: vi.fn(),
          markRunning: vi.fn(),
          markWatcherFailed: vi.fn(),
          markWatcherPending,
          saveProgress: vi.fn(),
          saveStatusSnapshot: vi.fn(),
        },
        logger,
        statusContext: {
          activeProjectIdentity: "project-a",
          indexScope: "shared",
        },
        watchFactory: () =>
          Promise.resolve({
            unsubscribe: vi.fn().mockResolvedValue(undefined),
          }),
      });

      await runtime.notifyPathsChanged([
        "/repo/project/.git/FETCH_HEAD",
        "/repo/project/src/a.ts",
        "/repo/project/.claude/plan-4.1.md",
      ]);
      scheduledCallback?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(markWatcherPending).toHaveBeenCalledTimes(1);
      expect(indexRunner.execute).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith("Watcher requested index run", {
        changedPaths: ["src/a.ts"],
        event: "watcher.triggered",
        pathCount: 1,
      });

      await runtime.close();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  it("marks watcher failures as fail-soft and observable", async () => {
    let scheduledCallback: (() => void) | null = null;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = vi.fn(((callback: () => void) => {
      scheduledCallback = callback;
      return { token: "timeout" } as unknown as NodeJS.Timeout;
    }) as typeof global.setTimeout);
    global.clearTimeout = vi.fn();

    try {
      const markWatcherFailed = vi.fn().mockResolvedValue({});
      const logger = createLogger();
      const runtime = new IncrementalWatcherRuntime({
        cwd: "/repo/project",
        debounceMs: 25,
        gitignore: "",
        indexRunner: {
          execute: vi.fn().mockRejectedValue(new Error("boom")),
        },
        indexStatePort: {
          getRecord: vi.fn(),
          getStatus: vi.fn(),
          markCompleted: vi.fn(),
          markFailed: vi.fn(),
          markRunning: vi.fn(),
          markWatcherFailed,
          markWatcherPending: vi.fn().mockResolvedValue({}),
          saveProgress: vi.fn(),
          saveStatusSnapshot: vi.fn(),
        },
        logger,
        statusContext: {
          activeProjectIdentity: "project-a",
          indexScope: "shared",
        },
        watchFactory: () =>
          Promise.resolve({
            unsubscribe: vi.fn().mockResolvedValue(undefined),
          }),
      });

      await runtime.notifyPathsChanged(["/repo/project/src/a.ts"]);
      scheduledCallback?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(markWatcherFailed).toHaveBeenCalledTimes(1);
      const [watcherFailureArg] = markWatcherFailed.mock.calls[0] as [
        WatcherFailureInput,
      ];
      expect(watcherFailureArg.activeProjectIdentity).toBe("project-a");
      expect(watcherFailureArg.indexScope).toBe("shared");
      expect(watcherFailureArg.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(watcherFailureArg.error.message).toBe("boom");
      expect(logger.error).toHaveBeenCalledWith(
        "Watcher incremental index run failed",
        expect.objectContaining({ error: "boom" }),
      );

      await runtime.close();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});
