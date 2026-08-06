/**
 * #214 — POST /v1/tasks/enrich orchestration (the cost + security envelope
 * around the pure core in tasks/enrichment.ts). Asserts the settings gate never
 * calls the AI when off, the monthly cap-and-drop skips the call over-cap, the
 * happy path parses a valid model result, malformed output degrades to empty,
 * and input is validated. Only the network edge (PostgREST over fetch) and the
 * AI binding are stubbed.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env, WorkersAi } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  restMatch,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import {
  authorizeRoute,
  completeEnv,
  createTestAuth,
  type FetchRoute,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { companiesRoutes } from "./companies";
import { tasksRoutes } from "./tasks";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";

let auth: TestAuth;
const baseEnv = completeEnv();

/** A mock Workers AI binding whose next `run` result the test controls. */
function mockAi(result: unknown): { ai: WorkersAi; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => result);
  return { ai: { run }, run };
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("/v1/*", jwtAuth());
  app.use("/v1/*", companyContext());
  app.route("/v1", tasksRoutes);
  app.route("/v1", companiesRoutes);
  app.onError((error, c) =>
    error instanceof ApiError
      ? errorResponse(c, error.code, error.message)
      : c.json(
          { error: { code: "internal_error", message: String(error) } },
          500,
        ),
  );
  return app;
}
const app = buildApp();

/** The company-context middleware's probe (#236: membership + session, one RPC). */
function membersRoute(role: "member" | "admin" | "owner" = "member"): FetchRoute {
  return authorizeRoute(baseEnv, {
    id: "11111111-0000-4000-8000-000000000011",
    role,
  });
}

/** company_ai_settings GET → the given toggles (empty array = defaults/off). */
function settingsRoute(
  toggles: {
    enrich_task_address: boolean;
    enrich_task_due: boolean;
    suggest_replies?: boolean;
  } | null,
): Stub {
  return stubRoute(restMatch(baseEnv, "GET", "company_ai_settings"), () =>
    toggles ? [toggles] : [],
  );
}

/** companies GET → the enrichment context (timezone/area/country). */
function companyRoute(): Stub {
  return stubRoute(restMatch(baseEnv, "GET", "companies"), () => [
    { timezone: "America/Toronto", requested_area_code: "416", country: "CA" },
  ]);
}

/** ai_usage_reserve RPC → the reservation verdict, and how often it was asked. */
function reserveRoute(
  verdict: { count: number; over_cap: boolean; should_alert: boolean },
): Stub & { calls: () => number } {
  let calls = 0;
  const stub = stubRoute(rpcMatch(baseEnv, "ai_usage_reserve"), () => {
    calls += 1;
    return verdict;
  });
  return Object.assign(stub, { calls: () => calls });
}

beforeAll(async () => {
  auth = await createTestAuth(baseEnv);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function enrich(
  body: unknown,
  env: Env,
): Promise<Response> {
  return app.fetch(
    new Request("https://api.loonext.com/v1/tasks/enrich", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        "X-Company-Id": COMPANY_ID,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("POST /v1/tasks/enrich", () => {
  it("settings OFF → returns disabled, never touches the AI or the cap", async () => {
    const { ai, run } = mockAi({ response: "{}" });
    const env: Env = { ...baseEnv, AI: ai };
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: false, enrich_task_due: false })
        .route,
    );

    const res = await enrich({ text: "fix the sink" }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.enrichment_disabled).toBe(true);
    expect(json.address).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("happy path → parses the model result and names provenance", async () => {
    const { ai, run } = mockAi({
      response:
        '{"street":"5 King St W","city":"Toronto","source":"message","due_date":"2026-07-16","due_time":"14:00"}',
    });
    const env: Env = { ...baseEnv, AI: ai };
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      reserveRoute({ count: 1, over_cap: false, should_alert: false }).route,
      companyRoute().route,
    );

    const res = await enrich({ text: "fix sink at 5 King St W tomorrow 2pm" }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      address: { street: string } | null;
      address_provenance: string | null;
      due_at: string | null;
    };
    expect(run).toHaveBeenCalledTimes(1);
    expect(json.address?.street).toBe("5 King St W");
    expect(json.address_provenance).toBe("message");
    // 2026-07-16 14:00 America/Toronto (EDT) → 18:00 UTC.
    expect(json.due_at).toBe("2026-07-16T18:00:00.000Z");
  });

  it("reserves exactly one unit per enrichment", async () => {
    // The cap is a monthly count of enrichments. Counting a request twice
    // halves it, and moves the alert that warns before it to the wrong place.
    const { ai } = mockAi({ response: '{"city":"Toronto"}' });
    const reserve = reserveRoute({
      count: 1,
      over_cap: false,
      should_alert: false,
    });
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      reserve.route,
      companyRoute().route,
    );

    await enrich({ text: "fix sink at 5 King St W tomorrow 2pm" }, {
      ...baseEnv,
      AI: ai,
    });

    expect(reserve.calls()).toBe(1);
  });

  it("over the monthly cap → empty result, AI never called (cap-and-drop)", async () => {
    const { ai, run } = mockAi({ response: '{"city":"Toronto"}' });
    const env: Env = { ...baseEnv, AI: ai };
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      companyRoute().route,
      reserveRoute({ count: 1001, over_cap: true, should_alert: false }).route,
    );

    // Signal-bearing text so it reaches the cap (a no-signal task skips earlier).
    const res = await enrich({ text: "fix sink at 5 King St by Friday" }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { address: unknown };
    expect(json.address).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("malformed model output → empty result (never throws)", async () => {
    const { ai } = mockAi({ response: "I cannot help with that." });
    const env: Env = { ...baseEnv, AI: ai };
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      reserveRoute({ count: 2, over_cap: false, should_alert: false }).route,
      companyRoute().route,
    );

    const res = await enrich({ text: "fix sink at 5 King St by Friday" }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      address: unknown;
      due_at: unknown;
    };
    expect(json.address).toBeNull();
    expect(json.due_at).toBeNull();
  });

  it("no AI binding (dev/tests) → empty result, no cap spend", async () => {
    const env: Env = { ...baseEnv }; // no AI
    const reserve = reserveRoute({
      count: 1,
      over_cap: false,
      should_alert: false,
    });
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      companyRoute().route,
      reserve.route,
    );

    const res = await enrich({ text: "fix at 5 King St Friday" }, env);
    expect(res.status).toBe(200);
    expect(reserve.calls.length).toBe(0);
  });

  it("no address/date signal → skips the AI AND the cap entirely (cost)", async () => {
    const { ai, run } = mockAi({ response: '{"city":"Toronto"}' });
    const env: Env = { ...baseEnv, AI: ai };
    const reserve = reserveRoute({
      count: 1,
      over_cap: false,
      should_alert: false,
    });
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      companyRoute().route,
      reserve.route,
    );

    const res = await enrich({ text: "call the customer back" }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { address: unknown; due_at: unknown };
    expect(json.address).toBeNull();
    expect(json.due_at).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(reserve.calls.length).toBe(0);
  });

  it("no signal but a linked contact has an address → free contact fallback, no AI", async () => {
    const { ai, run } = mockAi({ response: "{}" });
    const env: Env = { ...baseEnv, AI: ai };
    const reserve = reserveRoute({
      count: 1,
      over_cap: false,
      should_alert: false,
    });
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      settingsRoute({ enrich_task_address: true, enrich_task_due: true }).route,
      companyRoute().route,
      stubRoute(restMatch(baseEnv, "GET", "conversations"), () => [
        { contact_id: "cont-1" },
      ]).route,
      stubRoute(restMatch(baseEnv, "GET", "contacts"), () => [
        { address: "88 Bay St, Toronto" },
      ]).route,
      reserve.route,
    );

    const res = await enrich(
      { text: "paint the house", conversation_id: CONVERSATION_ID },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      address: { street: string } | null;
      address_provenance: string | null;
    };
    expect(json.address?.street).toBe("88 Bay St, Toronto");
    expect(json.address_provenance).toBe("contact");
    expect(run).not.toHaveBeenCalled();
    expect(reserve.calls.length).toBe(0);
  });

  it("rejects an empty text body (422)", async () => {
    const { ai } = mockAi({ response: "{}" });
    const env: Env = { ...baseEnv, AI: ai };
    stubFetch(jwksRoute(auth), membersRoute());
    const res = await enrich({ text: "   " }, env);
    expect(res.status).toBe(422);
  });
});

describe("company AI settings (GET/PATCH /v1/company/ai-settings)", () => {
  async function req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return app.fetch(
      new Request(`https://api.loonext.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      baseEnv,
    );
  }

  it("GET defaults to all-ON when never set, except the one that speaks to callers", async () => {
    stubFetch(jwksRoute(auth), membersRoute("member"), settingsRoute(null).route);
    const res = await req("GET", "/v1/company/ai-settings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: true,
      business_description: null,
      transcribe_voicemail: true,
      // #367/D89. Every toggle above produces something a MEMBER reads before
      // a customer sees it, which is what makes default-on defensible for them.
      // This one changes what a stranger hears when they ring, in the
      // business's own name — so a workspace that has never opened the settings
      // screen must not have it.
      voicemail_intake: false,
      // #507: on, and it belongs with the group above rather than with the
      // exception below it — a dictation is text a member reads and edits
      // before it becomes anything, and no stranger ever hears it.
      call_wrapup: true,
      // #247: on, for the same reason, and it is the one worth pausing over.
      // It sends MORE of a customer's words than anything else here — up to
      // forty messages of a thread rather than one message or one recording —
      // so "a bigger disclosure deserves an opt-in" is a real position. It does
      // not reach D89's exception, which is about a feature a STRANGER
      // experiences, and the difference from reply drafting (default-on since
      // 20260724090000) is one of degree: same thread, same model, same
      // workspace's own service.
      summarize_threads: true,
    });
  });

  // #461: "Audits show change of entire sections even if a single field is
  // modified." This route was the clearest instance: it wrote all five
  // switches on every save, with an empty `before`, so a reader could not tell
  // which one the person actually touched or what it had been.
  it("audits ONLY the switch that moved, with both sides", async () => {
    const upsert = stubRoute(rpcMatch(baseEnv, "upsert_company_ai_settings"), () => ({
      company_id: COMPANY_ID,
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: false,
      transcribe_voicemail: true,
      voicemail_intake: false,
      business_description: "",
      updated_at: "2026-07-31T00:00:00.000Z",
    }));
    const audit = stubRoute(restMatch(baseEnv, "POST", "audit_log"), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute("admin"),
      // Everything already on except suggest_replies, which this save turns off.
      stubRoute(restMatch(baseEnv, "GET", "company_ai_settings"), () => [
        {
          enrich_task_address: true,
          enrich_task_due: true,
          suggest_replies: true,
          transcribe_voicemail: true,
          voicemail_intake: false,
        },
      ]).route,
      upsert.route,
      audit.route,
    );

    // The client MUST send all three switches (they are required), which is
    // exactly why the log used to name all of them on every save.
    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: false,
    });
    expect(res.status).toBe(200);

    expect(audit.calls.length).toBe(1);
    const row = audit.calls[0].body as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(row.before).toEqual({ suggest_replies: true });
    expect(row.after).toEqual({ suggest_replies: false });
    // The four switches that did not move must NOT be in the row — that was
    // the complaint.
    expect(Object.keys(row.after)).toEqual(["suggest_replies"]);
  });

  it("writes no audit row at all when a save changed nothing", async () => {
    // A client that reads the settings and posts them back is doing the
    // obvious thing; a log full of non-events teaches people to skim it.
    const upsert = stubRoute(rpcMatch(baseEnv, "upsert_company_ai_settings"), () => ({
      company_id: COMPANY_ID,
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: true,
      transcribe_voicemail: true,
      voicemail_intake: false,
      business_description: "",
      updated_at: "2026-07-31T00:00:00.000Z",
    }));
    const audit = stubRoute(restMatch(baseEnv, "POST", "audit_log"), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute("admin"),
      stubRoute(restMatch(baseEnv, "GET", "company_ai_settings"), () => [
        {
          enrich_task_address: true,
          enrich_task_due: true,
          suggest_replies: true,
          transcribe_voicemail: true,
          voicemail_intake: false,
        },
      ]).route,
      upsert.route,
      audit.route,
    );

    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: true,
    });
    expect(res.status).toBe(200);
    expect(audit.calls.length).toBe(0);
  });

  it("PATCH (admin) upserts the toggles and echoes them back", async () => {
    const upsert = stubRoute(
      rpcMatch(baseEnv, "upsert_company_ai_settings"),
      () => ({
        company_id: COMPANY_ID,
        enrich_task_address: true,
        enrich_task_due: false,
        suggest_replies: false,
        business_description: "We paint houses.",
        updated_at: "2026-07-23T00:00:00.000Z",
      }),
    );
    // #461: the route now reads the switches BEFORE the upsert so the audit
    // row can name the ONE that moved. No prior row = every switch reads as a
    // change, which is what a first save actually is.
    stubFetch(
      jwksRoute(auth),
      membersRoute("admin"),
      settingsRoute(null).route,
      upsert.route,
    );
    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: true,
      enrich_task_due: false,
      suggest_replies: false,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enrich_task_address: true,
      enrich_task_due: false,
      suggest_replies: false,
      business_description: "We paint houses.",
    });
    expect(upsert.calls.length).toBe(1);
  });

  it("#420: accepts the null description its own GET hands back", async () => {
    // The web client reads the settings and sends them back with one switch
    // flipped. On a workspace that never wrote a description that object
    // carries `business_description: null` — which the schema rejected, so
    // EVERY Lou toggle 400'd with "expected string, received null" until a
    // description existed. An API that will not accept its own output is the
    // whole bug; null means "leave it alone", exactly as absent does.
    const upsert = stubRoute(
      rpcMatch(baseEnv, "upsert_company_ai_settings"),
      () => ({
        company_id: COMPANY_ID,
        enrich_task_address: false,
        enrich_task_due: true,
        suggest_replies: true,
        business_description: null,
        transcribe_voicemail: true,
        updated_at: "2026-07-28T00:00:00.000Z",
      }),
    );
    // #461: the route now reads the switches BEFORE the upsert so the audit
    // row can name the ONE that moved. No prior row = every switch reads as a
    // change, which is what a first save actually is.
    stubFetch(
      jwksRoute(auth),
      membersRoute("admin"),
      settingsRoute(null).route,
      upsert.route,
    );
    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: false,
      enrich_task_due: true,
      suggest_replies: true,
      business_description: null,
      transcribe_voicemail: true,
    });

    expect(res.status).toBe(200);
    // Passed through as null, which the RPC reads as "keep what is stored" —
    // a toggle save must never clear the owner's own words as a side effect.
    expect(
      (upsert.calls[0]?.body as { p_business_description: string | null })
        .p_business_description,
    ).toBeNull();
  });

  it("#420: a stored description survives a toggle-only save", async () => {
    // The same round-trip on a workspace that HAS a description: the client
    // echoes the real string back, and it must come out the other side intact.
    const upsert = stubRoute(
      rpcMatch(baseEnv, "upsert_company_ai_settings"),
      () => ({
        company_id: COMPANY_ID,
        enrich_task_address: false,
        enrich_task_due: true,
        suggest_replies: true,
        business_description: "We paint houses.",
        transcribe_voicemail: true,
        updated_at: "2026-07-28T00:00:00.000Z",
      }),
    );
    // #461: the route now reads the switches BEFORE the upsert so the audit
    // row can name the ONE that moved. No prior row = every switch reads as a
    // change, which is what a first save actually is.
    stubFetch(
      jwksRoute(auth),
      membersRoute("admin"),
      settingsRoute(null).route,
      upsert.route,
    );
    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: false,
      enrich_task_due: true,
      suggest_replies: true,
      business_description: "We paint houses.",
      transcribe_voicemail: true,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      business_description: "We paint houses.",
    });
  });

  it("PATCH is admin-gated (a member gets 403)", async () => {
    stubFetch(jwksRoute(auth), membersRoute("member"));
    const res = await req("PATCH", "/v1/company/ai-settings", {
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: true,
    });
    expect(res.status).toBe(403);
  });
});
