import type { IndexCounters, StatusSnapshot } from "../dto/index-lifecycle.js";
import type { IndexStatePort } from "../ports/index-state-port.js";

export class GetStatusUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly context: {
      activeProjectIdentity: string;
      configFingerprint: string;
      indexScope: StatusSnapshot["indexScope"];
      watcherState: StatusSnapshot["watcherState"];
    },
  ) {}

  async execute(): Promise<StatusSnapshot> {
    const stored = await this.indexStatePort.getRecord(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );

    if (!stored) {
      return {
        activeProjectIdentity: this.context.activeProjectIdentity,
        counters: {
          errors: 0,
          filesIndexed: 0,
          filesTotal: 0,
        },
        indexRunId: null,
        indexScope: this.context.indexScope,
        lastError: null,
        lastIndexedAt: null,
        needsReindex: true,
        pendingChanges: false,
        state: "idle",
        watcherState: this.context.watcherState,
      };
    }

    const configChanged =
      stored.configFingerprint !== this.context.configFingerprint;

    return {
      ...stored.status,
      counters: configChanged
        ? clearStaleErrors(stored.status.counters)
        : stored.status.counters,
      lastError: configChanged ? null : stored.status.lastError,
      needsReindex:
        stored.status.needsReindex ||
        stored.status.pendingChanges ||
        stored.status.watcherState !== this.context.watcherState ||
        configChanged,
      pendingChanges: stored.status.pendingChanges,
      watcherState: this.context.watcherState,
    };
  }
}

function clearStaleErrors(counters: IndexCounters): IndexCounters {
  return {
    ...counters,
    errors: 0,
  };
}
