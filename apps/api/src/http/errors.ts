import {
  ERROR_CODE_STATUS,
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_STATUS,
  type ErrorCode,
} from "@loonext/shared";
import type { Context } from "hono";

/**
 * SPEC §7 error envelope: `{ error: { code, message } }` with an optional
 * catalogue reference for clients that can localize the specific sentence.
 * The full code→status map lives in @loonext/shared (`ERROR_CODE_STATUS`) as
 * the single source of truth.
 */
export interface ErrorMessageReference {
  key: string;
  vars?: Record<string, string>;
}

export function errorResponse(
  c: Context,
  code: ErrorCode,
  message: string,
  reference?: ErrorMessageReference,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(reference
          ? {
              message_key: reference.key,
              ...(reference.vars ? { message_vars: reference.vars } : {}),
            }
          : {}),
      },
    },
    ERROR_CODE_STATUS[code],
  );
}

/**
 * What an unhandled throw becomes for the CLIENT (#251).
 *
 * Shared so the test harness and the real app cannot answer differently. They
 * did: `buildTestApp` carried its own simplified `onError`, so every route
 * suite in this repo ran against a handler with neither the CORS re-echo nor
 * the request id, and no route test could observe what production actually
 * returns. A guard written against that double passes while asserting nothing.
 *
 * Two things beyond the envelope, and both exist for the same reason — an
 * outage the customer cannot read is an outage they will misdiagnose:
 *
 *  - **The origin is re-echoed.** A thrown error unwinds past the CORS
 *    middleware, so without this the browser reports a "CORS error" and hides
 *    the real 5xx. That has happened here, against a cold-isolate 1101. Only an
 *    ALLOWED origin is echoed: this is a fix for a masked failure, not a
 *    relaxation.
 *  - **The Cloudflare ray is returned** as `request_id`, so a founder can jump
 *    from a customer's failed request to the exact log line and Sentry event
 *    rather than grepping by timestamp mid-incident.
 *
 * Observability (Sentry, the server log) stays at the call site: it needs the
 * env and it is the half a test must not perform.
 */
export function internalErrorResponse(
  c: Context,
  allowedOrigins: readonly (string | undefined)[],
) {
  try {
    const origin = c.req.header("origin");
    if (origin && allowedOrigins.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
  } catch {
    // Never let the error handler throw. The envelope below still ships; the
    // client simply cannot read it cross-origin.
  }
  const rayId = c.req.header("cf-ray") ?? undefined;
  return c.json(
    {
      error: {
        code: INTERNAL_ERROR_CODE,
        message: "Something went wrong.",
        ...(rayId ? { request_id: rayId } : {}),
      },
    },
    INTERNAL_ERROR_STATUS,
  );
}

/**
 * Throwable form of the SPEC §7 envelope for code that cannot return a
 * Response directly (helpers such as cursor decoding). The app's `onError`
 * hook translates it into the envelope with the mapped status.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly reference?: ErrorMessageReference;

  constructor(
    code: ErrorCode,
    message: string,
    reference?: ErrorMessageReference,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.reference = reference;
  }
}
