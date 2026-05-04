import { describe, expect, it, vi } from "vitest";

const { createEmbeddingContextMock, ensureModelFileMock, getLlamaMock, loadModelMock } = vi.hoisted(() => ({
  createEmbeddingContextMock: vi.fn(),
  ensureModelFileMock: vi.fn(),
  getLlamaMock: vi.fn(),
  loadModelMock: vi.fn(),
}));

vi.mock("./download-model.js", () => ({
  ensureModelFile: ensureModelFileMock,
  resolveModelDownloadFilename: vi.fn(
    (url: string) => `derived-${url.split("/").pop() ?? "model.gguf"}`,
  ),
}));

vi.mock("node-llama-cpp", () => ({
  getLlama: getLlamaMock,
}));

import { LlamaCppEmbeddingAdapter } from "./llama-cpp-embedding-adapter.js";

describe("LlamaCppEmbeddingAdapter", () => {
  it("downloads preset models via ensureModelFile", async () => {
    createEmbeddingContextMock.mockReset();
    createEmbeddingContextMock.mockResolvedValue({
      getEmbeddingFor: vi.fn().mockResolvedValue({ vector: [0.1, 0.2] }),
    });
    loadModelMock.mockReset();
    loadModelMock.mockResolvedValue({
      createEmbeddingContext: createEmbeddingContextMock,
    });
    getLlamaMock.mockReset();
    getLlamaMock.mockResolvedValue({ loadModel: loadModelMock });
    ensureModelFileMock.mockReset();
    ensureModelFileMock.mockResolvedValue("/tmp/models/preset.gguf");

    const adapter = new LlamaCppEmbeddingAdapter({
      modelDir: "/tmp/models",
      resolvedModel: {
        contextLength: 2048,
        dimension: 768,
        preset: {
          contextLength: 2048,
          dimension: 768,
          downloadUrl: "https://example.com/preset.gguf",
          filename: "preset.gguf",
        },
        type: "preset",
      },
      threads: 2,
    });

    await adapter.embedQuery("hello");

    expect(ensureModelFileMock).toHaveBeenCalledWith({
      logger: undefined,
      modelDir: "/tmp/models",
      source: {
        downloadUrl: "https://example.com/preset.gguf",
        filename: "preset.gguf",
      },
    });
    expect(getLlamaMock).toHaveBeenCalledWith({
      maxThreads: 2,
    });
    expect(loadModelMock).toHaveBeenCalledWith({
      modelPath: "/tmp/models/preset.gguf",
    });
  });

  it("downloads custom URL models instead of throwing", async () => {
    createEmbeddingContextMock.mockReset();
    createEmbeddingContextMock.mockResolvedValue({
      getEmbeddingFor: vi.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
    });
    loadModelMock.mockReset();
    loadModelMock.mockResolvedValue({
      createEmbeddingContext: createEmbeddingContextMock,
    });
    getLlamaMock.mockReset();
    getLlamaMock.mockResolvedValue({ loadModel: loadModelMock });
    ensureModelFileMock.mockReset();
    ensureModelFileMock.mockResolvedValue("/tmp/models/derived-custom.gguf");

    const adapter = new LlamaCppEmbeddingAdapter({
      dimension: 3,
      modelDir: "/tmp/models",
      resolvedModel: {
        contextLength: null,
        dimension: null,
        type: "url",
        url: "https://example.com/models/custom.gguf",
      },
      threads: 3,
    });

    const result = await adapter.embedQuery("hello");

    expect(ensureModelFileMock).toHaveBeenCalledWith({
      logger: undefined,
      modelDir: "/tmp/models",
      source: {
        downloadUrl: "https://example.com/models/custom.gguf",
        filename: "derived-custom.gguf",
      },
    });
    expect(loadModelMock).toHaveBeenCalledWith({
      modelPath: "/tmp/models/derived-custom.gguf",
    });
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("still requires explicit dimension for custom URL models", async () => {
    const adapter = new LlamaCppEmbeddingAdapter({
      modelDir: "/tmp/models",
      resolvedModel: {
        contextLength: null,
        dimension: null,
        type: "url",
        url: "https://example.com/models/custom.gguf",
      },
      threads: 1,
    });

    await expect(adapter.embedQuery("hello")).rejects.toThrow(
      /Embedding dimension is required when using a custom model URL or local path/,
    );
  });

  it("uses local model paths directly", async () => {
    createEmbeddingContextMock.mockReset();
    createEmbeddingContextMock.mockResolvedValue({
      getEmbeddingFor: vi.fn().mockResolvedValue({ vector: [0.4, 0.5] }),
    });
    loadModelMock.mockReset();
    loadModelMock.mockResolvedValue({
      createEmbeddingContext: createEmbeddingContextMock,
    });
    getLlamaMock.mockReset();
    getLlamaMock.mockResolvedValue({ loadModel: loadModelMock });
    ensureModelFileMock.mockReset();

    const adapter = new LlamaCppEmbeddingAdapter({
      dimension: 2,
      modelDir: "/tmp/models",
      resolvedModel: {
        contextLength: null,
        dimension: null,
        localPath: "/models/local.gguf",
        type: "local",
      },
      threads: 4,
    });

    await adapter.embedQuery("hello");

    expect(ensureModelFileMock).not.toHaveBeenCalled();
    expect(loadModelMock).toHaveBeenCalledWith({
      modelPath: "/models/local.gguf",
    });
  });
});
