import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getLlamaMock, loadModelMock } = vi.hoisted(() => ({
  getLlamaMock: vi.fn(),
  loadModelMock: vi.fn(),
}));

vi.mock("node-llama-cpp", () => ({
  getLlama: getLlamaMock,
}));

import { resolveLlamaCppModel } from "../../src/infrastructure/config/resolve-llama-cpp-model.js";
import { resolveModelDownloadFilename } from "../../src/infrastructure/embedding/download-model.js";
import { LlamaCppEmbeddingAdapter } from "../../src/infrastructure/embedding/llama-cpp-embedding-adapter.js";

describe("Custom URL model download integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a custom URL model once and reuses the cached file", async () => {
    const modelPayload = Buffer.from("fake-gguf-model");
    let requestCount = 0;

    const server = createServer((request, response) => {
      if (request.url !== "/models/custom.gguf") {
        response.statusCode = 404;
        response.end();
        return;
      }

      requestCount += 1;
      response.statusCode = 200;
      response.setHeader("content-type", "application/octet-stream");
      response.end(modelPayload);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected an ephemeral TCP address");
      }

      const modelUrl = `http://127.0.0.1:${address.port}/models/custom.gguf`;
      const modelDir = await mkdtemp(join(tmpdir(), "lkg-custom-url-model-"));
      const expectedFilename = resolveModelDownloadFilename(modelUrl);
      const expectedPath = join(modelDir, expectedFilename);
      const createEmbeddingContext = vi.fn().mockResolvedValue({
        getEmbeddingFor: vi.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
      });

      loadModelMock.mockReset();
      loadModelMock.mockResolvedValue({ createEmbeddingContext });
      getLlamaMock.mockReset();
      getLlamaMock.mockResolvedValue({ loadModel: loadModelMock });

      const firstAdapter = new LlamaCppEmbeddingAdapter({
        dimension: 3,
        modelDir,
        resolvedModel: resolveLlamaCppModel(modelUrl),
      });
      const secondAdapter = new LlamaCppEmbeddingAdapter({
        dimension: 3,
        modelDir,
        resolvedModel: resolveLlamaCppModel(modelUrl),
      });

      await firstAdapter.embedQuery("hello");
      await secondAdapter.embedQuery("hello again");

      expect(requestCount).toBe(1);
      expect(loadModelMock).toHaveBeenCalledTimes(2);
      expect(loadModelMock).toHaveBeenNthCalledWith(1, {
        modelPath: expectedPath,
      });
      expect(loadModelMock).toHaveBeenNthCalledWith(2, {
        modelPath: expectedPath,
      });
      expect(await readFile(expectedPath)).toEqual(modelPayload);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
