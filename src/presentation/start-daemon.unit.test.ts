import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

const {
  composeDaemonHandlerMock,
  composeMainLoggerMock,
  createServerMock,
  mkdirMock,
  rmMock,
} = vi.hoisted(() => ({
  composeDaemonHandlerMock: vi.fn(),
  composeMainLoggerMock: vi.fn(),
  createServerMock: vi.fn(),
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
}));

vi.mock("node:net", () => ({
  createServer: createServerMock,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  rm: rmMock,
}));

vi.mock("../main.js", () => ({
  composeDaemonHandler: composeDaemonHandlerMock,
  composeMainLogger: composeMainLoggerMock,
}));

import type { DaemonRequestHandler } from "./start-daemon.js";
import { startDaemon, startDaemonServer } from "./start-daemon.js";
import { ERROR_CODES, LkgError } from "../shared/errors/lkg-error.js";

type MockSocket = EventEmitter & {
  setEncoding: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

type MockServer = EventEmitter & {
  close: ReturnType<typeof vi.fn>;
  listen: ReturnType<typeof vi.fn>;
  socketHandler?: (socket: MockSocket) => void;
};

type HandleMock = ReturnType<typeof vi.fn<DaemonRequestHandler["handle"]>>;

type MockSocketHandler = (socket: MockSocket) => void;

function createLogger() {
  return {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.setEncoding = vi.fn();
  socket.write = vi.fn();
  return socket;
}

function createServer(): MockServer {
  const server = new EventEmitter() as MockServer;
  server.close = vi.fn();
  server.listen = vi.fn((socketPath: string, callback: () => void) => {
    callback();
    return server;
  });
  return server;
}

function createHandler(overrides: Partial<DaemonRequestHandler> = {}): DaemonRequestHandler {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    handle: vi.fn().mockResolvedValue({ runtimeState: "ready", type: "health.check" }),
    ...overrides,
  };
}

describe("start-daemon", () => {
  const originalEnv = process.env.LKG_DAEMON_SOCKET_PATH;
  const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LKG_DAEMON_SOCKET_PATH;
    } else {
      process.env.LKG_DAEMON_SOCKET_PATH = originalEnv;
    }
    vi.clearAllMocks();
  });

  it("rejects when LKG_DAEMON_SOCKET_PATH is missing or blank", async () => {
    delete process.env.LKG_DAEMON_SOCKET_PATH;
    await expect(startDaemon()).rejects.toThrow(
      "LKG_DAEMON_SOCKET_PATH is required for daemon mode.",
    );

    process.env.LKG_DAEMON_SOCKET_PATH = "   ";
    await expect(startDaemon()).rejects.toThrow(
      "LKG_DAEMON_SOCKET_PATH is required for daemon mode.",
    );
  });

  it("fails readiness when the daemon does not become ready after binding", async () => {
    const server = createServer();
    createServerMock.mockImplementation((handler: MockSocketHandler) => {
      server.socketHandler = handler;
      return server;
    });
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);

    const logger = createLogger();
    const readinessHandle: HandleMock = vi.fn();
    readinessHandle.mockResolvedValue({ runtimeState: "warming", type: "health.check" });
    const handler = createHandler({
      handle: readinessHandle,
    });

    await expect(
      startDaemonServer({
        handler,
        logger,
        socketPath: "/tmp/lkg.sock",
      }),
    ).rejects.toThrow("LKG daemon failed its readiness check after binding the socket.");

    expect(mkdirMock).toHaveBeenCalledWith("/tmp", { recursive: true });
    expect(rmMock).toHaveBeenCalledWith("/tmp/lkg.sock", { force: true });
    expect(processOnSpy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("writes a structured wire error when request handling throws LkgError", async () => {
    const server = createServer();
    createServerMock.mockImplementation((handler: MockSocketHandler) => {
      server.socketHandler = handler;
      return server;
    });
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);

    const logger = createLogger();
    const lkgErrorHandle: HandleMock = vi.fn();
    lkgErrorHandle.mockResolvedValueOnce({ runtimeState: "ready", type: "health.check" });
    lkgErrorHandle.mockRejectedValueOnce(
      new LkgError(ERROR_CODES.INVALID_INPUT, "Bad request", { field: "query" }),
    );
    const handler = createHandler({
      handle: lkgErrorHandle,
    });

    await startDaemonServer({
      handler,
      logger,
      socketPath: "/tmp/lkg.sock",
    });

    const socket = createSocket();
    server.socketHandler?.(socket);
    socket.emit("data", '{"type":"status"}\n');
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith("Failed daemon request", {
      error: "Bad request",
      event: "daemon.request_failed",
    });
    expect(socket.write).toHaveBeenCalledWith(
      `${JSON.stringify({
        error: {
          code: ERROR_CODES.INVALID_INPUT,
          details: { field: "query" },
          message: "Bad request",
        },
        ok: false,
      })}\n`,
      "utf8",
    );
  });

  it("maps unexpected request failures to INTERNAL_ERROR wire responses", async () => {
    const server = createServer();
    createServerMock.mockImplementation((handler: MockSocketHandler) => {
      server.socketHandler = handler;
      return server;
    });
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);

    const logger = createLogger();
    const unknownErrorHandle: HandleMock = vi.fn();
    unknownErrorHandle.mockResolvedValueOnce({ runtimeState: "ready", type: "health.check" });
    unknownErrorHandle.mockRejectedValueOnce(new Error("boom"));
    const handler = createHandler({
      handle: unknownErrorHandle,
    });

    await startDaemonServer({
      handler,
      logger,
      socketPath: "/tmp/lkg.sock",
    });

    const socket = createSocket();
    server.socketHandler?.(socket);
    socket.emit("data", '{"type":"status"}\n');
    await Promise.resolve();

    expect(socket.write).toHaveBeenCalledWith(
      `${JSON.stringify({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "boom",
        },
        ok: false,
      })}\n`,
      "utf8",
    );
  });
});
