/**
 * #312 PUBLIC /marketing suite.
 *
 * The abuse posture is the contact form's and is covered here in the same shape,
 * but the assertions that matter most are the three this endpoint has and that one
 * does not:
 *
 *   - The consent text stored is the SERVER's, never the client's. A client that
 *     could send its own consent wording could record any agreement it liked.
 *   - `sent` is reported honestly, so a form can only say "check your email" when
 *     there is something to check. With no postal address configured the consent
 *     is stored and nothing is sent.
 *   - The commercial email carries an unsubscribe, one-click headers and a postal
 *     address. Those are the three things the shared transactional layout
 *     deliberately omits, and shipping a commercial message without them is the
 *     failure this endpoint exists to avoid.
 */
import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketingRoutes } from "./marketing";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  MARKETING_CONSENT_TEXT,
  MARKETING_CONSENT_TEXT_FR,
  MARKETING_DAILY_CAP,
} from "../marketing/comparison-email";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const IP = "203.0.113.9";
const TOKEN = "7f4c1d2e-1111-4222-8333-444455556666";
const ADDRESS = "Loonext, 1 Example Street, Toronto ON M5V 1A1";

/**
 * The mailing address is a shared constant awaiting ops, not config — one fact
 * both the marketing site and this Worker read, so the two cannot disagree about
 * whether we have an address. A getter in the mock lets each test say whether ops
 * has filled it in yet, which is the only thing that varies.
 */
let addressForTest: string | null = ADDRESS;
vi.mock("@loonext/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@loonext/shared")>();
  return {
    ...actual,
    get MAILING_ADDRESS() {
      return addressForTest;
    },
  };
});

beforeEach(() => {
  addressForTest = ADDRESS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route("/", marketingRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json(
      { error: { code: INTERNAL_ERROR_CODE, message: "Something went wrong." } },
      INTERNAL_ERROR_STATUS,
    );
  });
  return app;
}

interface World {
  sb: SupabaseStub;
  resend: { calls: Record<string, unknown>[] };
  claimArgs: Record<string, unknown>[];
  unsubscribeArgs: Record<string, unknown>[];
}

function buildWorld(
  env: Env,
  options: {
    claim?: Record<string, unknown>;
    contactRow?: Record<string, unknown> | null;
    unsubscribeResult?: Record<string, unknown>;
  } = {},
): World {
  const sb = supabaseStub(env);
  const claimArgs: Record<string, unknown>[] = [];
  const unsubscribeArgs: Record<string, unknown>[] = [];

  sb.on("POST", "/rest/v1/rpc/api_claim_marketing_contact", (request) => {
    claimArgs.push(request.body as Record<string, unknown>);
    return options.claim ?? { ok: true, token: TOKEN };
  });
  sb.on("POST", "/rest/v1/rpc/api_marketing_unsubscribe", (request) => {
    unsubscribeArgs.push(request.body as Record<string, unknown>);
    return options.unsubscribeResult ?? { ok: true, known: true };
  });
  sb.on("GET", "/rest/v1/marketing_contacts", () =>
    options.contactRow === null
      ? []
      : [
          options.contactRow ?? {
            email: "dana@example.com",
            unsubscribe_token: TOKEN,
            unsubscribed_at: null,
            consent_locale: "en",
          },
        ],
  );
  sb.on("PATCH", "/rest/v1/marketing_contacts", () => []);

  const resendCalls: Record<string, unknown>[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    resendCalls.push((await request.clone().json()) as Record<string, unknown>);
    return Response.json({ id: `email_${resendCalls.length}` });
  };

  stubFetch(resendRoute, sb.route);
  return { sb, resend: { calls: resendCalls }, claimArgs, unsubscribeArgs };
}

async function post(
  app: Hono<AppEnv>,
  env: Env,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": IP },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function oneClickPost(
  app: Hono<AppEnv>,
  env: Env,
  token: string,
  marker = "One-Click",
): Promise<Response> {
  return app.fetch(
    new Request(
      `https://api.test/marketing/unsubscribe?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "List-Unsubscribe": marker }),
      },
    ),
    env,
  );
}

describe("POST /marketing/comparison", () => {
  it("records the consent and sends the comparison", async () => {
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, sent: true });
    expect(world.resend.calls).toHaveLength(1);
  });

  it("stores the SERVER's consent wording, never the client's", async () => {
    // The assertion that makes the record evidence. A client able to supply its
    // own consent text could record any agreement it liked, and the whole value
    // of storing the words is that they are the words we actually showed.
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
      consent_text: "I agree to absolutely anything",
      p_consent_text: "or this",
    });

    expect(world.claimArgs[0]).toMatchObject({
      p_email: "dana@example.com",
      p_source: "compare_page",
      p_consent_text: MARKETING_CONSENT_TEXT,
      p_cap: MARKETING_DAILY_CAP,
      p_locale: "en",
    });
  });

  it("stores and sends a French comparison in the route language", async () => {
    const env = {
      ...completeEnv(),
      SITE_ORIGIN: "https://loonext.com",
    } as Env;
    const world = buildWorld(env, {
      contactRow: {
        email: "dana@example.com",
        unsubscribe_token: TOKEN,
        unsubscribed_at: null,
        consent_locale: "fr-CA",
      },
    });
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
      locale: "fr-CA",
    });

    expect(res.status).toBe(201);
    expect(world.claimArgs[0]).toMatchObject({
      p_consent_text: MARKETING_CONSENT_TEXT_FR,
      p_locale: "fr-CA",
    });
    const sent = world.resend.calls[0] as {
      subject: string;
      text: string;
      html: string;
      headers: Record<string, string>;
    };
    const unsubscribe = `${env.SITE_ORIGIN}/fr/desabonnement?token=${TOKEN}`;
    const oneClick = `${env.API_ORIGIN}/marketing/unsubscribe?token=${TOKEN}`;
    expect(sent.subject).toBe("La comparaison que vous avez demandée");
    expect(sent.text).toContain("https://loonext.com/fr/comparer");
    expect(sent.text).toContain("Se désabonner");
    expect(sent.html).toContain("Se désabonner");
    expect(sent.text).toContain(unsubscribe);
    expect(sent.headers["List-Unsubscribe"]).toBe(`<${oneClick}>`);
  });

  it("stores the consent but sends nothing when no postal address is set", async () => {
    // A commercial email must carry a real mailing address and none exists in the
    // repo, so the send is configuration-gated. The consent still lands — that is
    // the part that must never be lost — and `sent: false` keeps the form from
    // promising an email that is not coming.
    addressForTest = null;
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    expect(await res.json()).toEqual({ ok: true, sent: false });
    expect(world.resend.calls).toHaveLength(0);
    expect(world.claimArgs).toHaveLength(1);
  });

  it("sends nothing to somebody who has unsubscribed", async () => {
    // Re-read at send time rather than trusting the claim: an unsubscribe can
    // land between the two statements.
    const env = completeEnv() as Env;
    const world = buildWorld(env, {
      contactRow: {
        email: "dana@example.com",
        unsubscribe_token: TOKEN,
        unsubscribed_at: "2026-07-01T00:00:00Z",
      },
    });
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    expect(await res.json()).toEqual({ ok: true, sent: false });
    expect(world.resend.calls).toHaveLength(0);
  });

  it("carries an unsubscribe link, one-click headers and the postal address", async () => {
    // The three things `email/html.ts` deliberately omits for transactional mail
    // and that a commercial message must have.
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    const sent = world.resend.calls[0] as {
      subject: string;
      text: string;
      html: string;
      headers: Record<string, string>;
    };
    const unsubscribe = `${env.APP_ORIGIN}/unsubscribe?token=${TOKEN}`;
    const oneClick = `${env.API_ORIGIN}/marketing/unsubscribe?token=${TOKEN}`;
    expect(sent.subject).toBe("The comparison you asked for");
    expect(sent.text).toContain("https://loonext.com/compare");
    expect(sent.text).toContain(unsubscribe);
    expect(sent.html).toContain(unsubscribe);
    expect(sent.text).toContain(ADDRESS);
    expect(sent.html).toContain(ADDRESS);
    // RFC 8058: the -Post header is what lets a mail client press the button
    // itself, which is the difference between an unsubscribe somebody has to
    // work for and one that just happens.
    expect(sent.headers["List-Unsubscribe"]).toBe(`<${oneClick}>`);
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("drops a honeypot submission silently, storing and sending nothing", async () => {
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "bot@example.com",
      source: "compare_page",
      website: "http://spam.example",
    });

    // A normal 201, so the bot never learns which field gave it away.
    expect(res.status).toBe(201);
    expect(world.claimArgs).toHaveLength(0);
    expect(world.resend.calls).toHaveLength(0);
  });

  it("reports a previous spam complaint as an ordinary success", async () => {
    // A complaint is never reversed by a form. Reported as accepted because
    // saying "that address complained about us" would confirm it to anybody who
    // typed it in.
    const env = completeEnv() as Env;
    const world = buildWorld(env, { claim: { ok: false, reason: "suppressed" } });
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "angry@example.com",
      source: "compare_page",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(world.resend.calls).toHaveLength(0);
  });

  it("reports the daily cap as rate limited", async () => {
    const env = completeEnv() as Env;
    buildWorld(env, { claim: { ok: false, reason: "daily_cap" } });
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    expect(res.status).toBe(429);
  });

  it("refuses an unknown consent source", async () => {
    // A closed set, because the value lands on the consent record and an open
    // string would let the client write anything into it.
    const env = completeEnv() as Env;
    buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "somewhere_else",
    });

    expect(res.status).toBe(422);
  });

  it("refuses an unsupported locale instead of guessing consent wording", async () => {
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
      locale: "fr",
    });

    expect(res.status).toBe(422);
    expect(world.claimArgs).toHaveLength(0);
  });

  it("still records the consent when the send throws", async () => {
    const env = completeEnv() as Env;
    const sb = supabaseStub(env);
    const claimArgs: Record<string, unknown>[] = [];
    sb.on("POST", "/rest/v1/rpc/api_claim_marketing_contact", (request) => {
      claimArgs.push(request.body as Record<string, unknown>);
      return { ok: true, token: TOKEN };
    });
    sb.on("GET", "/rest/v1/marketing_contacts", () => [
      {
        email: "dana@example.com",
        unsubscribe_token: TOKEN,
        unsubscribed_at: null,
        consent_locale: "en",
      },
    ]);
    sb.on("PATCH", "/rest/v1/marketing_contacts", () => []);
    const failing: FetchRoute = async (url) =>
      url.href === "https://api.resend.com/emails"
        ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
        : undefined;
    stubFetch(failing, sb.route);

    const res = await post(buildApp(), env, "/marketing/comparison", {
      email: "dana@example.com",
      source: "compare_page",
    });

    // The consent is the thing that must not be lost; the email can be retried.
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, sent: false });
    expect(claimArgs).toHaveLength(1);
  });
});

describe("POST /marketing/unsubscribe", () => {
  it("accepts an RFC 8058 one-click POST at the API URL", async () => {
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await oneClickPost(buildApp(), env, TOKEN);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, known: true });
    expect(world.unsubscribeArgs).toEqual([{ p_token: TOKEN }]);
  });

  it("refuses a form POST without the RFC 8058 marker", async () => {
    const env = completeEnv() as Env;
    const world = buildWorld(env);
    const res = await oneClickPost(buildApp(), env, TOKEN, "Later");

    expect(res.status).toBe(422);
    expect(world.unsubscribeArgs).toHaveLength(0);
  });

  it("unsubscribes by token, with no account and no confirmation step", async () => {
    const env = completeEnv() as Env;
    buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/unsubscribe", { token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, known: true });
  });

  it("reports an unknown token as done rather than as an error", async () => {
    // The person clicking cannot fix it, and "invalid token" reads as "you are
    // still subscribed" — the opposite of what they need to hear.
    const env = completeEnv() as Env;
    buildWorld(env, { unsubscribeResult: { ok: true, known: false } });
    const res = await post(buildApp(), env, "/marketing/unsubscribe", {
      token: "00000000-0000-4000-8000-0000000000ff",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, known: false });
  });

  it("refuses a malformed token, because nothing can be done with it", async () => {
    const env = completeEnv() as Env;
    buildWorld(env);
    const res = await post(buildApp(), env, "/marketing/unsubscribe", {
      token: "not-a-uuid",
    });

    expect(res.status).toBe(422);
  });
});
