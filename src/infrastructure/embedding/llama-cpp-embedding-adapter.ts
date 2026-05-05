import type { LlamaEmbeddingContext, LlamaModel } from "node-llama-cpp";

import {
  ensureModelFile,
  resolveModelDownloadFilename,
} from "./download-model.js";
import type {
  EmbedChunkInput,
  EmbeddingPort,
  EmbeddingResult,
} from "../../application/ports/embedding-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { ResolvedLlamaCppModel } from "../config/resolve-llama-cpp-model.js";

type LlamaVector = Iterable<number> | ArrayLike<number>;

export class LlamaCppEmbeddingAdapter implements EmbeddingPort {
  private model: LlamaModel | null = null;
  private context: LlamaEmbeddingContext | null = null;

  constructor(
    private readonly options: {
      dimension?: number | null;
      logger?: LoggerPort;
      modelDir: string;
      resolvedModel: ResolvedLlamaCppModel;
      threads: number;
    },
  ) {}

  async embedChunks(inputs: EmbedChunkInput[]): Promise<EmbeddingResult[]> {
    const dimension = this.getDimension();
    const ctx = await this.ensureContext();
    const results: EmbeddingResult[] = [];
    for (const input of inputs) {
      const vector = await this.getEmbedding(ctx, input.content, dimension);
      results.push({
        contentHash: input.contentHash,
        evidenceId: input.evidenceId,
        path: input.path,
        sourceType: input.sourceType,
        vector,
      });
    }
    return results;
  }

  async embedQuery(input: string): Promise<number[]> {
    const dimension = this.getDimension();
    const ctx = await this.ensureContext();
    return this.getEmbedding(ctx, input, dimension);
  }

  private getDimension(): number {
    if (
      this.options.dimension !== null &&
      this.options.dimension !== undefined
    ) {
      return this.options.dimension;
    }

    if (this.options.resolvedModel.type === "preset") {
      return this.options.resolvedModel.preset.dimension;
    }

    if (this.options.resolvedModel.dimension !== null) {
      return this.options.resolvedModel.dimension;
    }

    throw new LkgError(
      ERROR_CODES.INVALID_INPUT,
      "Embedding dimension is required when using a custom model URL or local path.",
      {
        modelType: this.options.resolvedModel.type,
        setting: "LKG_EMBEDDING_DIM",
      },
    );
  }

  private async ensureContext(): Promise<LlamaEmbeddingContext> {
    if (this.context !== null) {
      return this.context;
    }

    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama({
      maxThreads: this.options.threads,
    });

    const modelPath = await this.resolveModelPath();
    this.options.logger?.info("Loading embedding model", {
      event: "model.load",
      path: modelPath,
    });

    this.model = await llama.loadModel({ modelPath });
    this.context = await this.model.createEmbeddingContext();
    return this.context;
  }

  private async resolveModelPath(): Promise<string> {
    const resolved = this.options.resolvedModel;

    if (resolved.type === "preset") {
      return ensureModelFile({
        logger: this.options.logger,
        modelDir: this.options.modelDir,
        source: {
          downloadUrl: resolved.preset.downloadUrl,
          filename: resolved.preset.filename,
        },
      });
    }

    if (resolved.type === "url") {
      return ensureModelFile({
        logger: this.options.logger,
        modelDir: this.options.modelDir,
        source: {
          downloadUrl: resolved.url,
          filename: resolveModelDownloadFilename(resolved.url),
        },
      });
    }

    return resolved.localPath;
  }

  private async getEmbedding(
    ctx: LlamaEmbeddingContext,
    text: string,
    dimension: number,
  ): Promise<number[]> {
    const embedding = await ctx.getEmbeddingFor(text);
    const vector = Array.from(embedding.vector as LlamaVector);
    if (vector.length === dimension) {
      return [...vector];
    }

    if (vector.length > dimension) {
      return vector.slice(0, dimension);
    }

    const padded: number[] = new Array<number>(dimension).fill(0);
    for (let i = 0; i < vector.length; i += 1) {
      padded[i] = vector[i];
    }
    return padded;
  }
}
