import type { DaemonRequest, DaemonResponse } from "./dto/daemon.js";
import type { StatusSnapshot } from "./dto/index-lifecycle.js";
import type { CanonicalFactStorePort } from "./ports/canonical-fact-store-port.js";
import type { DerivedFactStorePort } from "./ports/derived-fact-store-port.js";
import type { EmbeddingPort } from "./ports/embedding-port.js";
import type { IndexStatePort } from "./ports/index-state-port.js";
import type { IngestionPipelinePort } from "./ports/ingestion-pipeline-port.js";
import type { InternalGraphStorePort } from "./ports/internal-graph-store-port.js";
import type { LoggerPort } from "./ports/logger-port.js";
import type { RetrieverPort } from "./ports/retriever-port.js";
import type { SymbolCandidateStorePort } from "./ports/symbol-candidate-store-port.js";
import { GetStatusUseCase } from "./use-cases/get-status-use-case.js";
import { GetSymbolUseCase } from "./use-cases/get-symbol-use-case.js";
import { ListSymbolsUseCase } from "./use-cases/list-symbols-use-case.js";
import { RunIndexUseCase } from "./use-cases/run-index-use-case.js";
import { SearchKnowledgeUseCase } from "./use-cases/search-knowledge-use-case.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

export type DaemonRequestHandler = {
  close(): Promise<void>;
  handle(request: DaemonRequest): Promise<DaemonResponse>;
};

export function createDaemonRequestHandler(dependencies: {
  canonicalFactStore: CanonicalFactStorePort;
  derivedFactStore: DerivedFactStorePort;
  embedding: EmbeddingPort;
  indexStatePort: IndexStatePort;
  ingestionPipeline: IngestionPipelinePort;
  internalGraphStore: InternalGraphStorePort;
  logger: LoggerPort;
  retriever: RetrieverPort;
  statusContext: {
    activeProjectIdentity: string;
    configFingerprint: string;
    indexScope: StatusSnapshot["indexScope"];
    watcherState: StatusSnapshot["watcherState"];
  };
  symbolCandidateStore: SymbolCandidateStorePort;
  watcherRuntime?: {
    close(): Promise<void>;
  } | null;
}): DaemonRequestHandler {
  return {
    async close(): Promise<void> {
      await dependencies.watcherRuntime?.close();
    },
    async handle(request: DaemonRequest): Promise<DaemonResponse> {
      switch (request.type) {
        case "health.check": {
          return {
            runtimeState: "ready",
            type: "health.check",
          };
        }
        case "status": {
          const status = await new GetStatusUseCase(
            dependencies.indexStatePort,
            dependencies.statusContext,
          ).execute();

          return {
            status: {
              ...status,
              daemonState: "ready",
              runtimeState: "ready",
            },
            type: "status",
          };
        }
        case "index.start": {
          const result = await new RunIndexUseCase(
            dependencies.indexStatePort,
            dependencies.ingestionPipeline,
            dependencies.logger,
            dependencies.statusContext,
          ).execute(request.command);

          return {
            result,
            type: "index.start",
          };
        }
        case "search.query": {
          const result = await new SearchKnowledgeUseCase(
            dependencies.indexStatePort,
            dependencies.embedding,
            dependencies.retriever,
            {
              activeProjectIdentity:
                dependencies.statusContext.activeProjectIdentity,
              indexScope: dependencies.statusContext.indexScope,
            },
          ).execute(request.command);

          return {
            result,
            type: "search.query",
          };
        }
        case "symbols.query": {
          const result = await new ListSymbolsUseCase(
            dependencies.indexStatePort,
            dependencies.symbolCandidateStore,
            {
              activeProjectIdentity:
                dependencies.statusContext.activeProjectIdentity,
              indexScope: dependencies.statusContext.indexScope,
            },
          ).execute(request.command);

          return {
            result,
            type: "symbols.query",
          };
        }
        case "symbol.get": {
          const result = await new GetSymbolUseCase(
            dependencies.indexStatePort,
            dependencies.symbolCandidateStore,
            dependencies.canonicalFactStore,
            dependencies.derivedFactStore,
            dependencies.internalGraphStore,
            {
              activeProjectIdentity:
                dependencies.statusContext.activeProjectIdentity,
              indexScope: dependencies.statusContext.indexScope,
            },
          ).execute(request.command);

          return {
            result,
            type: "symbol.get",
          };
        }
        default:
          return assertNever(request);
      }
    },
  };
}

function assertNever(request: never): never {
  throw new LkgError(
    ERROR_CODES.INTERNAL_ERROR,
    `Unsupported daemon request: ${JSON.stringify(request)}`,
  );
}
