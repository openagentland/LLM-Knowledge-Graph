import type { DaemonRequest, DaemonResponse } from "../dto/daemon.js";

export interface DaemonClientPort {
  request<TResponse extends DaemonResponse>(
    request: DaemonRequest,
  ): Promise<TResponse>;
}
