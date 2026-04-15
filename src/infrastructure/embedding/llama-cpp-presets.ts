export type LlamaCppPreset = {
  readonly contextLength: number;
  readonly dimension: number;
  readonly downloadUrl: string;
  readonly filename: string;
  readonly sha256?: string;
};

export const LLAMA_CPP_PRESETS: Readonly<Record<string, LlamaCppPreset>> = {
  "nomic-v1.5": {
    contextLength: 2048,
    dimension: 768,
    downloadUrl:
      "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf",
    filename: "nomic-embed-text-v1.5.Q8_0.gguf",
  },
};

export function getPreset(id: string): LlamaCppPreset | undefined {
  return LLAMA_CPP_PRESETS[id];
}
