import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileOverlayRepository } from "./file-overlay-repository.js";

describe("FileOverlayRepository", () => {
  it("persists and reads overlay snapshots", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-overlay-"));
    const repository = new FileOverlayRepository({
      homeDir,
      indexScope: "shared",
      projectIdentity: "project-a",
    });

    await repository.replace({
      records: [
        {
          edges: [],
          generatedAt: "2026-05-04T00:00:00.000Z",
          kind: "cfg",
          nodes: [],
          version: "milestone-4.1",
        },
      ],
    });

    await expect(repository.read()).resolves.toEqual({
      records: [
        expect.objectContaining({ kind: "cfg", version: "milestone-4.1" }),
      ],
    });
    const raw = await readFile(
      join(homeDir, "overlays", "project-a", "shared.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toMatchObject({
      records: [expect.objectContaining({ kind: "cfg" })],
    });
  });
});
