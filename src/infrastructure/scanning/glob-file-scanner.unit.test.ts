import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GlobFileScanner } from "./glob-file-scanner.js";

describe("GlobFileScanner", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
    );
    tempDirs.length = 0;
  });

  it("skips oversized lockfiles as too_large when skip policy is enabled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "glob-file-scanner-"));
    tempDirs.push(cwd);
    await writeFile(join(cwd, ".gitignore"), "", "utf8");
    await writeFile(join(cwd, "package-lock.json"), "x".repeat(128), "utf8");

    const scanner = new GlobFileScanner({
      cwd,
      gitignore: "",
      maxFileSizeBytes: 16,
      skipOversizedFiles: true,
    });

    const result = await scanner.scan();

    expect(result.candidates).toEqual([]);
    expect(result.skipped).toContainEqual({
      path: "package-lock.json",
      reason: "too_large",
    });
  });

  it("keeps oversized docs indexable when skip policy is enabled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "glob-file-scanner-"));
    tempDirs.push(cwd);
    await writeFile(join(cwd, ".gitignore"), "", "utf8");
    await writeFile(join(cwd, "architecture.md"), "x".repeat(128), "utf8");

    const scanner = new GlobFileScanner({
      cwd,
      gitignore: "",
      maxFileSizeBytes: 16,
      skipOversizedFiles: true,
    });

    const result = await scanner.scan();

    expect(result.skipped).not.toContainEqual({
      path: "architecture.md",
      reason: "too_large",
    });
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        artifactKind: "doc",
        path: "architecture.md",
        sourceType: "doc",
      }),
    );
  });

  it("applies .lkgignore patterns in addition to .gitignore", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "glob-file-scanner-"));
    tempDirs.push(cwd);
    await writeFile(join(cwd, ".gitignore"), "", "utf8");
    await writeFile(join(cwd, ".lkgignore"), "package-lock.json\n", "utf8");
    await writeFile(join(cwd, "package-lock.json"), "{}", "utf8");
    await writeFile(join(cwd, "main.ts"), "export const ok = true;\n", "utf8");

    const scanner = new GlobFileScanner({
      cwd,
      gitignore: "",
      lkgignore: "package-lock.json\n",
      maxFileSizeBytes: 1024,
      skipOversizedFiles: false,
    });

    const result = await scanner.scan();

    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        path: "main.ts",
      }),
    );
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({
        path: "package-lock.json",
      }),
    );
    expect(result.skipped).toContainEqual({
      path: "package-lock.json",
      reason: "ignored",
    });
  });
});
