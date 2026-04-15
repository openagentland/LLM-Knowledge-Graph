import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  resolveLlamaCppModel,
  type ResolvedLlamaCppModel,
} from "./resolve-llama-cpp-model.js";
import type {
  IndexScope,
  WatcherState,
} from "../../application/dto/index-lifecycle.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";

export type LkgConfig = {
  activeProjectIdentity: string;
  chunkTokenOverlap: number;
  configFingerprint: string;
  embeddingBatchSize: number;
  embeddingContextLength: number | null;
  embeddingDimension: number | null;
  embeddingModel: string | null;
  embeddingProvider: "llama_cpp";
  embeddingTokenMargin: number;
  fileScanBatchSize: number;
  homeDir: string;
  indexCheckpointEveryBatches: number;
  indexScope: IndexScope;
  llamaCppModelDir: string | null;
  llamaCppUri: string;
  logFile: string;
  logLevel: "debug" | "info" | "warn" | "error";
  logMaxBytes: number;
  logMaxFiles: number;
  logMode: "file" | "std";
  maxChunkTokens: number | null;
  maxFileSizeBytes: number;
  maxSplitDepth: number;
  oversizedSegmentPolicy: "split" | "skip";
  resolvedLlamaCppModel: ResolvedLlamaCppModel;
  vectorDbProvider: "lancedb";
  vectorDbUri: string;
  vectorUpsertBatchSize: number;
  watcherState: WatcherState;
};

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_LOG_MAX_SIZE_MB = 20;
const DEFAULT_LOG_MAX_FILES = 5;
const DEFAULT_FILE_SCAN_BATCH_SIZE = 50;
const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
const DEFAULT_VECTOR_UPSERT_BATCH_SIZE = 100;
const DEFAULT_INDEX_CHECKPOINT_EVERY_BATCHES = 1;
const DEFAULT_EMBEDDING_TOKEN_MARGIN = 256;
const DEFAULT_CHUNK_TOKEN_OVERLAP = 64;
const DEFAULT_MAX_SPLIT_DEPTH = 4;
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const LOG_MODES = new Set(["file", "std"]);
const OVERSIZED_SEGMENT_POLICIES = new Set(["split", "skip"]);
const SUPPORTED_VECTORDB_PROVIDER = "lancedb";
const SUPPORTED_EMBEDDING_PROVIDER = "llama_cpp";
const DEFAULT_LLAMA_CPP_URI = "preset:nomic-v1.5";

export function loadConfig(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    gitBranch?: string | null;
  } = {},
): LkgConfig {
  const env = options.env ?? process.env;
  const cwd = resolveRealPath(resolve(options.cwd ?? process.cwd()));
  const homeDir = resolveHome(env.LKG_HOME);
  const logMode = resolveLogMode(env.LKG_LOG_MODE);
  const logLevel = resolveLogLevel(env.LKG_LOG_LEVEL);
  const logFile = resolve(env.LKG_LOG_FILE ?? resolve(homeDir, "log.txt"));
  const logMaxBytes = resolveLogMaxBytes(env.LKG_LOG_MAX_SIZE_MB);
  const logMaxFiles = resolvePositiveInteger(
    env.LKG_LOG_MAX_FILES,
    "LKG_LOG_MAX_FILES",
    DEFAULT_LOG_MAX_FILES,
  );
  const maxFileSizeBytes = resolveMaxFileSizeBytes(env.LKG_MAX_FILE_SIZE_BYTES);
  const watcherState: WatcherState =
    env.LKG_DISABLE_WATCHER === "true" ? "disabled" : "enabled";
  const branchAware = env.LKG_BRANCH_AWARE === "true";
  const explicitProjectId = env.LKG_PROJECT_ID?.trim();
  const hasExplicitProjectId =
    explicitProjectId !== undefined && explicitProjectId.length > 0;
  const indexScope: IndexScope =
    hasExplicitProjectId || !branchAware ? "shared" : "branch";
  const activeProjectIdentity = resolveProjectIdentity({
    branchAware,
    cwd,
    explicitProjectId,
    gitBranch: options.gitBranch ?? null,
  });
  const vectorDbProvider = resolveProvider({
    envName: "LKG_VECTORDB_PROVIDER",
    kind: "vector database",
    supportedProvider: SUPPORTED_VECTORDB_PROVIDER,
    value: env.LKG_VECTORDB_PROVIDER,
  });
  const vectorDbUri = resolveConfiguredPath({
    cwd,
    fallback: resolve(homeDir, "vectordb", "lance"),
    value: env.LKG_VECTORDB_URI,
  });
  const embeddingProvider = resolveProvider({
    envName: "LKG_EMBEDDING_PROVIDER",
    kind: "embedding",
    supportedProvider: SUPPORTED_EMBEDDING_PROVIDER,
    value: env.LKG_EMBEDDING_PROVIDER,
  });
  const llamaCppUri =
    resolveNonEmptyString(env.LKG_LLAMA_CPP_URI) ?? DEFAULT_LLAMA_CPP_URI;
  const llamaCppModelDir = resolveOptionalPath(
    cwd,
    env.LKG_LLAMA_CPP_MODEL_DIR,
  );
  const resolvedLlamaCppModel = resolveLlamaCppModel(llamaCppUri);
  const embeddingContextLength = resolveOptionalPositiveInteger(
    env.LKG_EMBEDDING_CONTEXT_LENGTH,
    "LKG_EMBEDDING_CONTEXT_LENGTH",
  );
  const embeddingModel = resolveOptionalString(env.LKG_EMBEDDING_MODEL);
  const embeddingDimension = resolveOptionalPositiveInteger(
    env.LKG_EMBEDDING_DIM,
    "LKG_EMBEDDING_DIM",
  );
  const fileScanBatchSize = resolvePositiveInteger(
    env.LKG_FILE_SCAN_BATCH_SIZE,
    "LKG_FILE_SCAN_BATCH_SIZE",
    DEFAULT_FILE_SCAN_BATCH_SIZE,
  );
  const embeddingBatchSize = resolvePositiveInteger(
    env.LKG_EMBEDDING_BATCH_SIZE,
    "LKG_EMBEDDING_BATCH_SIZE",
    DEFAULT_EMBEDDING_BATCH_SIZE,
  );
  const vectorUpsertBatchSize = resolvePositiveInteger(
    env.LKG_VECTOR_UPSERT_BATCH_SIZE,
    "LKG_VECTOR_UPSERT_BATCH_SIZE",
    DEFAULT_VECTOR_UPSERT_BATCH_SIZE,
  );
  const indexCheckpointEveryBatches = resolvePositiveInteger(
    env.LKG_INDEX_CHECKPOINT_EVERY_BATCHES,
    "LKG_INDEX_CHECKPOINT_EVERY_BATCHES",
    DEFAULT_INDEX_CHECKPOINT_EVERY_BATCHES,
  );
  const embeddingTokenMargin = resolvePositiveInteger(
    env.LKG_EMBEDDING_TOKEN_MARGIN,
    "LKG_EMBEDDING_TOKEN_MARGIN",
    DEFAULT_EMBEDDING_TOKEN_MARGIN,
  );
  const maxChunkTokens = resolveOptionalPositiveInteger(
    env.LKG_MAX_CHUNK_TOKENS,
    "LKG_MAX_CHUNK_TOKENS",
  );
  const chunkTokenOverlap = resolvePositiveInteger(
    env.LKG_CHUNK_TOKEN_OVERLAP,
    "LKG_CHUNK_TOKEN_OVERLAP",
    DEFAULT_CHUNK_TOKEN_OVERLAP,
  );
  const maxSplitDepth = resolvePositiveInteger(
    env.LKG_MAX_SPLIT_DEPTH,
    "LKG_MAX_SPLIT_DEPTH",
    DEFAULT_MAX_SPLIT_DEPTH,
  );
  const oversizedSegmentPolicy = resolveOversizedSegmentPolicy(
    env.LKG_OVERSIZED_SEGMENT_POLICY,
  );

  validateChunkingConfig({
    embeddingContextLength,
    embeddingTokenMargin,
    maxChunkTokens,
  });

  ensureWritableDirectory(dirname(logFile));
  ensureWritableDirectory(homeDir);
  ensureWritableDirectory(vectorDbUri);

  const configFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        activeProjectIdentity,
        embeddingBatchSize,
        embeddingContextLength,
        embeddingDimension,
        embeddingModel,
        embeddingProvider,
        embeddingTokenMargin,
        fileScanBatchSize,
        indexCheckpointEveryBatches,
        indexScope,
        chunkTokenOverlap,
        llamaCppModelDir,
        llamaCppUri,
        logLevel,
        logMaxBytes,
        logMaxFiles,
        logMode,
        maxChunkTokens,
        maxFileSizeBytes,
        maxSplitDepth,
        oversizedSegmentPolicy,
        resolvedLlamaCppModel,
        vectorDbProvider,
        vectorDbUri,
        vectorUpsertBatchSize,
        watcherState,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    activeProjectIdentity,
    chunkTokenOverlap,
    configFingerprint,
    embeddingBatchSize,
    embeddingContextLength,
    embeddingDimension,
    embeddingModel,
    embeddingProvider,
    embeddingTokenMargin,
    fileScanBatchSize,
    homeDir,
    indexCheckpointEveryBatches,
    indexScope,
    llamaCppModelDir,
    llamaCppUri,
    logFile,
    logLevel,
    logMaxBytes,
    logMaxFiles,
    logMode,
    maxChunkTokens,
    maxFileSizeBytes,
    maxSplitDepth,
    oversizedSegmentPolicy,
    resolvedLlamaCppModel,
    vectorDbProvider,
    vectorDbUri,
    vectorUpsertBatchSize,
    watcherState,
  };
}

function ensureWritableDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function normalizePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32"
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function resolveCanonicalProjectPath(cwd: string): string {
  const repoRoot = resolveGitRepoRoot(cwd);
  return normalizePath(resolveRealPath(repoRoot ?? cwd));
}

function resolveGitRepoRoot(cwd: string): string | null {
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return repoRoot.length > 0 ? repoRoot : null;
  } catch {
    return null;
  }
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function resolveHome(home: string | undefined): string {
  const trimmedHome = home?.trim();
  if (trimmedHome === undefined || trimmedHome.length === 0) {
    return resolveRealPath(resolve(homedir(), ".lkg"));
  }

  if (trimmedHome.startsWith("~/")) {
    return resolveRealPath(resolve(homedir(), trimmedHome.slice(2)));
  }

  return resolveRealPath(resolve(trimmedHome));
}

function resolveLogLevel(value: string | undefined): LkgConfig["logLevel"] {
  const trimmedValue = value?.trim();
  const candidate =
    trimmedValue !== undefined && trimmedValue.length > 0
      ? trimmedValue
      : "info";
  if (LOG_LEVELS.has(candidate)) {
    return candidate as LkgConfig["logLevel"];
  }

  throw new LkgError(
    ERROR_CODES.INVALID_INPUT,
    "Invalid LKG_LOG_LEVEL value.",
    {
      value: candidate,
    },
  );
}

function resolveLogMode(value: string | undefined): LkgConfig["logMode"] {
  const trimmedValue = value?.trim();
  const candidate =
    trimmedValue !== undefined && trimmedValue.length > 0
      ? trimmedValue
      : "file";
  if (LOG_MODES.has(candidate)) {
    return candidate as LkgConfig["logMode"];
  }

  throw new LkgError(ERROR_CODES.INVALID_INPUT, "Invalid LKG_LOG_MODE value.", {
    value: candidate,
  });
}

function resolveLogMaxBytes(value: string | undefined): number {
  return (
    resolvePositiveInteger(
      value,
      "LKG_LOG_MAX_SIZE_MB",
      DEFAULT_LOG_MAX_SIZE_MB,
    ) * BYTES_PER_MEGABYTE
  );
}

function resolveMaxFileSizeBytes(value: string | undefined): number {
  return resolvePositiveInteger(
    value,
    "LKG_MAX_FILE_SIZE_BYTES",
    DEFAULT_MAX_FILE_SIZE_BYTES,
  );
}

function resolvePositiveInteger(
  value: string | undefined,
  envName: string,
  fallback: number,
): number {
  const trimmedValue = value?.trim();
  if (trimmedValue === undefined || trimmedValue.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmedValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  throw new LkgError(ERROR_CODES.INVALID_INPUT, `Invalid ${envName} value.`, {
    value,
  });
}

function resolveOversizedSegmentPolicy(
  value: string | undefined,
): LkgConfig["oversizedSegmentPolicy"] {
  const candidate = resolveNonEmptyString(value) ?? "split";
  if (OVERSIZED_SEGMENT_POLICIES.has(candidate)) {
    return candidate as LkgConfig["oversizedSegmentPolicy"];
  }

  throw new LkgError(
    ERROR_CODES.INVALID_INPUT,
    "Invalid LKG_OVERSIZED_SEGMENT_POLICY value.",
    {
      value: candidate,
    },
  );
}

function validateChunkingConfig(options: {
  embeddingContextLength: number | null;
  embeddingTokenMargin: number;
  maxChunkTokens: number | null;
}): void {
  if (
    options.embeddingContextLength !== null &&
    options.embeddingTokenMargin >= options.embeddingContextLength
  ) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "LKG_EMBEDDING_TOKEN_MARGIN must be smaller than LKG_EMBEDDING_CONTEXT_LENGTH.",
      options,
    );
  }

  if (
    options.embeddingContextLength !== null &&
    options.maxChunkTokens !== null &&
    options.maxChunkTokens >=
      options.embeddingContextLength - options.embeddingTokenMargin
  ) {
    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "LKG_MAX_CHUNK_TOKENS must be smaller than the available embedding token budget.",
      options,
    );
  }
}

function resolveConfiguredPath(options: {
  cwd: string;
  fallback: string;
  value: string | undefined;
}): string {
  const candidate = resolveNonEmptyString(options.value);
  if (candidate === null) {
    return options.fallback;
  }

  return resolve(options.cwd, candidate);
}

function resolveProvider<TProvider extends "lancedb" | "llama_cpp">(options: {
  envName: string;
  kind: string;
  supportedProvider: TProvider;
  value: string | undefined;
}): TProvider {
  const candidate = resolveNonEmptyString(options.value);
  if (candidate === null) {
    return options.supportedProvider;
  }

  if (candidate === options.supportedProvider) {
    return options.supportedProvider;
  }

  throw new LkgError(
    ERROR_CODES.UNSUPPORTED_PROVIDER,
    `Unsupported ${options.kind} provider for ${options.envName}.`,
    {
      provider: candidate,
      supportedProvider: options.supportedProvider,
    },
  );
}

function resolveOptionalPath(
  cwd: string,
  value: string | undefined,
): string | null {
  const candidate = resolveNonEmptyString(value);
  return candidate === null ? null : resolve(cwd, candidate);
}

function resolveOptionalPositiveInteger(
  value: string | undefined,
  envName: string,
): number | null {
  const candidate = resolveNonEmptyString(value);
  if (candidate === null) {
    return null;
  }

  const parsed = Number.parseInt(candidate, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  throw new LkgError(ERROR_CODES.INVALID_INPUT, `Invalid ${envName} value.`, {
    value,
  });
}

function resolveOptionalString(value: string | undefined): string | null {
  return resolveNonEmptyString(value);
}

function resolveNonEmptyString(value: string | undefined): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue !== undefined && trimmedValue.length > 0
    ? trimmedValue
    : null;
}

function resolveProjectIdentity(options: {
  branchAware: boolean;
  cwd: string;
  explicitProjectId?: string;
  gitBranch: string | null;
}): string {
  if (
    options.explicitProjectId !== undefined &&
    options.explicitProjectId.length > 0
  ) {
    return options.explicitProjectId;
  }

  const canonicalProjectPath = resolveCanonicalProjectPath(options.cwd);
  const baseId = createHash("sha256")
    .update(canonicalProjectPath)
    .digest("hex")
    .slice(0, 16);

  if (
    !options.branchAware ||
    options.gitBranch === null ||
    options.gitBranch.length === 0
  ) {
    return baseId;
  }

  const sanitizedBranch = options.gitBranch
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitizedBranch.length > 0 ? `${baseId}__${sanitizedBranch}` : baseId;
}
