import type {
  AnalyzeImpactCommand,
  AnalyzeImpactResult,
  ComputeSliceCommand,
  ComputeSliceResult,
  ListEntrypointsCommand,
  ListEntrypointsResult,
  TraceFlowCommand,
  TraceFlowResult,
} from "./analysis.js";
import type {
  IndexMode,
  RunIndexResult,
  StatusSnapshot,
} from "./index-lifecycle.js";
import type {
  SearchKnowledgeCommand,
  SearchKnowledgeResult,
} from "./search.js";
import type {
  GetSymbolCommand,
  ListSymbolsCommand,
  ListSymbolsResult,
  SymbolDetailResult,
} from "./symbols.js";

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
    }
  | {
      command: ListSymbolsCommand;
      type: "symbols.query";
    }
  | {
      command: GetSymbolCommand;
      type: "symbol.get";
    }
  | {
      command: ListEntrypointsCommand;
      type: "entrypoints.list";
    }
  | {
      command: TraceFlowCommand;
      type: "flow.trace";
    }
  | {
      command: AnalyzeImpactCommand;
      type: "impact.analyze";
    }
  | {
      command: ComputeSliceCommand;
      type: "slice.compute";
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
    }
  | {
      result: ListSymbolsResult;
      type: "symbols.query";
    }
  | {
      result: SymbolDetailResult;
      type: "symbol.get";
    }
  | {
      result: ListEntrypointsResult;
      type: "entrypoints.list";
    }
  | {
      result: TraceFlowResult;
      type: "flow.trace";
    }
  | {
      result: AnalyzeImpactResult;
      type: "impact.analyze";
    }
  | {
      result: ComputeSliceResult;
      type: "slice.compute";
    };
