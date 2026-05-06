import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createDaemonRegistration,
  FileDaemonRegistry,
  isDaemonLeaseExpired,
} from "./file-daemon-registry.js";

describe("FileDaemonRegistry", () => {
  it("renews leases only for the owning daemon and matching process identity", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-daemon-registry-"));
    const registry = new FileDaemonRegistry({ homeDir });
    await registry.write(
      "project-a",
      createDaemonRegistration({
        configFingerprint: "fingerprint-a",
        daemonId: "daemon-a",
        pid: 123,
        socketPath: "/tmp/lkg-a.sock",
        startedAt: new Date("2026-05-05T00:00:00.000Z"),
      }),
    );

    await expect(
      registry.renewLease(
        "project-a",
        "daemon-b",
        "/tmp/lkg-a.sock",
        123,
        new Date("2026-05-05T00:00:10.000Z"),
      ),
    ).resolves.toBe(false);
    await expect(
      registry.renewLease(
        "project-a",
        "daemon-a",
        "/tmp/other.sock",
        123,
        new Date("2026-05-05T00:00:10.000Z"),
      ),
    ).resolves.toBe(false);
    await expect(
      registry.renewLease(
        "project-a",
        "daemon-a",
        "/tmp/lkg-a.sock",
        999,
        new Date("2026-05-05T00:00:10.000Z"),
      ),
    ).resolves.toBe(false);
    expect(await registry.read("project-a")).toMatchObject({
      daemonId: "daemon-a",
      lastHeartbeatAt: "2026-05-05T00:00:00.000Z",
    });

    await expect(
      registry.renewLease(
        "project-a",
        "daemon-a",
        "/tmp/lkg-a.sock",
        123,
        new Date("2026-05-05T00:00:10.000Z"),
      ),
    ).resolves.toBe(true);
    expect(await registry.read("project-a")).toMatchObject({
      daemonId: "daemon-a",
      lastHeartbeatAt: "2026-05-05T00:00:10.000Z",
      leaseExpiresAt: "2026-05-05T00:00:40.000Z",
    });
  });

  it("deletes registrations only for the owning daemon", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lkg-daemon-registry-"));
    const registry = new FileDaemonRegistry({ homeDir });
    await registry.write(
      "project-a",
      createDaemonRegistration({
        configFingerprint: "fingerprint-a",
        daemonId: "daemon-a",
        pid: 123,
        socketPath: "/tmp/lkg-a.sock",
        startedAt: new Date("2026-05-05T00:00:00.000Z"),
      }),
    );

    await expect(registry.deleteIfOwned("project-a", "daemon-b")).resolves.toBe(
      false,
    );
    expect(await registry.read("project-a")).toMatchObject({
      daemonId: "daemon-a",
    });

    await expect(registry.deleteIfOwned("project-a", "daemon-a")).resolves.toBe(
      true,
    );
    await expect(registry.read("project-a")).resolves.toBeNull();
  });

  it("detects expired daemon leases", () => {
    const registration = createDaemonRegistration({
      configFingerprint: "fingerprint-a",
      daemonId: "daemon-a",
      pid: 123,
      socketPath: "/tmp/lkg-a.sock",
      startedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(
      isDaemonLeaseExpired(registration, new Date("2026-05-05T00:00:29.999Z")),
    ).toBe(false);
    expect(
      isDaemonLeaseExpired(registration, new Date("2026-05-05T00:00:30.000Z")),
    ).toBe(true);
  });
});
