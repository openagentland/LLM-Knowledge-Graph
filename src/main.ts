#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 John Martin

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createDaemonClient, composeMainLogger } from "./compose.js";
import { ensureDaemonRunning } from "./infrastructure/daemon/ensure-daemon-running.js";
import { installProcessHandlers } from "./infrastructure/runtime/install-process-handlers.js";
import { createMcpServer } from "./presentation/mcp-server.js";

export async function main(): Promise<void> {
  const cwd = process.cwd();
  const { config, logger } = composeMainLogger({ cwd });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received shutdown signal", {
      event: "process.signal",
      signal,
    });
    logger.info("Shutting down MCP server", {
      event: "process.shutdown",
      signal,
    });
    process.exit(0);
  };

  installProcessHandlers(logger, shutdown);

  const { socketPath } = await ensureDaemonRunning({
    config,
    cwd,
    logger,
  });
  const daemonClient = createDaemonClient({ socketPath });
  const server = createMcpServer({
    daemonClient,
    logger,
  });
  const transport = new StdioServerTransport();

  logger.info("Starting MCP server", {
    event: "process.startup",
    logMode: config.logMode,
  });

  await server.connect(transport);

  logger.info("Connected MCP server", {
    event: "process.startup",
    watcherState: config.watcherState,
  });
}

if (wasExecutedDirectly(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "runtime.error",
        level: "error",
        message: "MCP server failed before logger initialization completed",
        metadata: {
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : JSON.stringify(error),
        },
        timestamp: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    process.exit(1);
  });
}

function wasExecutedDirectly(
  moduleUrl: string,
  argvPath: string | undefined,
): boolean {
  if (argvPath === undefined || argvPath.length === 0) {
    return false;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}
