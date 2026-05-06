import { createHash } from "node:crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DAEMON_LEASE_DURATION_MS = 30_000;

export type DaemonRegistration = {
  configFingerprint: string;
  daemonId: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  pid: number;
  socketPath: string;
  startedAt: string;
};

export class FileDaemonRegistry {
  constructor(private readonly options: { homeDir: string }) {}

  async acquireStartupLock<T>(
    activeProjectIdentity: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const lockPath = this.resolveLockPath(activeProjectIdentity);
    await mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + 5_000;

    for (;;) {
      try {
        await mkdir(lockPath);
        break;
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }

        if (Date.now() >= deadline) {
          await rm(lockPath, { force: true, recursive: true });
          continue;
        }

        await wait(25);
      }
    }

    try {
      return await work();
    } finally {
      await rmdir(lockPath).catch(() => undefined);
    }
  }

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

  async renewLease(
    activeProjectIdentity: string,
    daemonId: string,
    socketPath: string,
    pid: number,
    now = new Date(),
  ): Promise<boolean> {
    const registration = await this.read(activeProjectIdentity);
    if (
      registration?.daemonId !== daemonId ||
      registration.socketPath !== socketPath ||
      registration.pid !== pid
    ) {
      return false;
    }

    await this.write(activeProjectIdentity, {
      ...registration,
      lastHeartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(
        now.getTime() + DAEMON_LEASE_DURATION_MS,
      ).toISOString(),
    });
    return true;
  }

  async deleteIfOwned(
    activeProjectIdentity: string,
    daemonId: string,
  ): Promise<boolean> {
    const registration = await this.read(activeProjectIdentity);
    if (registration?.daemonId !== daemonId) {
      return false;
    }

    await this.delete(activeProjectIdentity);
    return true;
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

  private resolveLockPath(activeProjectIdentity: string): string {
    return resolve(
      this.options.homeDir,
      "daemon",
      `${activeProjectIdentity}.startup.lock`,
    );
  }
}

export function createDaemonRegistration(input: {
  configFingerprint: string;
  daemonId: string;
  pid: number;
  socketPath: string;
  startedAt?: Date;
}): DaemonRegistration {
  const startedAt = input.startedAt ?? new Date();
  return {
    configFingerprint: input.configFingerprint,
    daemonId: input.daemonId,
    lastHeartbeatAt: startedAt.toISOString(),
    leaseExpiresAt: new Date(
      startedAt.getTime() + DAEMON_LEASE_DURATION_MS,
    ).toISOString(),
    pid: input.pid,
    socketPath: input.socketPath,
    startedAt: startedAt.toISOString(),
  };
}

export function isDaemonLeaseExpired(
  registration: DaemonRegistration,
  now = new Date(),
): boolean {
  return Date.parse(registration.leaseExpiresAt) <= now.getTime();
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}
