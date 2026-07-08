/**
 * PUBLIC POST /contact suite: strict body validation, the four-layer abuse
 * posture (honeypot silent drop, per-IP rate limit, optional Turnstile,
 * global daily guarded-claim cap), the store-then-forward-then-ack email
 * flow (Reply-To = submitter; ack is best-effort), HTML escaping of
 * submitter-controlled fields, and the exact-origin CORS. Real product code
 * end to end; only global fetch is stubbed (D13).
 */
import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTACT_DAILY_CAP, CONTACT_INBOX, contactRoutes } from "./contact";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const IP = "203.0.113.7";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The contact route as index.ts mounts it, with the same onError hook. */
function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route("/", contactRoutes);
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

function validBody(): Record<string, unknown> {
  return {
    name: "Dana Smith",
    email: "dana@example.com",
    message: "Do you support teams of five sending from one number?",
  };
}

interface World {
  sb: SupabaseStub;
  resend: { calls: Record<string, unknown>[] };
  turnstile: { calls: URLSearchParams[] };
  routes: FetchRoute[];
}

function buildWorld(
  env: Env,
  options: {
    claimAllowed?: boolean;
    /** HTTP status per Resend call, in order (defaults to all 200). */
    resendStatuses?: number[];
    turnstileSuccess?: boolean;
  } = {},
): World {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_claim_contact_message", () =>
    options.claimAllowed === false
      ? { allowed: false }
      : { allowed: true, id: "3a7c1d2e-1111-4222-8333-444455556666" },
  );

  const resendCalls: Record<string, unknown>[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    const index = resendCalls.length;
    resendCalls.push((await request.clone().json()) as Record<string, unknown>);
    const status = options.resendStatuses?.[index] ?? 200;
    return status >= 400
      ? new Response(JSON.stringify({ message: "boom" }), { status })
      : Response.json({ id: `email_${index + 1}` });
  };

  const turnstileCalls: URLSearchParams[] = [];
  const turnstileRoute: FetchRoute = async (url, request) => {
    if (
      url.href !==
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    ) {
      return undefined;
    }
    turnstileCalls.push(new URLSearchParams(await request.clone().text()));
    return Response.json({ success: options.turnstileSuccess ?? true });
  };

  return {
    sb,
    resend: { calls: resendCalls },
    turnstile: { calls: turnstileCalls },
    routes: [sb.route, resendRoute, turnstileRoute],
  };
}

async function post(
  app: Hono<AppEnv>,
  env: Env,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    "/contact",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": IP,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

describe("POST /contact — happy path", () => {
  it("stores via the guarded claim, forwards to support with Reply-To = submitter, acks the submitter, 201", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    // Guarded claim carried the full submission + the cap + the caller IP.
    const claims = world.sb.find(
      "POST",
      "/rest/v1/rpc/api_claim_contact_message",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].body).toEqual({
      p_name: "Dana Smith",
      p_email: "dana@example.com",
      p_company: null,
      p_message: "Do you support teams of five sending from one number?",
      p_ip: IP,
      p_cap: CONTACT_DAILY_CAP,
    });

    // Two sends: support forward (reply_to = submitter), then the ack.
    expect(world.resend.calls).toHaveLength(2);
    const support = world.resend.calls[0];
    expect(support.to).toEqual([CONTACT_INBOX]);
    expect(support.reply_to).toBe("dana@example.com");
    expect(support.subject).toBe("Contact form: Dana Smith");
    expect(support.text).toContain(
      "Do you support teams of five sending from one number?",
    );

    const ack = world.resend.calls[1];
    expect(ack.to).toEqual(["dana@example.com"]);
    expect(ack.subject).toBe("We received your message");
    // The ack never echoes the (attacker-writable) message body — this
    // endpoint must not be usable as a spam relay to arbitrary inboxes.
    expect(ack.text).not.toContain("teams of five");
  });

  it("escapes submitter-controlled fields in the support email HTML", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, {
      ...validBody(),
      name: "Smith & Sons <Plumbing>",
      message: '<script>alert("x")</script> quote please',
    });
    expect(res.status).toBe(201);
    const html = world.resend.calls[0].html as string;
    expect(html).toContain("Smith &amp; Sons &lt;Plumbing&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<Plumbing>");
  });

  it("passes company through when present", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    await post(buildApp(), env, { ...validBody(), company: "Acme Plumbing" });
    const claim = world.sb.find(
      "POST",
      "/rest/v1/rpc/api_claim_contact_message",
    )[0];
    expect((claim.body as { p_company: string }).p_company).toBe(
      "Acme Plumbing",
    );
    expect(world.resend.calls[0].text).toContain("Company: Acme Plumbing");
  });

  it("an ack-email failure never fails the stored-and-forwarded submission", async () => {
    const env = completeEnv();
    const world = buildWorld(env, { resendStatuses: [200, 500] });
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(201);
    expect(world.resend.calls).toHaveLength(2); // ack attempted, failed, swallowed
  });

  it("a support-forward failure is a 500 (the row is already stored for recovery)", async () => {
    const env = completeEnv();
    const world = buildWorld(env, { resendStatuses: [500] });
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(500);
    // The guarded claim landed before the send — nothing is lost.
    expect(
      world.sb.find("POST", "/rest/v1/rpc/api_claim_contact_message"),
    ).toHaveLength(1);
  });
});

describe("POST /contact — validation", () => {
  it.each([
    ["non-JSON body", "not json"],
    ["missing name", { ...validBody(), name: undefined }],
    ["name too long", { ...validBody(), name: "x".repeat(101) }],
    ["invalid email", { ...validBody(), email: "not-an-email" }],
    ["message too short", { ...validBody(), message: "hi" }],
    ["message too long", { ...validBody(), message: "x".repeat(4001) }],
    ["company too long", { ...validBody(), company: "x".repeat(121) }],
  ])("%s → 422 validation_failed", async (_label, body) => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
    expect(world.sb.calls).toHaveLength(0);
    expect(world.resend.calls).toHaveLength(0);
  });
});

describe("POST /contact — abuse layers", () => {
  it("honeypot filled: 201 with NOTHING stored or sent (silent drop)", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, {
      ...validBody(),
      website: "https://spam.example",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(world.sb.calls).toHaveLength(0);
    expect(world.resend.calls).toHaveLength(0);
  });

  it("an empty honeypot value is treated as unfilled", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, { ...validBody(), website: "" });
    expect(res.status).toBe(201);
    expect(world.resend.calls).toHaveLength(2);
  });

  it("rate limiter over budget: 429, keyed contact:<ip>, nothing stored", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env: Env = { ...completeEnv(), VERIFY_RATE_LIMITER: { limit } };
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: expect.any(String) },
    });
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: `contact:${IP}` });
    expect(world.sb.calls).toHaveLength(0);
    expect(world.resend.calls).toHaveLength(0);
  });

  it("rate limiter under budget: request proceeds", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env: Env = { ...completeEnv(), VERIFY_RATE_LIMITER: { limit } };
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(201);
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: `contact:${IP}` });
  });

  it("daily cap exhausted (claim not allowed): 429, no email spent", async () => {
    const env = completeEnv();
    const world = buildWorld(env, { claimAllowed: false });
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: expect.stringContaining(CONTACT_INBOX) },
    });
    expect(world.resend.calls).toHaveLength(0);
  });
});

describe("POST /contact — Turnstile (only when TURNSTILE_SECRET_KEY is set)", () => {
  const SECRET = "0x4AAAAAAASecret0123456789";

  it("no secret configured: no token required, siteverify never called", async () => {
    const env = completeEnv();
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(201);
    expect(world.turnstile.calls).toHaveLength(0);
  });

  it("secret set + no token: 422 validation_failed", async () => {
    const env: Env = { ...completeEnv(), TURNSTILE_SECRET_KEY: SECRET };
    const world = buildWorld(env);
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, validBody());
    expect(res.status).toBe(422);
    expect(world.sb.calls).toHaveLength(0);
  });

  it("secret set + failing verification: 403 forbidden, nothing stored", async () => {
    const env: Env = { ...completeEnv(), TURNSTILE_SECRET_KEY: SECRET };
    const world = buildWorld(env, { turnstileSuccess: false });
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, {
      ...validBody(),
      turnstileToken: "tok_bot",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(world.sb.calls).toHaveLength(0);
    expect(world.resend.calls).toHaveLength(0);
  });

  it("secret set + passing verification: siteverify got secret/token/ip, 201", async () => {
    const env: Env = { ...completeEnv(), TURNSTILE_SECRET_KEY: SECRET };
    const world = buildWorld(env, { turnstileSuccess: true });
    stubFetch(...world.routes);

    const res = await post(buildApp(), env, {
      ...validBody(),
      turnstileToken: "tok_human",
    });
    expect(res.status).toBe(201);
    expect(world.turnstile.calls).toHaveLength(1);
    const form = world.turnstile.calls[0];
    expect(form.get("secret")).toBe(SECRET);
    expect(form.get("response")).toBe("tok_human");
    expect(form.get("remoteip")).toBe(IP);
  });
});

describe("POST /contact — CORS (exact APP_ORIGIN, no wildcard)", () => {
  it("answers a preflight for the exact APP_ORIGIN", async () => {
    const env = completeEnv();
    stubFetch(); // preflight touches no backend
    const res = await buildApp().request(
      "/contact",
      {
        method: "OPTIONS",
        headers: {
          Origin: env.APP_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(env.APP_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("answers a preflight for the marketing SITE_ORIGIN when set (D27 host split)", async () => {
    // The contact form is served from the marketing origin, which under the
    // host split is a different origin than APP_ORIGIN. Without this the real
    // form would be CORS-blocked.
    const env = { ...completeEnv(), SITE_ORIGIN: "https://loonext.com" };
    stubFetch();
    const res = await buildApp().request(
      "/contact",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://loonext.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://loonext.com",
    );
  });

  it("refuses any other origin (no echo), even with SITE_ORIGIN set", async () => {
    const env = { ...completeEnv(), SITE_ORIGIN: "https://loonext.com" };
    stubFetch();
    const res = await buildApp().request(
      "/contact",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
