import type {
  IndexMode,
  RunIndexResult,
  StatusSnapshot,
} from "./index-lifecycle.js";
import type {
  SearchKnowledgeCommand,
  SearchKnowledgeResult,
} from "./search.js";

export type DaemonRequest =
  | {
      type: "health.check";
    }
  | {
      type: "status";
    }
  | {
      command: { mode: IndexMode };
      type: "index.start";
    }
  | {
      command: SearchKnowledgeCommand;
      type: "search.query";
    };

export type DaemonResponse =
  | {
      runtimeState: NonNullable<StatusSnapshot["runtimeState"]>;
      type: "health.check";
    }
  | {
      status: StatusSnapshot;
      type: "status";
    }
  | {
      result: RunIndexResult;
      type: "index.start";
    }
  | {
      result: SearchKnowledgeResult;
      type: "search.query";
    };
