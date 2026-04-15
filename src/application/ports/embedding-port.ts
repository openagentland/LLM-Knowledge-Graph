export type EmbedChunkInput = {
  content: string;
  contentHash: string;
  evidenceId: string;
  path: string;
  sourceType: "code" | "doc";
};

export type EmbeddingResult = {
  contentHash: string;
  evidenceId: string;
  path: string;
  sourceType: "code" | "doc";
  vector: number[];
};

export interface EmbeddingPort {
  embedChunks(inputs: EmbedChunkInput[]): Promise<EmbeddingResult[]>;
  embedQuery(input: string): Promise<number[]>;
}
