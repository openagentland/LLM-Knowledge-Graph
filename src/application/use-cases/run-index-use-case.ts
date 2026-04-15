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
    const existingStatus = await this.indexStatePort.getStatus(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );

    if (existingStatus?.state === "running") {
      throw new LkgError(
        ERROR_CODES.ALREADY_RUNNING,
        "An index run is already active for this project scope.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexRunId: existingStatus.indexRunId,
          indexScope: this.context.indexScope,
        },
      );
    }

    const requestedAt = new Date().toISOString();
    const indexRunId = randomUUID();

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

    try {
      const summary = await this.ingestionPipeline.run({
        indexRunId,
        mode: command.mode,
      });
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
    } catch (error) {
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
    }

    return {
      acceptedAt: requestedAt,
      indexRunId,
      mode: command.mode,
      state: "idle",
    };
  }
}
