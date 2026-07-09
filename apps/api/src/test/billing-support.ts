/**
 * Test-only helpers for the billing suites (D13): everything here serves the
 * ONE permitted stub point — the global fetch network edge. Product code runs
 * for real (stripe-node with its fetch HTTP client, supabase-js PostgREST,
 * Resend REST); these helpers just play the far side of the wire and record
 * what the product code sent so tests can assert on it.
 */
import type { FetchRoute } from "./support";

export interface StubCall {
  method: string;
  url: URL;
  body: string | null;
  /** Request headers (e.g. to assert the §9 Idempotency-Key on a Stripe write). */
  headers: Headers;
  /** Stripe requests are application/x-www-form-urlencoded. */
  form(): URLSearchParams;
  /** PostgREST/Resend requests are JSON. */
  json(): unknown;
}

export type StubHandler = (call: StubCall) => unknown;

export interface StubEndpoint {
  method: string;
  pattern: RegExp;
  handler: StubHandler;
}

export function endpoint(
  method: string,
  pattern: RegExp,
  handler: StubHandler,
): StubEndpoint {
  return { method, pattern, handler };
}

export interface Harness {
  route: FetchRoute;
  calls: StubCall[];
  callsTo(method: string, pattern: RegExp): StubCall[];
}

/**
 * A recording fetch dispatcher: the first endpoint whose method + URL pattern
 * match handles the request; its return value becomes the JSON response body
 * (or is used verbatim when it already is a Response). Unmatched requests
 * fall through to stubFetch's loud failure.
 */
export function makeHarness(endpoints: StubEndpoint[]): Harness {
  const calls: StubCall[] = [];
  const route: FetchRoute = async (url, request) => {
    const match = endpoints.find(
      (candidate) =>
        candidate.method === request.method && candidate.pattern.test(url.href),
    );
    if (!match) return undefined;

    const body = request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.text();
    const call: StubCall = {
      method: request.method,
      url,
      body,
      headers: new Headers(request.headers),
      form: () => new URLSearchParams(body ?? ""),
      json: () => JSON.parse(body ?? "null"),
    };
    calls.push(call);
    const result = match.handler(call);
    return result instanceof Response ? result : Response.json(result);
  };
  return {
    route,
    calls,
    callsTo: (method, pattern) =>
      calls.filter(
        (call) => call.method === method && pattern.test(call.url.href),
      ),
  };
}

/** PostgREST `head: true, count: 'exact'` responses carry the count in Content-Range. */
export function countResponse(count: number): Response {
  return new Response(null, {
    status: 200,
    headers: { "content-range": `0-0/${count}` },
  });
}

/**
 * ExecutionContext double for Hono's `app.request(..., env, executionCtx)`:
 * collects waitUntil promises so tests can drain background processing
 * deterministically.
 */
export function makeExecutionContext(): {
  ctx: ExecutionContext;
  drain(): Promise<unknown>;
} {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, drain: () => Promise.all(tasks) };
}
