import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OverlaySnapshot } from "../../application/dto/overlay.js";
import type { OverlayStorePort } from "../../application/ports/overlay-store-port.js";

const EMPTY_OVERLAY_SNAPSHOT: OverlaySnapshot = {
  records: [],
};

export class FileOverlayRepository implements OverlayStorePort {
  constructor(
    private readonly options: {
      homeDir: string;
      indexScope: string;
      projectIdentity: string;
    },
  ) {}

  async clear(): Promise<void> {
    await rm(this.resolvePath(), { force: true });
  }

  async read(): Promise<OverlaySnapshot> {
    try {
      const content = await readFile(this.resolvePath(), "utf8");
      return JSON.parse(content) as OverlaySnapshot;
    } catch {
      return EMPTY_OVERLAY_SNAPSHOT;
    }
  }

  async replace(snapshot: OverlaySnapshot): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  private resolvePath(): string {
    return resolve(
      this.options.homeDir,
      "overlays",
      this.options.projectIdentity,
      `${this.options.indexScope}.json`,
    );
  }
}
