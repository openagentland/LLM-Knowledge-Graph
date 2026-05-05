import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DeterministicEmbedding } from "./deterministic-embedding.js";
import type { StatusSnapshot } from "../../src/application/dto/index-lifecycle.js";
import type { OverlaySnapshot } from "../../src/application/dto/overlay.js";
import type {
  FileManifestEntry,
  PersistedChunkRecord,
} from "../../src/application/dto/storage.js";
import type { PersistedStructuredObservationRecord } from "../../src/application/dto/structured-observations.js";
import type {
  PersistedCanonicalFactRecord,
  PersistedDerivedFactRecord,
  PersistedInternalGraphRecord,
  PersistedSymbolCandidateRecord,
} from "../../src/application/dto/structured-records.js";
import type { LoggerPort } from "../../src/application/ports/logger-port.js";
import { DefaultChunker } from "../../src/infrastructure/chunking/default-chunker.js";
import { AstGrepRuleLoader } from "../../src/infrastructure/indexing/ast-grep-rule-loader.js";
import { AstGrepStructuredAnalyzer } from "../../src/infrastructure/indexing/ast-grep-structured-analyzer.js";
import { DefaultIngestionPipeline } from "../../src/infrastructure/indexing/default-ingestion-pipeline.js";
import { DefaultLanguageRegistry } from "../../src/infrastructure/indexing/default-language-registry.js";
import { DefaultStructuredAnalyzerRegistry } from "../../src/infrastructure/indexing/default-structured-analyzer-registry.js";
import { DerivedFactOverlayBuilder } from "../../src/infrastructure/indexing/derived-fact-overlay-builder.js";
import { GenericStructuredAnalyzer } from "../../src/infrastructure/indexing/generic-structured-analyzer.js";
import { InternalGraphProjector } from "../../src/infrastructure/indexing/internal-graph-projector.js";
import { RepoArtifactAnalyzer } from "../../src/infrastructure/indexing/repo-artifact-analyzer.js";
import { TsJsDeepAnalyzer } from "../../src/infrastructure/indexing/ts-js-deep-analyzer.js";
import { FallbackParser } from "../../src/infrastructure/parsing/fallback-parser.js";
import { GlobFileScanner } from "../../src/infrastructure/scanning/glob-file-scanner.js";
import { FileCanonicalFactRepository } from "../../src/infrastructure/state/file-canonical-fact-repository.js";
import { FileDerivedFactRepository } from "../../src/infrastructure/state/file-derived-fact-repository.js";
import { FileDocumentManifestRepository } from "../../src/infrastructure/state/file-document-manifest-repository.js";
import { FileIndexStateRepository } from "../../src/infrastructure/state/file-index-state-repository.js";
import { FileInternalGraphRepository } from "../../src/infrastructure/state/file-internal-graph-repository.js";
import { FileOverlayRepository } from "../../src/infrastructure/state/file-overlay-repository.js";
import { FileStructuredObservationRepository } from "../../src/infrastructure/state/file-structured-observation-repository.js";
import { FileSymbolCandidateRepository } from "../../src/infrastructure/state/file-symbol-candidate-repository.js";
import { LanceDbVectorStore } from "../../src/infrastructure/storage/lance-db-vector-store.js";

const TEST_PROJECT_IDENTITY = "project-a";
const TEST_INDEX_SCOPE = "shared";

export async function createTempHomeDir(
  prefix = "lkg-state-",
): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function createTestLogger(): LoggerPort {
  return {
    child: () => ({
      child: () => {
        throw new Error("not used");
      },
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    }),
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  };
}

export function createIntegrationPipeline(
  cwd: string,
  homeDir: string,
): DefaultIngestionPipeline {
  const scanner = new GlobFileScanner({
    cwd,
    gitignore: "ignored.ts\n",
    maxFileSizeBytes: 1024 * 1024,
    skipOversizedFiles: false,
  });
  const structuredObservationStore = new FileStructuredObservationRepository({
    homeDir,
    indexScope: TEST_INDEX_SCOPE,
    projectIdentity: TEST_PROJECT_IDENTITY,
  });
  const languageRegistry = new DefaultLanguageRegistry();
  const structuredAnalyzers = new DefaultStructuredAnalyzerRegistry(
    [
      new RepoArtifactAnalyzer(),
      new GenericStructuredAnalyzer(),
      new TsJsDeepAnalyzer(),
      new AstGrepStructuredAnalyzer(languageRegistry, new AstGrepRuleLoader()),
    ],
    languageRegistry,
  );

  return new DefaultIngestionPipeline(
    scanner,
    new FallbackParser(),
    new DefaultChunker(),
    new DeterministicEmbedding(),
    new LanceDbVectorStore({
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
      vectorDbUri: resolve(homeDir, "vectordb"),
    }),
    new FileDocumentManifestRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    new FileSymbolCandidateRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    structuredObservationStore,
    structuredAnalyzers,
    new FileCanonicalFactRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    new FileDerivedFactRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    new FileInternalGraphRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    new FileOverlayRepository({
      homeDir,
      indexScope: TEST_INDEX_SCOPE,
      projectIdentity: TEST_PROJECT_IDENTITY,
    }),
    new DerivedFactOverlayBuilder(),
    new InternalGraphProjector(),
    createTestLogger(),
    {
      activeProjectIdentity: TEST_PROJECT_IDENTITY,
      chunking: {
        chunkTokenOverlap: 16,
        embeddingContextLength: 128,
        embeddingTokenMargin: 32,
        maxChunkTokens: 24,
        maxSplitDepth: 3,
        oversizedSegmentPolicy: "split",
      },
      embeddingBatchSize: 4,
      fileScanBatchSize: 2,
      indexCheckpointEveryBatches: 1,
      vectorUpsertBatchSize: 8,
    },
  );
}

export function createCanonicalFactStore(
  homeDir: string,
): FileCanonicalFactRepository {
  return new FileCanonicalFactRepository({
    homeDir,
    indexScope: TEST_INDEX_SCOPE,
    projectIdentity: TEST_PROJECT_IDENTITY,
  });
}

export function createDerivedFactStore(
  homeDir: string,
): FileDerivedFactRepository {
  return new FileDerivedFactRepository({
    homeDir,
    indexScope: TEST_INDEX_SCOPE,
    projectIdentity: TEST_PROJECT_IDENTITY,
  });
}

export function createInternalGraphStore(
  homeDir: string,
): FileInternalGraphRepository {
  return new FileInternalGraphRepository({
    homeDir,
    indexScope: TEST_INDEX_SCOPE,
    projectIdentity: TEST_PROJECT_IDENTITY,
  });
}

export function createVectorStore(homeDir: string): LanceDbVectorStore {
  return new LanceDbVectorStore({
    indexScope: TEST_INDEX_SCOPE,
    projectIdentity: TEST_PROJECT_IDENTITY,
    vectorDbUri: resolve(homeDir, "vectordb"),
  });
}

export function createIndexStateRepository(
  homeDir: string,
): FileIndexStateRepository {
  return new FileIndexStateRepository({ homeDir });
}

export function readVectorStore(
  homeDir: string,
): Promise<PersistedChunkRecord[]> {
  return createVectorStore(homeDir).listRecords();
}

export async function readManifest(
  homeDir: string,
): Promise<FileManifestEntry[]> {
  const content = await readFile(
    resolve(
      homeDir,
      "manifest",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as FileManifestEntry[];
}

export async function readSymbols(
  homeDir: string,
): Promise<PersistedSymbolCandidateRecord[]> {
  const content = await readFile(
    resolve(
      homeDir,
      "symbols",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as PersistedSymbolCandidateRecord[];
}

export async function readCanonicalFacts(
  homeDir: string,
): Promise<PersistedCanonicalFactRecord[]> {
  const content = await readFile(
    resolve(
      homeDir,
      "facts",
      "canonical",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as PersistedCanonicalFactRecord[];
}

export async function readDerivedFacts(
  homeDir: string,
): Promise<PersistedDerivedFactRecord[]> {
  const content = await readFile(
    resolve(
      homeDir,
      "facts",
      "derived",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as PersistedDerivedFactRecord[];
}

export async function readInternalGraph(
  homeDir: string,
): Promise<PersistedInternalGraphRecord> {
  const content = await readFile(
    resolve(
      homeDir,
      "graph",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as PersistedInternalGraphRecord;
}

export async function readOverlays(homeDir: string): Promise<OverlaySnapshot> {
  const content = await readFile(
    resolve(
      homeDir,
      "overlays",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as OverlaySnapshot;
}

export async function readStructuredObservations(
  homeDir: string,
): Promise<PersistedStructuredObservationRecord[]> {
  const content = await readFile(
    resolve(
      homeDir,
      "structured-observations",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as PersistedStructuredObservationRecord[];
}

export async function readStatusRecord(homeDir: string): Promise<{
  configFingerprint: string;
  status: StatusSnapshot;
}> {
  const content = await readFile(
    resolve(
      homeDir,
      "state",
      TEST_PROJECT_IDENTITY,
      `${TEST_INDEX_SCOPE}.json`,
    ),
    "utf8",
  );
  return JSON.parse(content) as {
    configFingerprint: string;
    status: StatusSnapshot;
  };
}

export function sortedPaths(entries: Array<{ path: string }>): string[] {
  return entries.map((entry) => entry.path).sort();
}

export const TEST_SCOPE = {
  activeProjectIdentity: TEST_PROJECT_IDENTITY,
  indexScope: TEST_INDEX_SCOPE as const,
};
