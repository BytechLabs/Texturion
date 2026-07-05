/**
 * Test harness for the /v1 route sub-apps (D13): mounts the REAL middleware
 * chain (jwtAuth → companyContext) and the real sub-apps exactly as the
 * integration entry point does, with an onError hook mirroring index.ts.
 * The only stubbed thing anywhere is global fetch (JWKS, PostgREST, Auth
 * admin, Storage) via `supabaseStub` — every request the product code makes
 * is dispatched to test-registered responders and captured for assertions;
 * anything unregistered fails the test loudly.
 */
import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import { Hono } from "hono";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import type { FetchRoute } from "./support";

/** Mount sub-apps behind the real /v1 middleware chain (SPEC §7, §10). */
export function buildTestApp(...subApps: Hono<AppEnv>[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/v1/*", jwtAuth());
  app.use("/v1/*", companyContext());
  for (const sub of subApps) {
    app.route("/v1", sub);
  }
  app.notFound((c) => errorResponse(c, "not_found", "No such route."));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return errorResponse(c, error.code, error.message);
    }
    return c.json(
      { error: { code: INTERNAL_ERROR_CODE, message: "Something went wrong." } },
      INTERNAL_ERROR_STATUS,
    );
  });
  return app;
}

/** One captured Supabase-bound request. */
export interface SbCall {
  method: string;
  /** URL pathname, e.g. `/rest/v1/contacts` or `/auth/v1/invite`. */
  path: string;
  url: URL;
  /** Parsed JSON body when present (raw string if unparsable). */
  body: unknown;
  headers: Headers;
}

export type SbResponder = (
  call: SbCall,
) => unknown | Response | undefined;

export interface SupabaseStub {
  /** FetchRoute claiming every request to the env's SUPABASE_URL. */
  route: FetchRoute;
  /** Every Supabase-bound request, in order. */
  calls: SbCall[];
  /**
   * Register a responder. `matcher` matches the URL pathname (exact string or
   * RegExp). Responders run in registration order; returning undefined falls
   * through to the next one. A plain value is JSON-encoded; a Response is
   * used as-is. Unmatched requests throw (failing the test loudly).
   */
  on(method: string, matcher: string | RegExp, respond: SbResponder): void;
  /** Calls filtered by method + pathname matcher. */
  find(method: string, matcher: string | RegExp): SbCall[];
}

export function supabaseStub(env: Env): SupabaseStub {
  const calls: SbCall[] = [];
  const handlers: {
    method: string;
    matcher: string | RegExp;
    respond: SbResponder;
  }[] = [];

  const matches = (matcher: string | RegExp, path: string) =>
    typeof matcher === "string" ? matcher === path : matcher.test(path);

  const route: FetchRoute = (url, request) => {
    if (!url.href.startsWith(env.SUPABASE_URL)) return undefined;
    return (async (): Promise<Response> => {
      const raw = await request.clone().text();
      let body: unknown;
      if (raw !== "") {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const call: SbCall = {
        method: request.method,
        path: url.pathname,
        url,
        body,
        headers: request.headers,
      };
      calls.push(call);
      for (const handler of handlers) {
        if (handler.method !== request.method) continue;
        if (!matches(handler.matcher, url.pathname)) continue;
        const out = handler.respond(call);
        if (out === undefined) continue;
        return out instanceof Response ? out : Response.json(out);
      }
      throw new Error(
        `Unstubbed Supabase request in test: ${request.method} ${url.pathname}${url.search}`,
      );
    })();
  };

  return {
    route,
    calls,
    on(method, matcher, respond) {
      handlers.push({ method, matcher, respond });
    },
    find(method, matcher) {
      return calls.filter(
        (call) => call.method === method && matches(matcher, call.path),
      );
    },
  };
}

export interface ApiRequestOptions {
  method?: string;
  /** JSON body (sets content-type). */
  body?: unknown;
  /** Raw body (e.g. FormData for multipart) — takes precedence over `body`. */
  rawBody?: BodyInit;
  /** X-Company-Id header; null omits it (company-exempt routes). */
  companyId?: string | null;
  headers?: Record<string, string>;
}

/** Issue an authenticated request against a harness app. */
export async function apiRequest(
  app: Hono<AppEnv>,
  env: Env,
  token: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers ?? {}),
  };
  if (options.companyId !== null && options.companyId !== undefined) {
    headers["X-Company-Id"] = options.companyId;
  }
  let body: BodyInit | undefined = options.rawBody;
  if (body === undefined && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return app.request(
    path,
    { method: options.method ?? "GET", headers, body },
    env,
  );
}

/**
 * The company-context membership probe (auth/company.ts selects exactly
 * `id,role`). Register FIRST so route-level company_members queries (which
 * select other columns) fall through to test-specific responders.
 */
export function membershipResponder(
  memberId: string,
  role: string | null,
): SbResponder {
  return (call) =>
    call.url.searchParams.get("select") === "id,role" &&
    call.url.searchParams.has("user_id")
      ? role === null
        ? []
        : [{ id: memberId, role }]
      : undefined;
}

/** PostgREST count response (`head: true, count: 'exact'`). */
export function countResponse(count: number): Response {
  return new Response(null, {
    status: 200,
    headers: { "content-range": `*/${count}` },
  });
}

/** PostgREST error payload (e.g. unique_violation 23505 → SPEC 409). */
export function pgError(code: string, message: string): Response {
  return Response.json(
    { code, message, details: null, hint: null },
    { status: 409 },
  );
}
