import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureModelFile,
  resolveModelDownloadFilename,
} from "./download-model.js";

describe("download-model", () => {
  it("derives deterministic filenames for custom URLs", () => {
    const first = resolveModelDownloadFilename(
      "https://example.com/models/custom-model.gguf?download=1",
    );
    const second = resolveModelDownloadFilename(
      "https://example.com/models/custom-model.gguf?download=1",
    );
    const different = resolveModelDownloadFilename(
      "https://example.com/other/custom-model.gguf?download=2",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^custom-model-[a-f0-9]{12}\.gguf$/);
    expect(different).not.toBe(first);
  });

  it("falls back to a hashed gguf filename when URL has no basename", () => {
    expect(resolveModelDownloadFilename("https://example.com/")).toMatch(
      /^model-[a-f0-9]{12}\.gguf$/,
    );
  });

  it("reuses an existing non-empty model file", async () => {
    const modelDir = await mkdtemp(join(tmpdir(), "lkg-download-model-"));
    const filename = "existing-model.gguf";
    const existingPath = join(modelDir, filename);

    await writeFile(existingPath, "existing-model", "utf8");

    const resolvedPath = await ensureModelFile({
      modelDir,
      source: {
        downloadUrl: "https://example.com/models/existing-model.gguf",
        filename,
      },
    });

    expect(resolvedPath).toBe(existingPath);
    expect(await readFile(existingPath, "utf8")).toBe("existing-model");
  });
});
