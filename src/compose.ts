import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createDaemonRequestHandler,
  createDaemonRuntime,
  type DaemonRequestHandler,
} from "./application/daemon-request-handler.js";
import type { AnalysisRuleRegistryPort } from "./application/ports/analysis-rule-registry-port.js";
import type { DaemonClientPort } from "./application/ports/daemon-client-port.js";
import type { EmbeddingPort } from "./application/ports/embedding-port.js";
import type { IngestionPipelinePort } from "./application/ports/ingestion-pipeline-port.js";
import type { LanguageRegistryPort } from "./application/ports/language-registry-port.js";
import type { LoggerPort } from "./application/ports/logger-port.js";
import type { OverlayBuilderPort } from "./application/ports/overlay-builder-port.js";
import type { OverlayStorePort } from "./application/ports/overlay-store-port.js";
import type { RetrieverPort } from "./application/ports/retriever-port.js";
import type { RulePackRegistryPort } from "./application/ports/rule-pack-registry-port.js";
import type { StructuredAnalyzerRegistryPort } from "./application/ports/structured-analyzer-registry-port.js";
import type { StructuredObservationStorePort } from "./application/ports/structured-observation-store-port.js";
import type { SymbolCandidateStorePort } from "./application/ports/symbol-candidate-store-port.js";
import type { VectorStorePort } from "./application/ports/vector-store-port.js";
import { DefaultChunker } from "./infrastructure/chunking/default-chunker.js";
import type { LkgConfig } from "./infrastructure/config/load-config.js";
import { loadConfig } from "./infrastructure/config/load-config.js";
import { resolveGitBranch } from "./infrastructure/config/resolve-git-branch.js";
import { SocketDaemonClient } from "./infrastructure/daemon/socket-daemon-client.js";
import { LlamaCppEmbeddingAdapter } from "./infrastructure/embedding/llama-cpp-embedding-adapter.js";
import { AstGrepRuleLoader } from "./infrastructure/indexing/ast-grep-rule-loader.js";
import { AstGrepStructuredAnalyzer } from "./infrastructure/indexing/ast-grep-structured-analyzer.js";
import { DefaultIngestionPipeline } from "./infrastructure/indexing/default-ingestion-pipeline.js";
import { DefaultLanguageRegistry } from "./infrastructure/indexing/default-language-registry.js";
import { DefaultStructuredAnalyzerRegistry } from "./infrastructure/indexing/default-structured-analyzer-registry.js";
import { DerivedFactOverlayBuilder } from "./infrastructure/indexing/derived-fact-overlay-builder.js";
import { GenericStructuredAnalyzer } from "./infrastructure/indexing/generic-structured-analyzer.js";
import { InternalGraphProjector } from "./infrastructure/indexing/internal-graph-projector.js";
import { RepoArtifactAnalyzer } from "./infrastructure/indexing/repo-artifact-analyzer.js";
import { StaticAnalysisRuleRegistry } from "./infrastructure/indexing/static-analysis-rule-registry.js";
import { StaticRulePackRegistry } from "./infrastructure/indexing/static-rule-pack-registry.js";
import { TsJsDeepAnalyzer } from "./infrastructure/indexing/ts-js-deep-analyzer.js";
import { createLogger } from "./infrastructure/logging/create-logger.js";
import { FallbackParser } from "./infrastructure/parsing/fallback-parser.js";
import { HybridRetriever } from "./infrastructure/retrieval/hybrid-retriever.js";
import { GlobFileScanner } from "./infrastructure/scanning/glob-file-scanner.js";
import { FileCanonicalFactRepository } from "./infrastructure/state/file-canonical-fact-repository.js";
import { FileDerivedFactRepository } from "./infrastructure/state/file-derived-fact-repository.js";
import { FileDocumentManifestRepository } from "./infrastructure/state/file-document-manifest-repository.js";
import { FileIndexStateRepository } from "./infrastructure/state/file-index-state-repository.js";
import { FileInternalGraphRepository } from "./infrastructure/state/file-internal-graph-repository.js";
import { FileOverlayRepository } from "./infrastructure/state/file-overlay-repository.js";
import { FileStructuredObservationRepository } from "./infrastructure/state/file-structured-observation-repository.js";
import { FileSymbolCandidateRepository } from "./infrastructure/state/file-symbol-candidate-repository.js";
import { LanceDbVectorStore } from "./infrastructure/storage/lance-db-vector-store.js";
import {
  IncrementalWatcherRuntime,
  createWatcherIndexRunner,
} from "./infrastructure/watcher/incremental-watcher-runtime.js";

function readOptionalFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function createEmbeddingPort(options: {
  dimension: number | null;
  logger: LoggerPort;
  modelDir: string;
  resolvedModel: LkgConfig["resolvedLlamaCppModel"];
  threads: number;
}): EmbeddingPort {
  return new LlamaCppEmbeddingAdapter(options);
}

export function createDaemonClient(options: {
  socketPath: string;
}): DaemonClientPort {
  return new SocketDaemonClient(options);
}

export function composeMainLogger(options: { cwd: string }): {
  config: LkgConfig;
  logger: LoggerPort;
} {
  const config = loadConfig({
    cwd: options.cwd,
    gitBranch: resolveGitBranch(options.cwd),
  });
  const logger = createLogger(config).child({
    activeProjectIdentity: config.activeProjectIdentity,
    indexScope: config.indexScope,
    watcherState: config.watcherState,
  });

  return { config, logger };
}

export function composeDaemonHandler(options: {
  cwd: string;
  logger: LoggerPort;
}): {
  handler: DaemonRequestHandler;
  indexStatePort: FileIndexStateRepository;
  runtime: ReturnType<typeof createDaemonRuntime>;
  statusContext: {
    activeProjectIdentity: string;
    configFingerprint: string;
    indexScope: string;
    watcherState: string;
  };
} {
  const { cwd, logger } = options;
  const { config } = composeMainLogger({ cwd });
  const indexStateRepository = new FileIndexStateRepository({
    homeDir: config.homeDir,
  });
  const embedding = createEmbeddingPort({
    dimension: config.embeddingDimension,
    logger,
    modelDir: config.llamaCppModelDir ?? resolve(config.homeDir, "llm"),
    resolvedModel: config.resolvedLlamaCppModel,
    threads: config.embeddingThreads,
  });
  const vectorStore: VectorStorePort = new LanceDbVectorStore({
    indexScope: config.indexScope,
    projectIdentity: config.activeProjectIdentity,
    vectorDbUri: config.vectorDbUri,
  });
  const symbolCandidateStore: SymbolCandidateStorePort =
    new FileSymbolCandidateRepository({
      homeDir: config.homeDir,
      indexScope: config.indexScope,
      projectIdentity: config.activeProjectIdentity,
    });
  const canonicalFactStore = new FileCanonicalFactRepository({
    homeDir: config.homeDir,
    indexScope: config.indexScope,
    projectIdentity: config.activeProjectIdentity,
  });
  const derivedFactStore = new FileDerivedFactRepository({
    homeDir: config.homeDir,
    indexScope: config.indexScope,
    projectIdentity: config.activeProjectIdentity,
  });
  const internalGraphStore = new FileInternalGraphRepository({
    homeDir: config.homeDir,
    indexScope: config.indexScope,
    projectIdentity: config.activeProjectIdentity,
  });
  const overlayStore: OverlayStorePort = new FileOverlayRepository({
    homeDir: config.homeDir,
    indexScope: config.indexScope,
    projectIdentity: config.activeProjectIdentity,
  });
  const structuredObservationStore: StructuredObservationStorePort =
    new FileStructuredObservationRepository({
      homeDir: config.homeDir,
      indexScope: config.indexScope,
      projectIdentity: config.activeProjectIdentity,
    });
  const languageRegistry: LanguageRegistryPort = new DefaultLanguageRegistry();
  const structuredAnalyzers: StructuredAnalyzerRegistryPort =
    new DefaultStructuredAnalyzerRegistry(
      [
        new RepoArtifactAnalyzer(),
        new GenericStructuredAnalyzer(),
        new TsJsDeepAnalyzer(),
        new AstGrepStructuredAnalyzer(
          languageRegistry,
          new AstGrepRuleLoader(),
        ),
      ],
      languageRegistry,
    );
  const retriever: RetrieverPort = new HybridRetriever(embedding, vectorStore);
  const overlayBuilder: OverlayBuilderPort = new DerivedFactOverlayBuilder();
  const analysisRuleRegistry: AnalysisRuleRegistryPort =
    new StaticAnalysisRuleRegistry();
  const rulePackRegistry: RulePackRegistryPort = new StaticRulePackRegistry();
  void analysisRuleRegistry;
  void rulePackRegistry;
  const ingestionPipeline: IngestionPipelinePort = new DefaultIngestionPipeline(
    new GlobFileScanner({
      cwd,
      gitignore: readOptionalFile(resolve(cwd, ".gitignore")),
      lkgignore: readOptionalFile(resolve(cwd, ".lkgignore")),
      maxFileSizeBytes: config.maxFileSizeBytes,
      skipOversizedFiles: config.oversizedSegmentPolicy === "skip",
    }),
    new FallbackParser(),
    new DefaultChunker(),
    embedding,
    vectorStore,
    new FileDocumentManifestRepository({
      homeDir: config.homeDir,
      indexScope: config.indexScope,
      projectIdentity: config.activeProjectIdentity,
    }),
    symbolCandidateStore,
    structuredObservationStore,
    structuredAnalyzers,
    canonicalFactStore,
    derivedFactStore,
    internalGraphStore,
    overlayStore,
    overlayBuilder,
    new InternalGraphProjector(),
    logger,
    {
      activeProjectIdentity: config.activeProjectIdentity,
      chunking: {
        chunkTokenOverlap: config.chunkTokenOverlap,
        embeddingContextLength: config.effectiveEmbeddingContextLength,
        embeddingTokenMargin: config.embeddingTokenMargin,
        maxChunkTokens: config.maxChunkTokens,
        maxSplitDepth: config.maxSplitDepth,
        oversizedSegmentPolicy: config.oversizedSegmentPolicy,
      },
      embeddingBatchSize: config.embeddingBatchSize,
      fileScanBatchSize: config.fileScanBatchSize,
      indexCheckpointEveryBatches: config.indexCheckpointEveryBatches,
      vectorUpsertBatchSize: config.vectorUpsertBatchSize,
    },
  );
  const statusContext = {
    activeProjectIdentity: config.activeProjectIdentity,
    configFingerprint: config.configFingerprint,
    indexScope: config.indexScope,
    watcherState: config.watcherState,
  };

  const watcherRuntime =
    config.watcherState === "enabled"
      ? new IncrementalWatcherRuntime({
          cwd,
          gitignore: readOptionalFile(resolve(cwd, ".gitignore")),
          indexRunner: createWatcherIndexRunner({
            indexStatePort: indexStateRepository,
            ingestionPipeline,
            logger,
            statusContext,
          }),
          indexStatePort: indexStateRepository,
          lkgignore: readOptionalFile(resolve(cwd, ".lkgignore")),
          logger,
          statusContext: {
            activeProjectIdentity: statusContext.activeProjectIdentity,
            indexScope: statusContext.indexScope,
          },
        })
      : null;
  const daemonRuntime = createDaemonRuntime({ watcherRuntime });

  return {
    handler: createDaemonRequestHandler({
      canonicalFactStore,
      derivedFactStore,
      embedding,
      indexStatePort: indexStateRepository,
      ingestionPipeline,
      internalGraphStore,
      logger,
      retriever,
      statusContext,
      symbolCandidateStore,
    }),
    indexStatePort: indexStateRepository,
    runtime: daemonRuntime,
    statusContext,
  };
}
