import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../infrastructure/config/load-config.js";
import { ERROR_CODES } from "../../shared/errors/lkg-error.js";

describe("loadConfig", () => {
  it("uses shared scope by default and enables watcher", () => {
    const config = loadConfig({
      cwd: "/repo/project",
      env: {},
      gitBranch: null,
    });

    expect(config.indexScope).toBe("shared");
    expect(config.watcherState).toBe("enabled");
    expect(config.activeProjectIdentity).toHaveLength(16);
    expect(config.maxFileSizeBytes).toBe(1024 * 1024);
    expect(config.vectorDbProvider).toBe("lancedb");
    expect(config.vectorDbUri).toContain("/.lkg/vectordb/lance");
    expect(config.embeddingProvider).toBe("llama_cpp");
    expect(config.llamaCppUri).toBe("preset:nomic-v1.5-q8");
    expect(config.logMaxBytes).toBe(20 * 1024 * 1024);
    expect(config.logMaxFiles).toBe(5);
    expect(config.embeddingBatchSize).toBe(16);
    expect(config.embeddingThreads).toBe(1);
    expect(config.inferenceThreads).toBe(1);
    expect(config.embeddingTokenMargin).toBe(256);
    expect(config.fileScanBatchSize).toBe(50);
    expect(config.indexCheckpointEveryBatches).toBe(1);
    expect(config.maxChunkTokens).toBeNull();
    expect(config.chunkTokenOverlap).toBe(64);
    expect(config.maxSplitDepth).toBe(4);
    expect(config.oversizedSegmentPolicy).toBe("split");
    expect(config.vectorUpsertBatchSize).toBe(100);
    expect(config.daemonStartupTimeoutMs).toBe(20_000);
  });

  it("switches to branch scope when branch-aware is enabled without project override", () => {
    const config = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_BRANCH_AWARE: "true",
      },
      gitBranch: "feature/test-branch",
    });

    expect(config.indexScope).toBe("branch");
    expect(config.activeProjectIdentity).toContain("__feature-test-branch");
  });

  it("uses canonical repo identity across subdirectories and symlinked paths", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "lkg-config-"));
    const repoRoot = join(tempRoot, "repo");
    const subdirectory = join(repoRoot, "packages", "lkg");
    const symlinkPath = join(tempRoot, "repo-link");

    mkdirSync(subdirectory, { recursive: true });
    execFileSync("git", ["init"], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    symlinkSync(repoRoot, symlinkPath);

    const fromRepoRoot = loadConfig({
      cwd: repoRoot,
      env: {},
      gitBranch: null,
    });
    const fromSubdirectory = loadConfig({
      cwd: subdirectory,
      env: {},
      gitBranch: null,
    });
    const fromSymlink = loadConfig({
      cwd: symlinkPath,
      env: {},
      gitBranch: null,
    });

    expect(fromRepoRoot.activeProjectIdentity).toBe(
      fromSubdirectory.activeProjectIdentity,
    );
    expect(fromRepoRoot.activeProjectIdentity).toBe(
      fromSymlink.activeProjectIdentity,
    );
  });

  it("accepts explicit Phase 4 storage and embedding envs", () => {
    const config = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_EMBEDDING_CONTEXT_LENGTH: "4096",
        LKG_EMBEDDING_DIM: "768",
        LKG_EMBEDDING_MODEL: "nomic-embed-text-v1.5.f16.gguf",
        LKG_HOME: "/tmp/lkg-home",
        LKG_LLAMA_CPP_MODEL_DIR: "./models",
        LKG_LLAMA_CPP_URI: "preset:nomic-v1.5-q8",
        LKG_VECTORDB_URI: "./data/vector-store",
      },
      gitBranch: null,
    });

    expect(config.vectorDbUri).toBe("/tmp/repo/project/data/vector-store");
    expect(config.llamaCppModelDir).toBe("/tmp/repo/project/models");
    expect(config.llamaCppUri).toBe("preset:nomic-v1.5-q8");
    expect(config.embeddingContextLength).toBe(4096);
    expect(config.effectiveEmbeddingContextLength).toBe(4096);
    expect(config.embeddingModel).toBe("nomic-embed-text-v1.5.f16.gguf");
    expect(config.embeddingDimension).toBe(768);
    expect(config.resolvedLlamaCppModel.type).toBe("preset");
    expect(config.resolvedLlamaCppModel.dimension).toBe(768);
    expect(config.resolvedLlamaCppModel.contextLength).toBe(2048);
  });

  it("uses preset context length when no explicit embedding context override is set", () => {
    const config = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_LLAMA_CPP_URI: "preset:nomic-v1.5-q8",
      },
      gitBranch: null,
    });

    expect(config.embeddingContextLength).toBeNull();
    expect(config.effectiveEmbeddingContextLength).toBe(2048);
  });

  it("keeps effective embedding context null for custom models without context metadata", () => {
    const config = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_LLAMA_CPP_URI: "./models/custom-model.gguf",
      },
      gitBranch: null,
    });

    expect(config.embeddingContextLength).toBeNull();
    expect(config.effectiveEmbeddingContextLength).toBeNull();
  });

  it("classifies custom URL and local llama.cpp model URIs", () => {
    const urlConfig = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_EMBEDDING_DIM: "1024",
        LKG_LLAMA_CPP_URI: "https://example.com/models/custom-model.gguf",
      },
      gitBranch: null,
    });
    const localConfig = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_LLAMA_CPP_URI: "./models/custom-model.gguf",
      },
      gitBranch: null,
    });

    expect(urlConfig.llamaCppUri).toBe(
      "https://example.com/models/custom-model.gguf",
    );
    expect(urlConfig.embeddingDimension).toBe(1024);
    expect(urlConfig.resolvedLlamaCppModel).toMatchObject({
      contextLength: null,
      dimension: null,
      type: "url",
      url: "https://example.com/models/custom-model.gguf",
    });
    expect(localConfig.resolvedLlamaCppModel).toMatchObject({
      contextLength: null,
      dimension: null,
      localPath: "./models/custom-model.gguf",
      type: "local",
    });
  });

  it("accepts batching, splitting, and daemon startup timeout envs", () => {
    const config = loadConfig({
      cwd: "/tmp/repo/project",
      env: {
        LKG_CHUNK_TOKEN_OVERLAP: "32",
        LKG_DAEMON_STARTUP_TIMEOUT_MS: "45000",
        LKG_EMBEDDING_BATCH_SIZE: "8",
        LKG_EMBEDDING_CONTEXT_LENGTH: "4096",
        LKG_EMBEDDING_THREADS: "2",
        LKG_EMBEDDING_TOKEN_MARGIN: "128",
        LKG_FILE_SCAN_BATCH_SIZE: "20",
        LKG_INDEX_CHECKPOINT_EVERY_BATCHES: "2",
        LKG_INFERENCE_THREADS: "3",
        LKG_MAX_CHUNK_TOKENS: "512",
        LKG_MAX_SPLIT_DEPTH: "3",
        LKG_OVERSIZED_SEGMENT_POLICY: "skip",
        LKG_VECTOR_UPSERT_BATCH_SIZE: "40",
      },
      gitBranch: null,
    });

    expect(config.chunkTokenOverlap).toBe(32);
    expect(config.daemonStartupTimeoutMs).toBe(45000);
    expect(config.embeddingBatchSize).toBe(8);
    expect(config.embeddingThreads).toBe(2);
    expect(config.inferenceThreads).toBe(3);
    expect(config.embeddingTokenMargin).toBe(128);
    expect(config.fileScanBatchSize).toBe(20);
    expect(config.indexCheckpointEveryBatches).toBe(2);
    expect(config.maxChunkTokens).toBe(512);
    expect(config.maxSplitDepth).toBe(3);
    expect(config.oversizedSegmentPolicy).toBe("skip");
    expect(config.vectorUpsertBatchSize).toBe(40);
  });

  it("changes config fingerprint when batching, threading, or embedding settings change", () => {
    const baseConfig = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_HOME: "/tmp/lkg-home",
      },
      gitBranch: null,
    });
    const updatedConfig = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_EMBEDDING_THREADS: "2",
        LKG_HOME: "/tmp/lkg-home",
      },
      gitBranch: null,
    });
    const inferenceUpdatedConfig = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_INFERENCE_THREADS: "2",
        LKG_HOME: "/tmp/lkg-home",
      },
      gitBranch: null,
    });

    expect(updatedConfig.configFingerprint).not.toBe(
      baseConfig.configFingerprint,
    );
    expect(inferenceUpdatedConfig.configFingerprint).not.toBe(
      baseConfig.configFingerprint,
    );
  });

  it("accepts an explicit max file size", () => {
    const config = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_MAX_FILE_SIZE_BYTES: "2048",
      },
      gitBranch: null,
    });

    expect(config.maxFileSizeBytes).toBe(2048);
  });

  it("uses the plan log size contract in megabytes", () => {
    const config = loadConfig({
      cwd: "/repo/project",
      env: {
        LKG_LOG_MAX_FILES: "7",
        LKG_LOG_MAX_SIZE_MB: "2",
      },
      gitBranch: null,
    });

    expect(config.logMaxBytes).toBe(2 * 1024 * 1024);
    expect(config.logMaxFiles).toBe(7);
  });

  it("rejects unsupported vector providers", () => {
    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_VECTORDB_PROVIDER: "qdrant",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.UNSUPPORTED_PROVIDER,
      }),
    );
  });

  it("rejects unsupported embedding providers", () => {
    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_EMBEDDING_PROVIDER: "openai",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.UNSUPPORTED_PROVIDER,
      }),
    );
  });

  it("rejects invalid embedding and thread integer envs", () => {
    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_EMBEDDING_THREADS: "0",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.INVALID_INPUT,
      }),
    );

    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_INFERENCE_THREADS: "abc",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.INVALID_INPUT,
      }),
    );
  });

  it("rejects invalid chunking env combinations", () => {
    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_EMBEDDING_CONTEXT_LENGTH: "512",
          LKG_EMBEDDING_TOKEN_MARGIN: "512",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.INVALID_INPUT,
      }),
    );

    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_EMBEDDING_CONTEXT_LENGTH: "512",
          LKG_EMBEDDING_TOKEN_MARGIN: "64",
          LKG_MAX_CHUNK_TOKENS: "448",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.INVALID_INPUT,
      }),
    );

    expect(() =>
      loadConfig({
        cwd: "/repo/project",
        env: {
          LKG_OVERSIZED_SEGMENT_POLICY: "truncate",
        },
        gitBranch: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.INVALID_INPUT,
      }),
    );
  });
});
