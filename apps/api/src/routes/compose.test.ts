/**
 * POST /v1/conversations suite (SPEC §5, §7): consent attestation required,
 * quiet-hours confirm (409 without the flag; confirmed sends logged),
 * open-conversation conflict → append + 200, idempotent replay, contact
 * attestation writes, and the shared send path.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import type { MessageRow } from "../messaging/types";
import { getSendGates } from "../telnyx/registration";
import {
  messageRow,
  pgUniqueViolation,
  restMatch,
  rpcMatch,
  storageSignMatch,
  storageUploadMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import {
  companyMembersRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { composeRoutes } from "./compose";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const CONTACT_ID = "eeeeeeee-0000-4000-8000-00000000000e";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66eeee";
// 2026-07-01T16:00Z → 12:00 in America/Toronto (613): daytime.
const DAYTIME = new Date("2026-07-01T16:00:00.000Z");
// 2026-07-01T03:00Z → 23:00 (June 30) in America/Toronto: quiet hours.
const NIGHTTIME = new Date("2026-07-01T03:00:00.000Z");

// One keypair per file: jose's remote-JWKS resolver caches the key set per
// URL for the whole worker, so re-minting keys per test would 401.
const env: Env = completeEnv();
let auth: TestAuth;
beforeAll(async () => {
  auth = await createTestAuth(env);
});

const app = new Hono<AppEnv>();
app.use("/v1/*", jwtAuth());
app.use("/v1/*", companyContext());
app.route("/v1", composeRoutes);
app.onError((error, c) => {
  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message);
  }
  return c.json(
    { error: { code: "internal_error", message: String(error) } },
    500,
  );
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function contactRow(overrides: Partial<{
  consent_source: string | null;
  name: string | null;
}> = {}) {
  return {
    id: CONTACT_ID,
    phone_e164: "+16135551000",
    name: overrides.name ?? null,
    consent_source: overrides.consent_source ?? null,
  };
}

function conversationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONVERSATION_ID,
    company_id: COMPANY_ID,
    contact_id: CONTACT_ID,
    phone_number_id: NUMBER_ID,
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    last_message_at: "2026-07-01T12:00:00.000Z",
    closed_at: null,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

interface ComposeStubs {
  replayLookup: Stub;
  numberLookup: Stub;
  companyLookup: Stub;
  contactLookup: Stub;
  contactInsert: Stub;
  contactPatch: Stub;
  optOuts: Stub;
  conversationInsert: Stub;
  openLookup: Stub;
  gateRpc: Stub;
  events: Stub;
  telnyx: Stub;
  persist: Stub;
  modulesLookup: Stub;
  mmsCount: Stub;
  attachmentsLookup: Stub;
  upload: Stub;
  attachmentInsert: Stub;
  sign: Stub;
  all: FetchRoute[];
}

function composeStubs(options: {
  replay?: MessageRow[];
  existingContact?: ReturnType<typeof contactRow> | null;
  conversationConflict?: boolean;
  /** #12: whether the Picture messages (mms) module is enabled (default true). */
  mmsEnabled?: boolean;
  /** #12: outbound MMS already sent this period (cap pre-check; default 0). */
  mmsUsed?: number;
  /** Rows the message_attachments lookup returns (replay path). */
  attachments?: {
    id: string;
    message_id: string;
    content_type: string;
    size_bytes: number;
  }[];
} = {}): ComposeStubs {
  const replayLookup = stubRoute(
    restMatch(env, "GET", "messages", (url) =>
      (url.searchParams.get("idempotency_key") ?? "").startsWith("eq."),
    ),
    () => options.replay ?? [],
  );
  const numberLookup = stubRoute(restMatch(env, "GET", "phone_numbers"), () => [
    { id: NUMBER_ID, number_e164: "+16135550100", status: "active" },
  ]);
  // One GET-companies stub serves both readers: the route (id/name for merge
  // fields) and companyOverMmsCap (plan/current_period_start for the cap).
  const companyLookup = stubRoute(restMatch(env, "GET", "companies"), () => [
    {
      id: COMPANY_ID,
      name: "Acme Plumbing",
      plan: "starter",
      current_period_start: "2026-07-01T00:00:00.000Z",
    },
  ]);
  const contactLookup = stubRoute(
    restMatch(env, "GET", "contacts"),
    () => (options.existingContact ? [options.existingContact] : []),
  );
  const contactInsert = stubRoute(restMatch(env, "POST", "contacts"), () => [
    contactRow({ consent_source: "attested" }),
  ]);
  const contactPatch = stubRoute(restMatch(env, "PATCH", "contacts"), () => [
    options.existingContact ?? contactRow({ consent_source: "attested" }),
  ]);
  const optOuts = stubRoute(restMatch(env, "GET", "opt_outs"), () => []);
  const conversationInsert = stubRoute(
    restMatch(env, "POST", "conversations"),
    () =>
      options.conversationConflict
        ? pgUniqueViolation()
        : Response.json([conversationRow()], { status: 201 }),
  );
  const openLookup = stubRoute(restMatch(env, "GET", "conversations"), () => [
    conversationRow(),
  ]);
  const gateRpc = stubRoute(rpcMatch(env, "gate_outbound_send"), (call) => {
    const params = call.body as { p_body: string; p_segments_estimate: number };
    return {
      message: messageRow({
        id: MESSAGE_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        body: params.p_body,
        segments: params.p_segments_estimate,
      }),
      existing: false,
    };
  });
  const events = stubRoute(restMatch(env, "POST", "conversation_events"), () =>
    Response.json([], { status: 201 }),
  );
  const telnyx = stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: TELNYX_ID } }),
  );
  const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
    messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      ...(call.body as Partial<MessageRow>),
    }),
  ]);
  // #12 plan builder: the mms-module gate on picture composes. Enabled by
  // default (grandfathered posture) so text + MMS tests pass; a test opts out
  // to assert the 409 block.
  const modulesLookup = stubRoute(
    restMatch(env, "GET", "company_modules"),
    () => (options.mmsEnabled === false ? [] : [{ module: "mms" }]),
  );
  // #12 cap-and-drop: the period MMS count companyOverMmsCap reads — at the
  // route pre-check AND again at dispatchOutbound's backstop (stubs answer
  // every match, so the double read is fine). Default 0 → under cap.
  const mmsCount = stubRoute(
    rpcMatch(env, "api_period_outbound_mms"),
    () => options.mmsUsed ?? 0,
  );
  const attachmentsLookup = stubRoute(
    restMatch(env, "GET", "message_attachments"),
    () => options.attachments ?? [],
  );
  const upload = stubRoute(storageUploadMatch(env), () => ({ Key: "x" }));
  const attachmentInsert = stubRoute(
    restMatch(env, "POST", "message_attachments"),
    (call) => [
      {
        id: crypto.randomUUID(),
        content_type: (call.body as { content_type: string }).content_type,
        size_bytes: (call.body as { size_bytes: number }).size_bytes,
      },
    ],
  );
  const sign = stubRoute(storageSignMatch(env), (call) => ({
    signedURL: `${call.url.pathname.replace("/storage/v1", "")}?token=test-token`,
  }));

  return {
    replayLookup,
    numberLookup,
    companyLookup,
    contactLookup,
    contactInsert,
    contactPatch,
    optOuts,
    conversationInsert,
    openLookup,
    gateRpc,
    events,
    telnyx,
    persist,
    modulesLookup,
    mmsCount,
    attachmentsLookup,
    upload,
    attachmentInsert,
    sign,
    all: [
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      replayLookup.route,
      numberLookup.route,
      companyLookup.route,
      contactLookup.route,
      contactInsert.route,
      contactPatch.route,
      optOuts.route,
      conversationInsert.route,
      openLookup.route,
      gateRpc.route,
      events.route,
      telnyx.route,
      persist.route,
      modulesLookup.route,
      mmsCount.route,
      attachmentsLookup.route,
      upload.route,
      attachmentInsert.route,
      sign.route,
    ],
  };
}

async function postCompose(
  body: Record<string, unknown>,
  options: { idempotencyKey?: string } = {},
): Promise<Response> {
  return app.fetch(
    new Request("https://api.loonext.app/v1/conversations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        "X-Company-Id": COMPANY_ID,
        "Idempotency-Key": options.idempotencyKey ?? crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

const VALID_BODY = {
  phone_e164: "+16135551000",
  phone_number_id: NUMBER_ID,
  body: "Hi! Following up on your quote.",
};

describe("POST /v1/conversations — consent attestation (§5, D4)", () => {
  // The visible consent checkbox was removed; compose no longer requires a
  // consent flag and attests the contact implicitly (auto-attest), so the audit
  // trail (consent_source='attested' + the consent_attested event) still fills.
  it("creates the contact attested and records the consent_attested event", async () => {
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(201);

    // New contact created with the attestation fields (§5).
    expect(stubs.contactInsert.calls).toHaveLength(1);
    expect(stubs.contactInsert.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      phone_e164: "+16135551000",
      consent_source: "attested",
      consent_attested_by: auth.subject,
      consent_at: expect.any(String),
    });

    // consent_attested event attached to the new conversation.
    expect(stubs.events.calls).toHaveLength(1);
    const events = stubs.events.calls[0].body as Record<string, unknown>[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      actor_user_id: auth.subject,
      type: "consent_attested",
    });

    // Outbound-first: conversation created open, body sent verbatim (no footer).
    expect(stubs.conversationInsert.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      contact_id: CONTACT_ID,
      phone_number_id: NUMBER_ID,
      status: "open",
    });
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_body: VALID_BODY.body,
    });
    expect(stubs.telnyx.calls).toHaveLength(1);

    const body = (await response.json()) as {
      conversation: { id: string; status: string };
      message: { id: string };
    };
    expect(body.conversation.id).toBe(CONVERSATION_ID);
    expect(body.conversation.status).toBe("open");
    expect(body.message.id).toBe(MESSAGE_ID);
  });

  it("does not downgrade inbound_sms consent, but still records the event", async () => {
    const stubs = composeStubs({
      existingContact: contactRow({ consent_source: "inbound_sms" }),
    });
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(201);

    // Update touched deleted_at only — consent fields left alone.
    expect(stubs.contactPatch.calls).toHaveLength(1);
    expect(stubs.contactPatch.calls[0].body).toEqual({ deleted_at: null });
    const events = stubs.events.calls[0].body as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ type: "consent_attested" });
  });
});

describe("POST /v1/conversations — quiet hours (§5)", () => {
  it("409s an unconfirmed compose at 23:00 destination time", async () => {
    vi.setSystemTime(NIGHTTIME);
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("quiet_hours_confirmation_required");
    // Nothing was created.
    expect(stubs.contactInsert.calls).toHaveLength(0);
    expect(stubs.conversationInsert.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });

  it("proceeds with quiet_hours_confirmed=true and logs the event", async () => {
    vi.setSystemTime(NIGHTTIME);
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      quiet_hours_confirmed: true,
    });
    expect(response.status).toBe(201);

    const events = stubs.events.calls[0].body as Record<string, unknown>[];
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "quiet_hours_confirmed",
      payload: { destination_local_hour: 23 },
    });
    expect(stubs.telnyx.calls).toHaveLength(1);
  });

  it("needs no confirmation during the daytime and logs no event", async () => {
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(201);
    const events = stubs.events.calls[0].body as Record<string, unknown>[];
    expect(events).toHaveLength(1); // consent only
  });
});

describe("POST /v1/conversations — merge-fields (Step 0a)", () => {
  it("applies {first_name}/{business_name} server-side at send", async () => {
    const stubs = composeStubs({
      existingContact: contactRow({
        name: "Dana Whitfield",
        consent_source: "attested",
      }),
    });
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      contact_id: undefined,
      body: "Hi {first_name}, from {business_name}.",
    });
    expect(response.status).toBe(201);
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_body: "Hi Dana, from Acme Plumbing.",
    });
  });
});

describe("POST /v1/conversations — conflict append + idempotency (§7)", () => {
  it("appends to the existing open conversation on the unique conflict → 200", async () => {
    const stubs = composeStubs({
      conversationConflict: true,
      existingContact: contactRow({ consent_source: "attested" }),
    });
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(200); // appended, not created

    // Re-selected the open conversation for the triple.
    const lookup = stubs.openLookup.calls[0].url.searchParams;
    expect(lookup.get("contact_id")).toBe(`eq.${CONTACT_ID}`);
    expect(lookup.get("phone_number_id")).toBe(`eq.${NUMBER_ID}`);
    expect(lookup.get("closed_at")).toBe("is.null");

    // Gates + send still ran; attestation still recorded (§7).
    expect(stubs.gateRpc.calls).toHaveLength(1);
    expect(stubs.telnyx.calls).toHaveLength(1);
    const events = stubs.events.calls[0].body as Record<string, unknown>[];
    expect(events[0]).toMatchObject({ type: "consent_attested" });
  });

  it("replays an identical Idempotency-Key without re-running anything → 200", async () => {
    const replayed = messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      telnyx_message_id: TELNYX_ID,
    });
    const stubs = composeStubs({ replay: [replayed] });
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      conversation: { id: string };
      message: { id: string };
    };
    expect(body.conversation.id).toBe(CONVERSATION_ID);
    expect(body.message.id).toBe(MESSAGE_ID);

    expect(getSendGates).not.toHaveBeenCalled();
    expect(stubs.gateRpc.calls).toHaveLength(0);
    expect(stubs.conversationInsert.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
    expect(stubs.events.calls).toHaveLength(0);
  });
});

describe("POST /v1/conversations — destination + gate failures", () => {
  it("422s a non-US/CA phone (Bahamas 242 — §10 layer 2)", async () => {
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      phone_e164: "+12425551234",
    });
    expect(response.status).toBe(422);
    expect(stubs.conversationInsert.calls).toHaveLength(0);
  });

  it("blocks an opted-out destination before creating anything (403)", async () => {
    const stubs = composeStubs();
    const optedOut = stubRoute(restMatch(env, "GET", "opt_outs"), () => [
      { id: "op-1" },
    ]);
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      stubs.replayLookup.route,
      stubs.numberLookup.route,
      stubs.companyLookup.route,
      optedOut.route,
      stubs.contactLookup.route,
      stubs.contactInsert.route,
      stubs.conversationInsert.route,
      stubs.gateRpc.route,
      stubs.telnyx.route,
    );

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("recipient_opted_out");
    expect(stubs.contactInsert.calls).toHaveLength(0);
    expect(stubs.conversationInsert.calls).toHaveLength(0);
  });

  it("402s when the subscription is inactive, before quiet hours or writes", async () => {
    vi.mocked(getSendGates).mockResolvedValueOnce({
      subscriptionActive: false,
      usApproved: true,
      caAllowed: true,
    });
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    expect(response.status).toBe(402);
    expect(await errorCode(response)).toBe("subscription_inactive");
    expect(stubs.conversationInsert.calls).toHaveLength(0);
  });
});

describe("POST /v1/conversations — MMS (§7, §8, #12)", () => {
  const PIXEL = btoa("\xff\xd8\xff\xe0 fake image bytes");

  it("uploads to Storage, records the attachment, sends signed media_urls", async () => {
    const stubs = composeStubs({
      existingContact: contactRow({ consent_source: "attested" }),
    });
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      body: "photo attached",
      media: [{ content_type: "image/jpeg", base64: PIXEL }],
    });
    expect(response.status).toBe(201);

    // MMS meters (and pre-checks) as 3 segments (§2).
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_segments_estimate: 3 });

    // Stored at mms-media/{company}/{message}/0.
    expect(stubs.upload.calls).toHaveLength(1);
    expect(stubs.upload.calls[0].url.pathname).toBe(
      `/storage/v1/object/mms-media/${COMPANY_ID}/${MESSAGE_ID}/0`,
    );

    // Outbound attachment row carries source_url NULL (§6).
    expect(stubs.attachmentInsert.calls[0].body).toMatchObject({
      message_id: MESSAGE_ID,
      company_id: COMPANY_ID,
      storage_path: `${COMPANY_ID}/${MESSAGE_ID}/0`,
      content_type: "image/jpeg",
      source_url: null,
    });

    // Telnyx got a 24h signed URL.
    const telnyxBody = stubs.telnyx.calls[0].body as { media_urls: string[] };
    expect(telnyxBody.media_urls).toHaveLength(1);
    expect(telnyxBody.media_urls[0]).toContain(
      `/object/sign/mms-media/${COMPANY_ID}/${MESSAGE_ID}/0`,
    );
    expect(telnyxBody.media_urls[0]).toContain("token=test-token");
    expect(stubs.sign.calls[0].body).toMatchObject({ expiresIn: 86400 });

    // The compose response carries the attachment summary.
    const body = (await response.json()) as {
      message: { attachments: unknown[] };
    };
    expect(body.message.attachments).toHaveLength(1);
  });

  it("without the Picture messages add-on, a media compose is a 409 (#12)", async () => {
    const stubs = composeStubs({ mmsEnabled: false });
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      body: "photo attached",
      media: [{ content_type: "image/jpeg", base64: PIXEL }],
    });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
    // Cost-protection: gated before any row, upload, or Telnyx send — nothing
    // left behind, no MMS charge incurred.
    expect(stubs.conversationInsert.calls).toHaveLength(0);
    expect(stubs.upload.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });

  it("at the MMS cap the photo is dropped and the text still sends (#12)", async () => {
    const stubs = composeStubs({
      existingContact: contactRow({ consent_source: "attested" }),
      mmsUsed: 150, // the starter plan's full included allowance
    });
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      body: "photo attached",
      media: [{ content_type: "image/jpeg", base64: PIXEL }],
    });
    // Cap-and-drop the PHOTO, keep the TEXT: the compose still succeeds.
    expect(response.status).toBe(201);

    // Dropped at the route pre-check: text segment estimate, no upload, no
    // attachment rows — the meter can't over-count a text-only send.
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_segments_estimate: 1 });
    expect(stubs.upload.calls).toHaveLength(0);
    expect(stubs.attachmentInsert.calls).toHaveLength(0);

    // Telnyx got the text with no media_urls.
    expect(stubs.telnyx.calls).toHaveLength(1);
    expect(
      (stubs.telnyx.calls[0].body as { media_urls?: unknown }).media_urls,
    ).toBeUndefined();

    const body = (await response.json()) as {
      message: { attachments: unknown[] };
    };
    expect(body.message.attachments).toEqual([]);
  });

  it("a text-only compose never consults the module gate (#12)", async () => {
    const stubs = composeStubs({ mmsEnabled: false });
    stubFetch(...stubs.all);

    const response = await postCompose(VALID_BODY);
    // Text is unaffected by the mms add-on gate.
    expect(response.status).toBe(201);
    expect(stubs.telnyx.calls).toHaveLength(1);
  });

  it.each([
    [
      "more than 3 items",
      {
        media: Array.from({ length: 4 }, () => ({
          content_type: "image/png",
          base64: PIXEL,
        })),
      },
    ],
    [
      "unsupported content type",
      { media: [{ content_type: "image/tiff", base64: PIXEL }] },
    ],
    [
      "invalid base64",
      { media: [{ content_type: "image/png", base64: "!!!not-base64!!!" }] },
    ],
    [
      "decoded item over 1 MB",
      {
        media: [
          {
            content_type: "image/png",
            base64: btoa("x".repeat(1024 * 1024 + 3)),
          },
        ],
      },
    ],
  ])("422 validation_failed: %s", async (_label, bodyOverrides) => {
    const stubs = composeStubs();
    stubFetch(...stubs.all);

    const response = await postCompose({ ...VALID_BODY, ...bodyOverrides });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
    // Rejected before any DB work or send.
    expect(stubs.gateRpc.calls).toHaveLength(0);
    expect(stubs.conversationInsert.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });

  it("replays an idempotent media compose with its stored attachments → 200", async () => {
    const replayed = messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      telnyx_message_id: TELNYX_ID,
    });
    const stubs = composeStubs({
      replay: [replayed],
      attachments: [
        {
          id: "att-1",
          message_id: MESSAGE_ID,
          content_type: "image/jpeg",
          size_bytes: 4,
        },
      ],
    });
    stubFetch(...stubs.all);

    const response = await postCompose({
      ...VALID_BODY,
      media: [{ content_type: "image/jpeg", base64: PIXEL }],
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      message: { id: string; attachments: unknown[] };
    };
    expect(body.message.id).toBe(MESSAGE_ID);
    expect(body.message.attachments).toEqual([
      { id: "att-1", content_type: "image/jpeg", size_bytes: 4 },
    ]);

    // Pure replay — no re-run, no re-upload, no Telnyx call.
    expect(stubs.gateRpc.calls).toHaveLength(0);
    expect(stubs.upload.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });
});
