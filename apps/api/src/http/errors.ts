import { ERROR_CODE_STATUS, type ErrorCode } from "@jobtext/shared";
import type { Context } from "hono";

/**
 * SPEC §7 error envelope: `{ error: { code, message } }` with the stable
 * HTTP status defined for each code. The full code→status map lives in
 * @jobtext/shared (`ERROR_CODE_STATUS`) as the single source of truth.
 */
export function errorResponse(c: Context, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, ERROR_CODE_STATUS[code]);
}

/**
 * Throwable form of the SPEC §7 envelope for code that cannot return a
 * Response directly (helpers such as cursor decoding). The app's `onError`
 * hook translates it into the envelope with the mapped status.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
