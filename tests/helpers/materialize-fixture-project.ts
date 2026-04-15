import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function materializeFixtureProject(name: string): Promise<string> {
  const helpersDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(helpersDir, "../..");
  const sourceDir = resolve(projectRoot, "tests/fixtures/projects", name);
  const targetDir = await mkdtemp(resolve(tmpdir(), `lkg-fixture-${name}-`));

  await cp(sourceDir, targetDir, { recursive: true });

  return targetDir;
}
