import { describe, expect, it } from "vitest";

import { resolveLlamaCppModel } from "./resolve-llama-cpp-model.js";

describe("resolveLlamaCppModel", () => {
  it("resolves preset URIs", () => {
    expect(resolveLlamaCppModel("preset:nomic-v1.5-q8")).toMatchObject({
      contextLength: 2048,
      dimension: 768,
      type: "preset",
    });
  });

  it("rejects unknown presets", () => {
    expect(() => resolveLlamaCppModel("preset:missing")).toThrow(
      /Unknown llama.cpp preset "missing"/,
    );
  });

  it("classifies custom URLs", () => {
    expect(resolveLlamaCppModel("https://example.com/model.gguf")).toEqual({
      contextLength: null,
      dimension: null,
      type: "url",
      url: "https://example.com/model.gguf",
    });
  });

  it("classifies local paths", () => {
    expect(resolveLlamaCppModel("./models/model.gguf")).toEqual({
      contextLength: null,
      dimension: null,
      localPath: "./models/model.gguf",
      type: "local",
    });
  });
});
