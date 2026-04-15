import parcelWatcher, { type AsyncSubscription } from "@parcel/watcher";

import type { StatusSnapshot } from "../../application/dto/index-lifecycle.js";
import type { IndexStatePort } from "../../application/ports/index-state-port.js";
import type { IngestionPipelinePort } from "../../application/ports/ingestion-pipeline-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { RunIndexUseCase } from "../../application/use-cases/run-index-use-case.js";
import { ERROR_CODES } from "../../shared/errors/lkg-error.js";

const DEFAULT_DEBOUNCE_MS = 250;

export type IndexRunner = Pick<RunIndexUseCase, "execute">;

type WatchEvent = {
  path: string;
};

type WatchFactory = (
  cwd: string,
  callback: (error: Error | null, events: WatchEvent[]) => void,
) => Promise<AsyncSubscription>;

export function createWatcherIndexRunner(dependencies: {
  indexStatePort: IndexStatePort;
  ingestionPipeline: IngestionPipelinePort;
  logger: LoggerPort;
  statusContext: {
    activeProjectIdentity: string;
    configFingerprint: string;
    indexScope: StatusSnapshot["indexScope"];
    watcherState: StatusSnapshot["watcherState"];
  };
}): IndexRunner {
  return new RunIndexUseCase(
    dependencies.indexStatePort,
    dependencies.ingestionPipeline,
    dependencies.logger,
    dependencies.statusContext,
  );
}

export class IncrementalWatcherRuntime {
  private debounceTimer: NodeJS.Timeout | null = null;
  private followUpRequested = false;
  private running = false;
  private stopped = false;
  private readonly unsubscribePromise: Promise<AsyncSubscription>;

  constructor(
    private readonly options: {
      cwd: string;
      debounceMs?: number;
      indexRunner: IndexRunner;
      indexStatePort: IndexStatePort;
      logger: LoggerPort;
      statusContext: {
        activeProjectIdentity: string;
        indexScope: StatusSnapshot["indexScope"];
      };
      watchFactory?: WatchFactory;
    },
  ) {
    const watchFactory = this.options.watchFactory ?? defaultWatchFactory;
    this.unsubscribePromise = watchFactory(
      this.options.cwd,
      (error, events) => {
        if (error) {
          void this.markWatcherFailure(error.message);
          return;
        }

        if (this.stopped || events.length === 0) {
          return;
        }

        void this.handleChanges(events.map((event) => event.path));
      },
    );
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const subscription = await this.unsubscribePromise;
    await subscription.unsubscribe();
  }

  async notifyPathsChanged(paths: string[]): Promise<void> {
    if (this.stopped || paths.length === 0) {
      return;
    }

    await this.handleChanges(paths);
  }

  private async handleChanges(paths: string[]): Promise<void> {
    await this.options.indexStatePort.markWatcherPending({
      activeProjectIdentity: this.options.statusContext.activeProjectIdentity,
      indexScope: this.options.statusContext.indexScope,
    });

    this.options.logger.info("Watcher requested index run", {
      changedPaths: paths,
      event: "watcher.triggered",
      pathCount: paths.length,
    });

    this.scheduleRun();
  }

  private scheduleRun(): void {
    if (this.running) {
      this.followUpRequested = true;
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runIncrementalIndex();
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  private async runIncrementalIndex(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;

    try {
      await this.options.indexRunner.execute({ mode: "incremental" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected watcher error.";
      await this.markWatcherFailure(message);
      this.options.logger.error("Watcher incremental index run failed", {
        error: message,
      });
    } finally {
      this.running = false;
    }

    if (this.followUpRequested) {
      this.followUpRequested = false;
      this.scheduleRun();
    }
  }

  private async markWatcherFailure(message: string): Promise<void> {
    await this.options.indexStatePort.markWatcherFailed({
      activeProjectIdentity: this.options.statusContext.activeProjectIdentity,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message,
        occurredAt: new Date().toISOString(),
      },
      indexScope: this.options.statusContext.indexScope,
    });
  }
}

function defaultWatchFactory(
  cwd: string,
  callback: (error: Error | null, events: WatchEvent[]) => void,
): Promise<AsyncSubscription> {
  return parcelWatcher.subscribe(cwd, callback);
}
