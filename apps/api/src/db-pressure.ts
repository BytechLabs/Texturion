import { AsyncLocalStorage } from "node:async_hooks";

import type { Context, MiddlewareHandler } from "hono";

import { overloadedResponse } from "./http/errors";

/**
 * What a request does once the database stops keeping up (docs/CAPACITY.md 2b).
 *
 * Two facts are tracked per request, in AsyncLocalStorage so one request's
 * trouble never fails another:
 *
 *  - overloaded: the database timed out or said it was out of room. The
 *    request stops asking: its next call fails at once instead of joining the
 *    queue that just failed it.
 *  - unreachable: a call died in transit. The request may still ask again,
 *    because postgrest-js retries these on purpose, but if it ends in a 5xx
 *    with the database still unreachable, the answer is the same 503.
 *    Any answer from the database clears it.
 *
 * Work outside a request (crons, Durable Object alarms) has no scope and keeps
 * the database's own answer.
 */

interface RequestPressure {
  overloaded: boolean;
  unreachable: boolean;
}

const scope = new AsyncLocalStorage<RequestPressure>();

/**
 * Raised for the call that saw the database refuse and for every later call of
 * the same request.
 *
 * `code` is ABORT_ERR on purpose: postgrest-js retries a failed GET three more
 * times (1, 2 and 4 s apart) and rethrows at once only an abort. Without it a
 * 10 s timeout became four, which is how requests took 80 to 110 s on the rig.
 */
export class DatabaseOverloadedError extends Error {
  readonly code = "ABORT_ERR";

  constructor(options?: { cause: unknown }) {
    super("the database is overloaded; this request has stopped asking it", options);
    this.name = "DatabaseOverloadedError";
  }
}

/**
 * The database timed out or said it was out of room, for the current request.
 * False when there is no request: a cron or an alarm keeps the database's own
 * answer, because nothing there is waiting on a customer's behalf.
 */
export function markDatabaseOverloaded(): boolean {
  const pressure = scope.getStore();
  if (!pressure) return false;
  pressure.overloaded = true;
  return true;
}

/** A call to the database died in transit, for the current request. */
export function markDatabaseUnreachable(): void {
  const pressure = scope.getStore();
  if (pressure) pressure.unreachable = true;
}

/** The database answered, so it is not unreachable any more. */
export function markDatabaseReachable(): void {
  const pressure = scope.getStore();
  if (pressure) pressure.unreachable = false;
}

/** Whether the current request has already seen the database refuse. */
export function databaseOverloaded(): boolean {
  return scope.getStore()?.overloaded === true;
}

/** Whether a failure of the current request is the database's, not the request's. */
export function databaseTrouble(): boolean {
  const pressure = scope.getStore();
  return pressure !== undefined && (pressure.overloaded || pressure.unreachable);
}

/**
 * Run a request inside its own pressure scope and report a 5xx as the 503 it is
 * when the database was the trouble. Covers a route that throws (handleAppError
 * answers that one, to keep the Sentry event out) and one that returns its own
 * 500. A response below 500 is never touched.
 */
export function databasePressure(
  allowedOrigins: (c: Context) => readonly (string | undefined)[],
): MiddlewareHandler {
  return (c, next) =>
    scope.run({ overloaded: false, unreachable: false }, async () => {
      await next();
      if (databaseTrouble() && c.res.status >= 500 && c.res.status !== 503) {
        console.warn(
          `[503] database trouble: ${c.req.method} ${new URL(c.req.url).pathname} was ${c.res.status}`,
        );
        const busy = overloadedResponse(c, allowedOrigins(c));
        // Keep every header the chain already set (CORS, security headers, the
        // ray) and take only the status, body and Retry-After from the new one.
        const headers = new Headers(c.res.headers);
        for (const [name, value] of busy.headers) {
          if (name === "vary") headers.append(name, value);
          else headers.set(name, value);
        }
        headers.delete("content-length");
        c.res = new Response(busy.body, { status: busy.status, headers });
      }
    });
}
