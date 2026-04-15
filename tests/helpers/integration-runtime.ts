import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DeterministicEmbedding } from "./deterministic-embedding.js";
import type { StatusSnapshot } from "../../src/application/dto/index-lifecycle.js";
import type {
  FileManifestEntry,
  PersistedChunkRecord,
} from "../../src/application/dto/storage.js";
import type { LoggerPort } from "../../src/application/ports/logger-port.js";
import { DefaultChunker } from "../../src/infrastructure/chunking/default-chunker.js";
import { DefaultIngestionPipeline } from "../../src/infrastructure/indexing/default-ingestion-pipeline.js";
import { FallbackParser } from "../../src/infrastructure/parsing/fallback-parser.js";
import { GlobFileScanner } from "../../src/infrastructure/scanning/glob-file-scanner.js";
import { FileDocumentManifestRepository } from "../../src/infrastructure/state/file-document-manifest-repository.js";
import { FileIndexStateRepository } from "../../src/infrastructure/state/file-index-state-repository.js";
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
