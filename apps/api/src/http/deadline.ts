/**
 * A timeout for an outbound request that stops costing anything once the
 * request is over.
 *
 * `AbortSignal.timeout(20_000)` keeps its timer running for the full 20 s even
 * when the answer came back in 50 ms, and a Durable Object stays active, and
 * bills, for as long as a timer is pending. A call session makes dozens of
 * Telnyx and database requests, so its last event stayed open for the deadline
 * of whichever request was made last. Clearing the timer when the request
 * settles removes that tail and keeps the same abort when the request hangs.
 */
export interface Deadline {
  signal: AbortSignal;
  /** Stops the timer. Call it in a `finally` once the response is fully read. */
  clear(): void;
}

/**
 * The abort rejects with a `TimeoutError`, the same name `AbortSignal.timeout`
 * uses, so callers that tell a deadline from a caller's cancel keep working.
 * `existing` is the caller's own signal; either one aborts the request.
 */
export function deadline(ms: number, existing?: AbortSignal | null): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: existing ? AbortSignal.any([existing, controller.signal]) : controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/** Statuses whose Response must be built without a body. */
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * `fetch` under a deadline that covers the body and stops once it is read.
 * The returned Response holds the whole body, so callers read it as usual;
 * use it for JSON-sized answers, not downloads.
 */
export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const limit = deadline(ms, init?.signal);
  try {
    const response = await globalThis.fetch(input, { ...init, signal: limit.signal });
    if (response.body === null) return response;
    const bytes = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    // The body is decoded now, so the encoding and length no longer describe it.
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(NO_BODY_STATUSES.has(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    limit.clear();
  }
}
