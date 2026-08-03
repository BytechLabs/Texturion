/**
 * Test harness for the /v1 route sub-apps (D13): mounts the REAL middleware
 * chain (jwtAuth → companyContext) and the real sub-apps exactly as the
 * integration entry point does, with an onError hook mirroring index.ts.
 * The only stubbed thing anywhere is global fetch (JWKS, PostgREST, Auth
 * admin, Storage) via `supabaseStub` — every request the product code makes
 * is dispatched to test-registered responders and captured for assertions;
 * anything unregistered fails the test loudly.
 */
import { Hono } from "hono";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { getEnv } from "../env";
import {
  ApiError,
  errorResponse,
  internalErrorResponse,
} from "../http/errors";
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
  // #251: the SAME client-facing handler the real app uses. This was a
  // simplified double, which meant every route suite in the repo asserted
  // against an error response production does not send — no CORS re-echo, no
  // request id — so a test about error behaviour could pass while the
  // deployed behaviour differed. The observability half (Sentry, the server
  // log) stays in `index.ts`, because a test must not perform it.
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return errorResponse(c, error.code, error.message);
    }
    let allowed: (string | undefined)[] = [];
    try {
      allowed = [getEnv(c.env).APP_ORIGIN, getEnv(c.env).SITE_ORIGIN];
    } catch {
      // Same fallback as the app: still answer, just not cross-origin.
    }
    return internalErrorResponse(c, allowed);
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

  /**
   * Endpoints that hang off EVERY email send and assert nothing about the test
   * that triggered them: the #386 suppression lookup before, the #387
   * delivery-channel heartbeat after.
   *
   * Registered LAST, so a suite that wants to assert on either still can by
   * calling `on()` for it — explicit handlers win. An empty suppression list
   * means nothing is blocked, which is the state every existing test was
   * written against.
   *
   * The alternative was making a hundred tests stub two endpoints they are not
   * about, and making the next person to send an email rediscover that from a
   * five-second timeout.
   */
  const ambientHandlers = [
    {
      // #244: every push fan-out now asks whether the recipient's own quiet
      // hours are running. The ambient default is "nobody has set a window",
      // which is the state every test written before #244 was against — and
      // the state of every existing member. A suite that wants a window
      // registers this path itself and wins.
      method: "GET",
      matcher: "/rest/v1/notification_prefs",
      respond: () => [],
    },
    {
      // #236: the /v1 authorization probe hangs off EVERY authenticated
      // request, including the company-exempt ones that resolve no membership
      // at all. The ambient default is "your session is live, and you are a
      // member of nothing" — which is exactly the state a company-exempt
      // route was always in, so every test written before #236 keeps meaning
      // what it meant. A suite that needs a role (or a revoked session)
      // registers `membershipResponder` for this path and wins.
      method: "POST",
      matcher: "/rest/v1/rpc/api_authorize_request",
      respond: () => ({
        session_revoked: false,
        session_new: false,
        member: null,
      }),
    },
    {
      // #283: flags hang off the send, calls and AI paths. `{}` means nothing
      // has been said, which resolves every key to its code default — kill
      // switches ON, i.e. the state every test was written against. A suite
      // that needs a switch OFF registers this path itself and wins.
      method: "POST",
      matcher: "/rest/v1/rpc/api_evaluate_flags",
      respond: () => ({}),
    },
    { method: "GET", matcher: "/rest/v1/email_suppressions", respond: () => [] },
    {
      // #106/D88: number access is resolved on any route that must not leak
      // across numbers, which since #410 includes the contact detail. The
      // ambient answer is UNRESTRICTED — no rules in the company — which is
      // what every test written before those rules existed was asserting
      // against. A suite that needs a denied number registers this itself and
      // wins. Failing to resolve access must still be loud, so this is a
      // default rather than a swallow.
      method: "POST",
      matcher: "/rest/v1/rpc/member_number_levels",
      respond: () => [],
    },
    {
      // #410: the contact detail summarises the relationship with a head
      // count and one row. Narrowed to THAT read and returning undefined
      // otherwise, so an unstubbed conversation list stays a loud failure
      // rather than quietly answering empty.
      method: "GET",
      matcher: "/rest/v1/conversations",
      respond: (call: SbCall) =>
        call.url.searchParams.get("select") === "created_at" ? [] : undefined,
    },
    {
      method: "HEAD",
      matcher: "/rest/v1/conversations",
      respond: () => new Response(null, { headers: { "content-range": "*/0" } }),
    },
    {
      // #430: every push carrying a person's words reads the workspace's
      // answer first, so it hangs off the notification paths the way the flags
      // do. The ambient answer is the default — content INCLUDED — which is
      // the state every test written before #430 was asserting against. A
      // suite that wants it off registers this path itself and wins.
      method: "GET",
      matcher: "/rest/v1/companies",
      // Narrowed to THIS select, and returns undefined otherwise so the
      // handler falls through. A blanket `/rest/v1/companies` ambient would
      // answer every unstubbed company read in the suite with a one-column
      // row, turning a loud "you forgot to stub this" into a quiet wrong
      // answer — which is the failure mode ambient handlers are one bad
      // decision away from.
      respond: (call: SbCall) =>
        call.url.searchParams.get("select") === "push_include_content"
          ? [{ push_include_content: true }]
          : undefined,
    },
    {
      // #461: PATCH /v1/company reads the prior values of the auditable
      // settings first, so its audit row can say what MOVED rather than
      // restating the request. The ambient answer is "no prior row", which
      // yields an audit diff against nothing — the state every test written
      // before #461 was asserting against (they assert on the PATCH, not the
      // log). A suite that wants to assert on the diff registers this and wins.
      method: "GET",
      matcher: "/rest/v1/companies",
      // Narrowed to THIS select, per the #430 handler above: a blanket company
      // ambient would answer every unstubbed company read with an empty list,
      // turning a loud "you forgot to stub this" into a quiet 404.
      respond: (call: SbCall) =>
        call.url.searchParams.get("select")?.startsWith("name,timezone,country")
          ? []
          : undefined,
    },
    {
      // #461: the same, for the AI switches. PATCH /v1/company/ai-settings
      // reads them before the upsert so the log can name the ONE switch that
      // moved instead of all five.
      method: "GET",
      matcher: "/rest/v1/company_ai_settings",
      respond: (call: SbCall) =>
        call.url.searchParams
          .get("select")
          ?.startsWith("enrich_task_address,enrich_task_due")
          ? []
          : undefined,
    },
    {
      method: "POST",
      matcher: "/rest/v1/rpc/record_heartbeat",
      respond: () => ({ recovered: false }),
    },
    {
      // #452: the high-priority push meter hangs off every HIGH send the same
      // way. The default verdict is "allowed, no alert", which IS the shipped
      // behaviour every pre-#452 test was written against — a suite that wants
      // to assert on the meter, or drive a degrade, registers its own handler
      // and wins.
      method: "POST",
      matcher: "/rest/v1/rpc/claim_high_priority_push",
      respond: () => ({ allowed: true, alert: null }),
    },
    {
      // #308: the signature-rejection counter hangs off the FAILURE path of
      // every webhook route. Without this, any suite that posts an unsigned
      // webhook makes a real network call and waits out the timeout — the
      // request is fired before `waitUntil`, precisely so a context that cannot
      // defer it still records.
      method: "POST",
      matcher: "/rest/v1/rpc/record_webhook_rejection",
      respond: () => null,
    },
  ];

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
      for (const handler of [...handlers, ...ambientHandlers]) {
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
 * The /v1 authorization probe: since #236 the middleware settles membership
 * AND the session's revocation state in one `api_authorize_request` round
 * trip. Register it for `POST /rest/v1/rpc/api_authorize_request`.
 *
 * `role: null` is "not an active member of this company" (the 403 case).
 * `revoked: true` is "this device was signed out" (the 401 case).
 */
export function membershipResponder(
  memberId: string,
  role: string | null,
  options: {
    revoked?: boolean;
    newSession?: boolean;
    /** #314: the workspace MFA posture. Omitted = no policy. */
    mfa?: { required: boolean; grace_until: string | null; enforcing: boolean };
  } = {},
): SbResponder {
  return () => ({
    session_revoked: options.revoked ?? false,
    session_new: options.newSession ?? false,
    member: role === null ? null : { id: memberId, role },
    ...(options.mfa ? { mfa: options.mfa } : {}),
  });
}

/** Path of the authorization RPC, so tests register it without a literal. */
export const AUTHORIZE_RPC = "/rest/v1/rpc/api_authorize_request";

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
