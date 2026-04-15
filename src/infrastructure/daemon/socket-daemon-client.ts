import { createConnection } from "node:net";

import type {
  DaemonRequest,
  DaemonResponse,
} from "../../application/dto/daemon.js";
import type { DaemonClientPort } from "../../application/ports/daemon-client-port.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";

type DaemonErrorPayload = {
  code: string;
  details?: Record<string, unknown>;
  message: string;
};

type DaemonWireResponse =
  | {
      ok: true;
      response: DaemonResponse;
    }
  | {
      error: DaemonErrorPayload;
      ok: false;
    };

export class SocketDaemonClient implements DaemonClientPort {
  constructor(private readonly options: { socketPath: string }) {}

  async request<TResponse extends DaemonResponse>(
    request: DaemonRequest,
  ): Promise<TResponse> {
    return this.requestOnce<TResponse>(request);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.requestOnce<
        Extract<DaemonResponse, { type: "health.check" }>
      >({
        type: "health.check",
      });
      return response.runtimeState === "ready";
    } catch {
      return false;
    }
  }

  private async requestOnce<TResponse extends DaemonResponse>(
    request: DaemonRequest,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      const socket = createConnection(this.options.socketPath);
      let buffer = "";
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        callback();
      };

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`, "utf8");
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          return;
        }

        const payload = JSON.parse(line) as DaemonWireResponse;
        if (!payload.ok) {
          finish(() => {
            reject(
              new LkgError(
                payload.error
                  .code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
                payload.error.message,
                payload.error.details,
              ),
            );
          });
          return;
        }

        finish(() => {
          resolve(payload.response as TResponse);
        });
      });
      socket.on("error", (error) => {
        finish(() => {
          reject(
            new LkgError(
              ERROR_CODES.INTERNAL_ERROR,
              "Failed to communicate with LKG daemon.",
              {
                cause: error.message,
                socketPath: this.options.socketPath,
              },
            ),
          );
        });
      });
      socket.on("end", () => {
        if (settled) {
          return;
        }

        finish(() => {
          reject(
            new LkgError(
              ERROR_CODES.INTERNAL_ERROR,
              "LKG daemon closed the connection unexpectedly.",
              {
                socketPath: this.options.socketPath,
              },
            ),
          );
        });
      });
    });
  }
}
