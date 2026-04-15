export const ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  ALREADY_RUNNING: "ALREADY_RUNNING",
  INDEX_NOT_READY: "INDEX_NOT_READY",
  UNSUPPORTED_PROVIDER: "UNSUPPORTED_PROVIDER",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class LkgError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LkgError";
  }
}
