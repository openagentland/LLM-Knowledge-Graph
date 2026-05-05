import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import {
  LLAMA_CPP_PRESETS,
  getPreset,
  type LlamaCppPreset,
} from "../embedding/llama-cpp-presets.js";

export type ResolvedLlamaCppModel =
  | {
      contextLength: number;
      dimension: number;
      preset: LlamaCppPreset;
      type: "preset";
    }
  | {
      contextLength: number | null;
      dimension: number | null;
      localPath: string;
      type: "local";
    }
  | {
      contextLength: number | null;
      dimension: number | null;
      type: "url";
      url: string;
    };

const PRESET_PREFIX = "preset:";

export function resolveLlamaCppModel(uri: string): ResolvedLlamaCppModel {
  if (uri.startsWith(PRESET_PREFIX)) {
    const id = uri.slice(PRESET_PREFIX.length);
    const preset = getPreset(id);
    if (preset === undefined) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        `Unknown llama.cpp preset "${id}".`,
        {
          availablePresets: Object.keys(LLAMA_CPP_PRESETS),
          preset: id,
        },
      );
    }
    return {
      contextLength: preset.contextLength,
      dimension: preset.dimension,
      preset,
      type: "preset",
    };
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return { contextLength: null, dimension: null, type: "url", url: uri };
  }

  return {
    contextLength: null,
    dimension: null,
    localPath: uri,
    type: "local",
  };
}
