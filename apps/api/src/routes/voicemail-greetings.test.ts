/**
 * #309 — recording a greeting in the business's own voice.
 *
 * VG-R4 is the one that decides whether this route is safe to ship. The bytes
 * go up BEFORE the row, so an insert that fails must take the object back out.
 * Without that, every rejected upload — a duplicate name, most commonly — would
 * leave audio in a bucket with nothing referencing it and nothing that would
 * ever notice.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GREETING_CAPTURE_DAILY_CAP,
  GREETING_CAPTURE_RING_SECS,
  GREETING_CAPTURE_TIME_LIMIT_SECS,
  parseGreetingCaptureState,
} from "../calls/greeting-capture";
import { ApiError, errorResponse } from "../http/errors";
import type { AppEnv } from "../context";
import type { Bindings } from "../env";
import type { Env } from "../env";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { voicemailGreetingsRoutes } from "./voicemail-greetings";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER_ID = "10000000-aaaa-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Every write to the greetings bucket, so a test can count them. */
function storageRoutes(env: Env) {
  const origin = new URL(env.SUPABASE_URL).origin;
  const uploads: string[] = [];
  const removed: string[] = [];
  const route: FetchRoute = (url, request) => {
    if (
      url.origin !== origin ||
      !url.pathname.includes("/storage/v1/object")
    ) {
      return undefined;
    }
    if (request.method === "POST") {
      uploads.push(url.pathname);
      return Response.json({ Key: url.pathname });
    }
    if (request.method === "DELETE") {
      removed.push(url.pathname);
      return Response.json([]);
    }
    return undefined;
  };
  return { route, uploads, removed };
}

/** Every dial this route places, so a test can read the tag off the wire. */
function telnyxDialRoute() {
  const dials: Record<string, unknown>[] = [];
  const route: FetchRoute = async (url, request) => {
    if (request.method !== "POST" || url.href !== "https://api.telnyx.com/v2/calls") {
      return undefined;
    }
    dials.push((await request.json()) as Record<string, unknown>);
    return Response.json({ data: { call_control_id: "ccid-capture-1" } });
  };
  return { route, dials };
}

function buildHarness(
  extra: {
    greetingInsertFails?: string;
    /** Existing greetings, for the name-clash path. */
    greetings?: Record<string, unknown>[];
    /** Capture calls already placed in the last 24h. */
    captureCallsToday?: number;
    /** Give the workspace no active line to call from. */
    noActiveNumber?: boolean;
    subscriptionStatus?: string;
  } = {},
) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("company_members");
  rest.table("voicemail_greetings", {}, [["company_id", "name"]]);
  rest.table("audit_log");
  rest.table("phone_numbers");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    subscription_status: extra.subscriptionStatus ?? "active",
  });
  if (!extra.noActiveNumber) {
    rest.insert("phone_numbers", {
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      company_id: COMPANY_ID,
      number_e164: "+16135550100",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    });
  }
  for (const greeting of extra.greetings ?? []) {
    rest.insert("voicemail_greetings", { company_id: COMPANY_ID, ...greeting });
  }
  for (let i = 0; i < (extra.captureCallsToday ?? 0); i += 1) {
    rest.insert("audit_log", {
      id: `audit-${i}`,
      company_id: COMPANY_ID,
      action: "voicemail_greeting.capture_call",
      target_type: "voicemail_greeting",
      occurred_at: new Date().toISOString(),
    });
  }
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });

  const storage = storageRoutes(env);

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", "owner");
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1", voicemailGreetingsRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  // The insert failure a test asks for, ahead of the FakeRest route so it wins.
  const failRoute: FetchRoute = (url, request) => {
    if (
      !extra.greetingInsertFails ||
      request.method !== "POST" ||
      !url.pathname.endsWith("/rest/v1/voicemail_greetings")
    ) {
      return undefined;
    }
    return Response.json(
      { code: extra.greetingInsertFails, message: "duplicate key value" },
      { status: 409 },
    );
  };

  const telnyx = telnyxDialRoute();
  stubFetch(failRoute, telnyx.route, storage.route, rest.route());
  return {
    env,
    rest,
    storage,
    dials: telnyx.dials,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

/** POST body for the capture-call route. */
function captureCall(name: string, to: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, to }),
  };
}

function upload(fields: {
  name?: string;
  durationMs?: string;
  type?: string;
  bytes?: Uint8Array;
}) {
  const form = new FormData();
  if (fields.name !== undefined) form.set("name", fields.name);
  if (fields.durationMs !== undefined) form.set("duration_ms", fields.durationMs);
  form.set(
    "file",
    new Blob([fields.bytes ?? new Uint8Array([1, 2, 3, 4])], {
      type: fields.type ?? "audio/mp4",
    }),
    "greeting.m4a",
  );
  return { method: "POST", body: form } as RequestInit;
}

describe("#309 recording a greeting", () => {
  it("VG-R1: a recording lands, and the row says what it is", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "After hours", durationMs: "8200" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("After hours");
    expect(body.duration_ms).toBe(8200);
    expect(harness.storage.uploads).toHaveLength(1);
  });

  it("VG-R2: a greeting nobody would sit through is refused, in words", async () => {
    // The column has this ceiling too, but a constraint-violation string is not
    // something to show a person who just recorded a three-minute message.
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "Epic", durationMs: "180000" }),
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("two minutes");
    // And nothing was written — the ceiling is checked before the upload.
    expect(harness.storage.uploads).toHaveLength(0);
  });

  it("VG-R3: a file that is not audio never reaches the bucket", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "Sneaky", durationMs: "5000", type: "application/pdf" }),
    );
    expect(res.status).toBe(422);
    expect(harness.storage.uploads).toHaveLength(0);
  });

  it("VG-R4: a rejected row takes its bytes back out of the bucket", async () => {
    // THE ONE THAT MATTERS. The object is written first, so a failed insert
    // must undo it — otherwise every duplicate-name attempt strands audio that
    // nothing references and nothing will ever notice.
    const harness = buildHarness({ greetingInsertFails: "23505" });
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "After hours", durationMs: "8200" }),
    );
    expect(res.status).toBe(422);
    // Named the conflict rather than reporting an internal error.
    expect(await res.text()).toContain("already have a greeting");
    expect(harness.storage.uploads).toHaveLength(1);
    expect(harness.storage.removed).toHaveLength(1);
  });

  it("VG-R5: deleting a greeting that is not yours is a 404, not a 204", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings/eeeeeeee-0000-4000-8000-0000000000e9",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
    // And no bytes were removed on the way to saying so.
    expect(harness.storage.removed).toHaveLength(0);
  });
});

/**
 * #309's record-by-phone path: we ring the owner, they speak, they hang up.
 *
 * VG-C5 is the one that matters, and it is why every other test here counts
 * dials. This is the only leg the product dials to a PSTN number, so it is the
 * only leg the outgoing-leg gate cannot clear on the dial target — the tag it
 * carries has to be worth trusting on its own.
 */
describe("#309 recording a greeting by phone", () => {
  it("VG-C1: the owner's phone is rung, with a tag only we could have made", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "613 555 0199"),
    );
    expect(res.status).toBe(202);
    expect(harness.dials).toHaveLength(1);
    const dial = harness.dials[0]!;
    expect(dial.to).toBe("+16135550199");
    expect(dial.from).toBe("+16135550100");
    // The two ceilings a capture leg carries: how long it rings, and how long
    // it may live once answered. The voice spending cap counts seconds off the
    // calls table and this leg writes no row there, so these are the bound.
    expect(dial.timeout_secs).toBe(GREETING_CAPTURE_RING_SECS);
    expect(dial.time_limit_secs).toBe(GREETING_CAPTURE_TIME_LIMIT_SECS);

    const parsed = await parseGreetingCaptureState(
      harness.env,
      dial.client_state as string,
      Date.now(),
    );
    expect(parsed).toEqual({ companyId: COMPANY_ID, name: "After hours" });
  });

  it("VG-C5: the tag is not something a caller could have written", async () => {
    // THE ONE THAT MATTERS. A `vgc` tag is the only thing standing between an
    // outgoing PSTN leg and the gate that hangs one up, and the company id
    // inside it decides whose greeting gets overwritten. So take the tag we
    // just minted, change the one field an attacker would change, and confirm
    // it stops verifying.
    const harness = buildHarness();
    await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "+16135550199"),
    );
    const tag = harness.dials[0]!.client_state as string;
    const forged = btoa(
      atob(tag).replace(COMPANY_ID, "dddddddd-0000-4000-8000-00000000000d"),
    );
    expect(
      await parseGreetingCaptureState(harness.env, forged, Date.now()),
    ).toBeNull();
  });

  it("VG-C2: a name already in the list is refused before anything is dialed", async () => {
    // Refused HERE rather than after the call, where the owner has already
    // spoken and there is nobody on the line left to tell.
    const harness = buildHarness({
      greetings: [{ id: "g-1", name: "After hours" }],
    });
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "+16135550199"),
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("already have a greeting");
    expect(harness.dials).toHaveLength(0);
  });

  it("VG-C3: the daily ceiling stops a client stuck in a loop", async () => {
    // The audit rows ARE the count: a capture leg writes no calls row, so the
    // voice spending cap — which counts seconds off that table — structurally
    // cannot see this dial.
    const harness = buildHarness({
      captureCallsToday: GREETING_CAPTURE_DAILY_CAP,
    });
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("Holiday", "+16135550199"),
    );
    expect(await res.text()).toContain("usage_cap_reached");
    expect(harness.dials).toHaveLength(0);
  });

  it("VG-C3b: one call under the ceiling still goes through", async () => {
    // The other half of VG-C3, and the reason it is a separate test: a cap
    // that refuses everything passes the test above and is an outage.
    const harness = buildHarness({
      captureCallsToday: GREETING_CAPTURE_DAILY_CAP - 1,
    });
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("Holiday", "+16135550199"),
    );
    expect(res.status).toBe(202);
    expect(harness.dials).toHaveLength(1);
  });

  it("VG-C4: a number we do not call never reaches the carrier", async () => {
    const harness = buildHarness();
    // A Caribbean +1 code — what a bare `+1[2-9]` regex would admit, and the
    // destination toll-pumping actually uses.
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "+18765550199"),
    );
    expect(res.status).toBe(422);
    expect(harness.dials).toHaveLength(0);
  });

  it("VG-C6: a workspace with no active line is told so, not 500'd", async () => {
    const harness = buildHarness({ noActiveNumber: true });
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "+16135550199"),
    );
    expect(res.status).toBe(409);
    expect(harness.dials).toHaveLength(0);
  });

  it("VG-C7: a lapsed subscription does not get to place calls", async () => {
    const harness = buildHarness({ subscriptionStatus: "past_due" });
    const res = await harness.request(
      "/v1/voicemail-greetings/capture-call",
      captureCall("After hours", "+16135550199"),
    );
    expect(res.status).toBe(402);
    expect(harness.dials).toHaveLength(0);
  });
});
