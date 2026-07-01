import { ERROR_CODE_STATUS, type ErrorCode } from "@jobtext/shared";
import type { Context } from "hono";

/**
 * SPEC §7 error envelope: `{ error: { code, message } }` with the stable
 * HTTP status defined for each code.
 */
export function errorResponse(c: Context, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, ERROR_CODE_STATUS[code]);
}
