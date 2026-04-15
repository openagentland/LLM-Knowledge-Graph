import { createHash } from "node:crypto";

import type {
  EmbedChunkInput,
  EmbeddingPort,
  EmbeddingResult,
} from "../../src/application/ports/embedding-port.js";

export class DeterministicEmbedding implements EmbeddingPort {
  embedChunks(inputs: EmbedChunkInput[]): Promise<EmbeddingResult[]> {
    return Promise.resolve(
      inputs.map((input) => ({
        contentHash: input.contentHash,
        evidenceId: input.evidenceId,
        path: input.path,
        sourceType: input.sourceType,
        vector: buildDeterministicVector(input.content),
      })),
    );
  }

  embedQuery(input: string): Promise<number[]> {
    return Promise.resolve(buildDeterministicVector(input));
  }
}

export function buildDeterministicVector(content: string): number[] {
  const digest = createHash("sha256").update(content).digest();
  return Array.from({ length: 16 }, (_, index) => (digest[index] ?? 0) / 255);
}
