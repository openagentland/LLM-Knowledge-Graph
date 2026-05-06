import { randomUUID } from "node:crypto";

import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type {
  RunIndexCommand,
  RunIndexResult,
  StatusSnapshot,
} from "../dto/index-lifecycle.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { IngestionPipelinePort } from "../ports/ingestion-pipeline-port.js";
import type { LoggerPort } from "../ports/logger-port.js";

const INDEX_RUN_LOCK_RENEW_INTERVAL_MS = 10 * 60 * 1000;

export class RunIndexUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly ingestionPipeline: IngestionPipelinePort,
    private readonly logger: LoggerPort,
    private readonly context: {
      activeProjectIdentity: string;
      configFingerprint: string;
      indexScope: StatusSnapshot["indexScope"];
      watcherState: StatusSnapshot["watcherState"];
    },
  ) {}

  async execute(command: RunIndexCommand): Promise<RunIndexResult> {
    const requestedAt = new Date().toISOString();
    const indexRunId = randomUUID();
    await this.acquireRunLock(indexRunId);

    try {
      const lockRenewal = this.createLockRenewal(indexRunId);
      const existingStatus = await this.indexStatePort.getStatus(
        this.context.activeProjectIdentity,
        this.context.indexScope,
      );

      await this.indexStatePort.saveStatusSnapshot({
        activeProjectIdentity: this.context.activeProjectIdentity,
        configFingerprint: this.context.configFingerprint,
        counters: existingStatus?.counters ?? {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        indexRunId: existingStatus?.indexRunId ?? null,
        indexScope: this.context.indexScope,
        lastError: existingStatus?.lastError ?? null,
        lastIndexedAt: existingStatus?.lastIndexedAt ?? null,
        needsReindex: existingStatus?.needsReindex ?? true,
        pendingChanges: existingStatus?.pendingChanges ?? false,
        state: existingStatus?.state ?? "idle",
        watcherState: this.context.watcherState,
      });

      const { status } = await this.indexStatePort.markRunning({
        activeProjectIdentity: this.context.activeProjectIdentity,
        indexRunId,
        indexScope: this.context.indexScope,
        mode: command.mode,
        requestedAt,
      });

      this.logger.info("Accepted index run", {
        activeProjectIdentity: this.context.activeProjectIdentity,
        event: "index.accepted",
        indexRunId,
        indexMode: command.mode,
        indexScope: this.context.indexScope,
        trigger: "manual",
        watcherState: this.context.watcherState,
      });

      await this.indexStatePort.saveStatusSnapshot({
        ...status,
        configFingerprint: this.context.configFingerprint,
        indexRunId,
        needsReindex: false,
        pendingChanges: false,
      });

      let completed = false;
      try {
        lockRenewal.start();
        const summary = await this.ingestionPipeline.run({
          indexRunId,
          mode: command.mode,
          onProgress: async (progress, counters) => {
            await this.indexStatePort.saveProgress({
              activeProjectIdentity: this.context.activeProjectIdentity,
              configFingerprint: this.context.configFingerprint,
              counters,
              indexRunId,
              indexScope: this.context.indexScope,
              progress,
            });
          },
        });
        await lockRenewal.assertOwned();
        await this.indexStatePort.markCompleted({
          activeProjectIdentity: this.context.activeProjectIdentity,
          completedAt: new Date().toISOString(),
          counters: summary.counters,
          indexRunId,
          indexScope: this.context.indexScope,
        });

        await this.indexStatePort.saveProgress({
          activeProjectIdentity: this.context.activeProjectIdentity,
          configFingerprint: this.context.configFingerprint,
          counters: summary.counters,
          indexRunId,
          indexScope: this.context.indexScope,
          progress: summary.progress,
        });

        this.logger.info("Completed index run", {
          activeProjectIdentity: this.context.activeProjectIdentity,
          chunksEmbedded: summary.chunksEmbedded,
          chunksPurged: summary.chunksPurged,
          chunksWritten: summary.chunksWritten,
          errors: summary.counters.errors,
          event: "index.completed",
          filesIndexed: summary.counters.filesIndexed,
          filesPurged: summary.filesPurged,
          filesTotal: summary.counters.filesTotal,
          filesUnchanged: summary.filesUnchanged,
          batchIndex: summary.progress.batchIndex,
          batchTotal: summary.progress.batchTotal,
          checkpointWrittenAt: summary.progress.checkpointWrittenAt,
          indexMode: command.mode,
          indexRunId,
          indexScope: this.context.indexScope,
          trigger: "manual",
          watcherState: this.context.watcherState,
        });
        completed = true;
      } catch (error) {
        lockRenewal.stop();
        const occurredAt = new Date().toISOString();
        const message =
          error instanceof Error ? error.message : "Unexpected internal error.";

        await this.indexStatePort.markFailed({
          activeProjectIdentity: this.context.activeProjectIdentity,
          counters: {
            errors: 1,
            filesIndexed: 0,
            filesTotal: 0,
          },
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message,
            occurredAt,
          },
          indexRunId,
          indexScope: this.context.indexScope,
        });

        this.logger.error("Failed index run", {
          activeProjectIdentity: this.context.activeProjectIdentity,
          error: message,
          event: "index.failed",
          indexMode: command.mode,
          indexRunId,
          indexScope: this.context.indexScope,
          trigger: "manual",
          watcherState: this.context.watcherState,
        });

        throw new LkgError(ERROR_CODES.INTERNAL_ERROR, message);
      } finally {
        if (!completed) {
          lockRenewal.stop();
        }
      }

      lockRenewal.stop();
      return {
        acceptedAt: requestedAt,
        indexRunId,
        mode: command.mode,
        state: "idle",
      };
    } finally {
      await this.indexStatePort.releaseRunLock?.({
        activeProjectIdentity: this.context.activeProjectIdentity,
        indexRunId,
        indexScope: this.context.indexScope,
      });
    }
  }

  private async acquireRunLock(indexRunId: string) {
    const firstAttempt = await this.indexStatePort.acquireRunLock?.({
      activeProjectIdentity: this.context.activeProjectIdentity,
      indexRunId,
      indexScope: this.context.indexScope,
    });
    if (firstAttempt !== null) {
      return firstAttempt;
    }

    await this.indexStatePort.recoverStaleRunState?.({
      activeProjectIdentity: this.context.activeProjectIdentity,
      indexScope: this.context.indexScope,
    });

    const secondAttempt = await this.indexStatePort.acquireRunLock?.({
      activeProjectIdentity: this.context.activeProjectIdentity,
      indexRunId,
      indexScope: this.context.indexScope,
    });
    if (secondAttempt !== null) {
      return secondAttempt;
    }

    const existingStatus = await this.indexStatePort.getStatus(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );
    throw new LkgError(
      ERROR_CODES.ALREADY_RUNNING,
      "An index run is already active for this project scope.",
      {
        activeProjectIdentity: this.context.activeProjectIdentity,
        indexRunId: existingStatus?.indexRunId ?? null,
        indexScope: this.context.indexScope,
      },
    );
  }

  private createLockRenewal(indexRunId: string): {
    assertOwned: () => Promise<void>;
    start: () => void;
    stop: () => void;
  } {
    if (this.indexStatePort.renewRunLock === undefined) {
      return {
        assertOwned: () => Promise.resolve(),
        start: () => undefined,
        stop: () => undefined,
      };
    }

    let timer: NodeJS.Timeout | null = null;
    let lostOwnership: Promise<void> | null = null;
    const renew = async () => {
      const renewed = await this.indexStatePort.renewRunLock?.({
        activeProjectIdentity: this.context.activeProjectIdentity,
        indexRunId,
        indexScope: this.context.indexScope,
      });
      if (renewed !== null) {
        return;
      }

      this.logger.error("Lost index run lock", {
        activeProjectIdentity: this.context.activeProjectIdentity,
        event: "index.lock_lost",
        indexRunId,
        indexScope: this.context.indexScope,
        watcherState: this.context.watcherState,
      });
      throw new LkgError(
        ERROR_CODES.INTERNAL_ERROR,
        "Index run lost its coordination lock.",
      );
    };

    return {
      assertOwned: async () => {
        if (lostOwnership !== null) {
          await lostOwnership;
        }
      },
      start: () => {
        timer = setInterval(() => {
          lostOwnership = renew();
          lostOwnership.catch(() => undefined);
        }, INDEX_RUN_LOCK_RENEW_INTERVAL_MS);
        timer.unref();
      },
      stop: () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
  }
}
