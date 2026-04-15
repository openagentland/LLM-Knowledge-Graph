import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type DaemonRegistration = {
  configFingerprint: string;
  pid: number;
  socketPath: string;
  startedAt: string;
};

export class FileDaemonRegistry {
  constructor(private readonly options: { homeDir: string }) {}

  async read(
    activeProjectIdentity: string,
  ): Promise<DaemonRegistration | null> {
    try {
      const content = await readFile(
        this.resolvePath(activeProjectIdentity),
        "utf8",
      );
      return JSON.parse(content) as DaemonRegistration;
    } catch {
      return null;
    }
  }

  async write(
    activeProjectIdentity: string,
    registration: DaemonRegistration,
  ): Promise<void> {
    const filePath = this.resolvePath(activeProjectIdentity);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(registration, null, 2)}\n`,
      "utf8",
    );
  }

  async delete(activeProjectIdentity: string): Promise<void> {
    await rm(this.resolvePath(activeProjectIdentity), { force: true });
  }

  resolveSocketPath(activeProjectIdentity: string): string {
    const token = createHash("sha256")
      .update(activeProjectIdentity)
      .digest("hex")
      .slice(0, 16);

    return resolve(this.options.homeDir, "daemon", `${token}.sock`);
  }

  private resolvePath(activeProjectIdentity: string): string {
    return resolve(
      this.options.homeDir,
      "daemon",
      `${activeProjectIdentity}.json`,
    );
  }
}
