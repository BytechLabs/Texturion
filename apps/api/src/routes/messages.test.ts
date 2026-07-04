/**
 * POST /v1/messages/send + retry + GET /v1/conversations/:id/messages suite
 * (SPEC §5, §7, §8, §10): the full gate-order matrix (each gate returns its
 * §7 code, in order), idempotent send (same key twice → one Telnyx call),
 * footer exactly-once, the MMS validation matrix + storage upload flow, and
 * the §7 retry rules. Real middleware chain (JWT + company context), real
 * product code, fetch-edge stubs only.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import type { MessageRow } from "../messaging/types";
// Resolved to the contract double (vitest alias): a vi.fn defaulting to
// all-gates-open, overridable per test.
import { getSendGates } from "../telnyx/registration";
import {
  messageRow,
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
import { messageRoutes } from "./messages";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const CONTACT_ID = "eeeeeeee-0000-4000-8000-00000000000e";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66dddd";

let auth: TestAuth;

const app = new Hono<AppEnv>();
app.use("/v1/*", jwtAuth());
app.use("/v1/*", companyContext());
app.route("/v1", messageRoutes);
app.onError((error, c) => {
  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message);
  }
  return c.json(
    { error: { code: "internal_error", message: String(error) } },
    500,
  );
});

// One keypair per file: jose's remote-JWKS resolver caches the key set per
// URL for the whole worker, so re-minting keys per test would 401.
const env: Env = completeEnv();
beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function sendView(overrides: Partial<{
  first_identification_sent_at: string | null;
  phone_e164: string;
  number_status: string;
  contact_name: string | null;
  google_review_link: string | null;
}> = {}) {
  return {
    id: CONVERSATION_ID,
    contact_id: CONTACT_ID,
    phone_number_id: NUMBER_ID,
    contacts: {
      id: CONTACT_ID,
      phone_e164: overrides.phone_e164 ?? "+16135551000",
      name: overrides.contact_name ?? null,
      first_identification_sent_at:
        overrides.first_identification_sent_at ?? null,
    },
    phone_numbers: {
      id: NUMBER_ID,
      number_e164: "+16135550100",
      status: overrides.number_status ?? "active",
    },
    companies: {
      id: COMPANY_ID,
      name: "Acme Plumbing",
      google_review_link: overrides.google_review_link ?? null,
    },
  };
}

interface SendStubs {
  conversationView: Stub;
  inboundCheck: Stub;
  gateRpc: Stub;
  footerStamp: Stub;
  telnyx: Stub;
  persist: Stub;
  attachmentsLookup: Stub;
  upload: Stub;
  attachmentInsert: Stub;
  sign: Stub;
  all: FetchRoute[];
}

function sendStubs(options: {
  view?: ReturnType<typeof sendView>;
  hasInbound?: boolean;
  gate?: (call: { body: unknown }) => unknown;
} = {}): SendStubs {
  const view = options.view ?? sendView();
  const conversationView = stubRoute(
    restMatch(env, "GET", "conversations"),
    () => [view],
  );
  const inboundCheck = stubRoute(
    restMatch(
      env,
      "GET",
      "messages",
      (url) => url.searchParams.get("direction") === "eq.inbound",
    ),
    () => (options.hasInbound ? [{ id: "some-inbound" }] : []),
  );
  const gateRpc = stubRoute(
    rpcMatch(env, "gate_outbound_send"),
    options.gate ??
      ((call) => {
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
      }),
  );
  const footerStamp = stubRoute(
    restMatch(
      env,
      "PATCH",
      "contacts",
      (url) => url.searchParams.get("first_identification_sent_at") === "is.null",
    ),
    () => new Response(null, { status: 204 }),
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
  const attachmentsLookup = stubRoute(
    restMatch(env, "GET", "message_attachments"),
    () => [],
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
    conversationView,
    inboundCheck,
    gateRpc,
    footerStamp,
    telnyx,
    persist,
    attachmentsLookup,
    upload,
    attachmentInsert,
    sign,
    all: [
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      conversationView.route,
      inboundCheck.route,
      gateRpc.route,
      footerStamp.route,
      telnyx.route,
      persist.route,
      attachmentsLookup.route,
      upload.route,
      attachmentInsert.route,
      sign.route,
    ],
  };
}

async function postSend(
  body: unknown,
  options: { idempotencyKey?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await auth.token()}`,
    "X-Company-Id": COMPANY_ID,
    "content-type": "application/json",
  };
  if (options.idempotencyKey !== null) {
    headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
  }
  return app.fetch(
    new Request("https://api.jobtext.app/v1/messages/send", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("POST /v1/messages/send — gate order (§7)", () => {
  it("requires an Idempotency-Key (422)", async () => {
    const stubs = sendStubs();
    stubFetch(...stubs.all);
    const response = await postSend(
      { conversation_id: CONVERSATION_ID, body: "hi" },
      { idempotencyKey: null },
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("gate 1 — subscription_inactive (402) before any other gate", async () => {
    vi.mocked(getSendGates).mockResolvedValueOnce({
      subscriptionActive: false,
      usApproved: false, // also unregistered — subscription must win
      caAllowed: true,
    });
    const stubs = sendStubs();
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(402);
    expect(await errorCode(response)).toBe("subscription_inactive");
    expect(stubs.gateRpc.calls).toHaveLength(0);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });

  it("gate 2 — non-US/CA NANP destination is 422 (pumping defense, §10)", async () => {
    // 242 = Bahamas: +1 but NOT a US/CA area code.
    const stubs = sendStubs({ view: sendView({ phone_e164: "+12425551234" }) });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
    expect(stubs.gateRpc.calls).toHaveLength(0);
  });

  it("gate 3 — US destination without an approved campaign is 403 registration_pending", async () => {
    vi.mocked(getSendGates).mockResolvedValueOnce({
      subscriptionActive: true,
      usApproved: false,
      caAllowed: true,
    });
    // 212 = New York.
    const stubs = sendStubs({ view: sendView({ phone_e164: "+12125551234" }) });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("registration_pending");
    expect(stubs.gateRpc.calls).toHaveLength(0);
  });

  it("CA destinations send while US approval is pending (per-destination gating, §4.2)", async () => {
    vi.mocked(getSendGates).mockResolvedValueOnce({
      subscriptionActive: true,
      usApproved: false,
      caAllowed: true,
    });
    // 613 = Ottawa, CA.
    const stubs = sendStubs({ view: sendView({ phone_e164: "+16135551000" }) });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(201);
    expect(stubs.telnyx.calls).toHaveLength(1);
  });

  it.each([
    ["recipient_opted_out", 403],
    ["rate_limited", 429],
    ["usage_cap_reached", 402],
  ] as const)(
    "gates 4–6 — RPC rejection %s maps to %d",
    async (code, status) => {
      const stubs = sendStubs({ gate: () => ({ error: code }) });
      stubFetch(...stubs.all);

      const response = await postSend({
        conversation_id: CONVERSATION_ID,
        body: "hi",
      });
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
      expect(stubs.telnyx.calls).toHaveLength(0); // rejected before Telnyx
    },
  );

  it("404s a conversation outside the company", async () => {
    const stubs = sendStubs();
    const emptyView = stubRoute(restMatch(env, "GET", "conversations"), () => []);
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      emptyView.route,
      ...stubs.all,
    );

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /v1/messages/send — happy path + idempotency (§7, §8)", () => {
  it("queues, calls Telnyx with from/to/text, persists the telnyx id", async () => {
    const stubs = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
    });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "On our way!",
    });
    expect(response.status).toBe(201);

    // Insert-before-call happened via the RPC with the estimator's count.
    expect(stubs.gateRpc.calls).toHaveLength(1);
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_conversation_id: CONVERSATION_ID,
      p_sender_user_id: auth.subject,
      p_body: "On our way!",
      p_segments_estimate: 1,
    });

    // Telnyx got the §8 shape.
    expect(stubs.telnyx.calls).toHaveLength(1);
    expect(stubs.telnyx.calls[0].body).toEqual({
      from: "+16135550100",
      to: "+16135551000",
      text: "On our way!",
    });
    expect(
      stubs.telnyx.calls[0].headers.get("authorization"),
    ).toBe(`Bearer ${env.TELNYX_API_KEY}`);

    // telnyx_message_id persisted on the row.
    expect(stubs.persist.calls[0].body).toEqual({
      telnyx_message_id: TELNYX_ID,
    });
    const body = (await response.json()) as MessageRow & {
      attachments: unknown[];
    };
    expect(body.telnyx_message_id).toBe(TELNYX_ID);
    expect(body.status).toBe("queued");
    expect(body.attachments).toEqual([]);
  });

  it("same Idempotency-Key twice → one Telnyx call, second response 200", async () => {
    const key = crypto.randomUUID();
    let calls = 0;
    const stubs = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
      gate: (call) => {
        calls += 1;
        const params = call.body as { p_body: string };
        return {
          message: messageRow({
            id: MESSAGE_ID,
            company_id: COMPANY_ID,
            conversation_id: CONVERSATION_ID,
            body: params.p_body,
            ...(calls > 1 ? { telnyx_message_id: TELNYX_ID } : {}),
          }),
          existing: calls > 1,
        };
      },
    });
    stubFetch(...stubs.all);

    const first = await postSend(
      { conversation_id: CONVERSATION_ID, body: "hi" },
      { idempotencyKey: key },
    );
    const second = await postSend(
      { conversation_id: CONVERSATION_ID, body: "hi" },
      { idempotencyKey: key },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(stubs.telnyx.calls).toHaveLength(1); // exactly one send
  });

  it("a key reused against a different conversation is 409 conflict", async () => {
    const stubs = sendStubs({
      gate: () => ({
        message: messageRow({
          conversation_id: "f0f0f0f0-0000-4000-8000-0000000000f0",
        }),
        existing: true,
      }),
    });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(409);
    expect(stubs.telnyx.calls).toHaveLength(0);
  });

  it("surfaces a Telnyx API failure on the row: status failed + detail (§8)", async () => {
    const stubs = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
    });
    const failingTelnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () =>
        Response.json(
          { errors: [{ code: "40310", detail: "Unreachable destination" }] },
          { status: 400 },
        ),
    );
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      stubs.conversationView.route,
      stubs.inboundCheck.route,
      stubs.gateRpc.route,
      failingTelnyx.route,
      stubs.persist.route,
      stubs.attachmentsLookup.route,
    );

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "hi",
    });
    expect(response.status).toBe(201);
    expect(stubs.persist.calls[0].body).toMatchObject({
      status: "failed",
      error_code: "40310",
      error_detail: "Unreachable destination",
    });
    const body = (await response.json()) as MessageRow;
    expect(body.status).toBe("failed");
    expect(body.error_code).toBe("40310");
  });
});

describe("POST /v1/messages/send — §5 footer exactly-once", () => {
  it("appends the footer on the first outbound-first message and stamps the contact", async () => {
    const stubs = sendStubs(); // first_identification_sent_at null, no inbound
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "On our way!",
    });
    expect(response.status).toBe(201);

    const expected = "On our way!\n— Acme Plumbing. Reply STOP to opt out";
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_body: expected });
    expect(stubs.telnyx.calls[0].body).toMatchObject({ text: expected });
    expect(stubs.footerStamp.calls).toHaveLength(1);
    expect(stubs.footerStamp.calls[0].url.searchParams.get("id")).toBe(
      `eq.${CONTACT_ID}`,
    );
  });

  it("never decorates once the contact is stamped", async () => {
    const stubs = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
    });
    stubFetch(...stubs.all);

    await postSend({ conversation_id: CONVERSATION_ID, body: "Again" });
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_body: "Again" });
    expect(stubs.footerStamp.calls).toHaveLength(0);
  });

  it("never decorates replies to inbound conversations", async () => {
    const stubs = sendStubs({ hasInbound: true });
    stubFetch(...stubs.all);

    await postSend({ conversation_id: CONVERSATION_ID, body: "Reply" });
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_body: "Reply" });
    expect(stubs.footerStamp.calls).toHaveLength(0);
  });
});

describe("POST /v1/messages/send — merge-fields (Step 0a)", () => {
  it("substitutes {first_name}/{business_name} server-side at send time", async () => {
    // Reply thread (hasInbound) so the footer never masks the merge output.
    const stubs = sendStubs({
      view: sendView({ contact_name: "Dana Whitfield" }),
      hasInbound: true,
    });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "Hi {first_name}, thanks for choosing {business_name}!",
    });
    expect(response.status).toBe(201);
    const expected = "Hi Dana, thanks for choosing Acme Plumbing!";
    // The MERGED text is what the gate stores and what Telnyx sends.
    expect(stubs.gateRpc.calls[0].body).toMatchObject({ p_body: expected });
    expect(stubs.telnyx.calls[0].body).toMatchObject({ text: expected });
  });

  it("substitutes {review_link} from the company link", async () => {
    const stubs = sendStubs({
      view: sendView({
        contact_name: "Sam",
        google_review_link: "https://g.page/r/xyz",
      }),
      hasInbound: true,
    });
    stubFetch(...stubs.all);

    await postSend({
      conversation_id: CONVERSATION_ID,
      body: "Review us: {review_link}",
    });
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_body: "Review us: https://g.page/r/xyz",
    });
  });

  it("drops an unknown/empty token cleanly (no literal braces on the wire)", async () => {
    // No contact name → {first_name} degrades gracefully.
    const stubs = sendStubs({ view: sendView({ contact_name: null }), hasInbound: true });
    stubFetch(...stubs.all);

    await postSend({
      conversation_id: CONVERSATION_ID,
      body: "Hi {first_name}, on our way.",
    });
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_body: "Hi, on our way.",
    });
  });
});

describe("POST /v1/messages/send — MMS (§7, §8)", () => {
  const PIXEL = btoa("\x89PNG\r\n\x1a\n fake image bytes");

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
    ["empty body and no media", { body: "   " }],
  ])("422 validation_failed: %s", async (_label, bodyOverrides) => {
    const stubs = sendStubs();
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "",
      ...bodyOverrides,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
    expect(stubs.gateRpc.calls).toHaveLength(0);
  });

  it("uploads to Storage, records attachments, and sends signed media_urls", async () => {
    const stubs = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
    });
    stubFetch(...stubs.all);

    const response = await postSend({
      conversation_id: CONVERSATION_ID,
      body: "photo attached",
      media: [{ content_type: "image/jpeg", base64: PIXEL }],
    });
    expect(response.status).toBe(201);

    // MMS pre-checks as 3 segments (§2).
    expect(stubs.gateRpc.calls[0].body).toMatchObject({
      p_segments_estimate: 3,
    });

    // Stored at mms-media/{company}/{message}/{n}.
    expect(stubs.upload.calls).toHaveLength(1);
    expect(stubs.upload.calls[0].url.pathname).toBe(
      `/storage/v1/object/mms-media/${COMPANY_ID}/${MESSAGE_ID}/0`,
    );

    // Attachment row: outbound rows carry source_url NULL (§6).
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

    const body = (await response.json()) as { attachments: unknown[] };
    expect(body.attachments).toHaveLength(1);
  });
});

describe("POST /v1/messages/:id/retry (§7)", () => {
  function retryStubs(row: Partial<MessageRow>) {
    const message = messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      ...row,
    });
    const lookup = stubRoute(
      restMatch(
        env,
        "GET",
        "messages",
        (url) => url.searchParams.get("id") === `eq.${MESSAGE_ID}`,
      ),
      () => [message],
    );
    const base = sendStubs({
      view: sendView({ first_identification_sent_at: "2026-06-01T00:00:00Z" }),
    });
    const optOuts = stubRoute(restMatch(env, "GET", "opt_outs"), () => []);
    return {
      base,
      lookup,
      optOuts,
      all: [lookup.route, optOuts.route, ...base.all],
    };
  }

  async function postRetry(): Promise<Response> {
    return app.fetch(
      new Request(
        `https://api.jobtext.app/v1/messages/${MESSAGE_ID}/retry`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await auth.token()}`,
            "X-Company-Id": COMPANY_ID,
          },
        },
      ),
      env,
    );
  }

  it("retries an API-failure row: requeue → new Telnyx call → persist", async () => {
    const stubs = retryStubs({
      status: "failed",
      telnyx_message_id: null,
      error_detail: "network error",
    });
    stubFetch(...stubs.all);

    const response = await postRetry();
    expect(response.status).toBe(200);

    // Requeued (status back to queued, errors cleared) before the call.
    const requeue = stubs.base.persist.calls.find(
      (call) =>
        (call.body as Record<string, unknown>).status === "queued",
    );
    expect(requeue?.body).toMatchObject({
      status: "queued",
      error_code: null,
      error_detail: null,
    });
    expect(stubs.base.telnyx.calls).toHaveLength(1);
    const persisted = stubs.base.persist.calls.find(
      (call) =>
        (call.body as Record<string, unknown>).telnyx_message_id === TELNYX_ID,
    );
    expect(persisted).toBeDefined();
  });

  it("409s a failed row that already has a carrier id (40300-style)", async () => {
    const stubs = retryStubs({
      status: "failed",
      telnyx_message_id: TELNYX_ID,
      error_code: "40300",
    });
    stubFetch(...stubs.all);

    const response = await postRetry();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
    expect(stubs.base.telnyx.calls).toHaveLength(0);
  });

  it("409s a row that is not failed", async () => {
    const stubs = retryStubs({ status: "queued", telnyx_message_id: null });
    stubFetch(...stubs.all);

    const response = await postRetry();
    expect(response.status).toBe(409);
  });

  it("403s when the recipient opted out since the failure", async () => {
    const stubs = retryStubs({ status: "failed", telnyx_message_id: null });
    const optedOut = stubRoute(restMatch(env, "GET", "opt_outs"), () => [
      { id: "op-1" },
    ]);
    stubFetch(stubs.lookup.route, optedOut.route, ...stubs.base.all);

    const response = await postRetry();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("recipient_opted_out");
    expect(stubs.base.telnyx.calls).toHaveLength(0);
  });
});

describe("PATCH /v1/messages/:id — done state (D14)", () => {
  const DONE_AT = "2026-07-02T14:14:00.000Z";

  function doneStubs(row: Partial<MessageRow>, options: { found?: boolean } = {}) {
    const message = messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      ...row,
    });
    const lookup = stubRoute(
      restMatch(
        env,
        "GET",
        "messages",
        (url) => url.searchParams.get("id") === `eq.${MESSAGE_ID}`,
      ),
      () => (options.found === false ? [] : [message]),
    );
    // D14/D22: the done flip AND its audit event are ONE atomic transaction via
    // the set_message_done security-definer RPC (never a separate PATCH +
    // conversation_events INSERT). The stub mirrors the RPC's real semantics:
    // company-scoped not_found, idempotent no-op ('unchanged', no write, no
    // event), and a real transition ('updated', flip + one audit row in the
    // same txn — modelled here as a single call).
    const rpc = stubRoute(rpcMatch(env, "set_message_done"), (call) => {
      const args = call.body as {
        p_company_id: string;
        p_message_id: string;
        p_done: boolean;
        p_actor_user_id: string;
      };
      if (options.found === false || args.p_company_id !== COMPANY_ID) {
        return { outcome: "not_found", message: null };
      }
      const alreadyDone = message.done_at !== null;
      if (args.p_done === alreadyDone) {
        return { outcome: "unchanged", message };
      }
      const flipped = args.p_done
        ? {
            ...message,
            done_at: DONE_AT,
            done_by_user_id: args.p_actor_user_id,
          }
        : { ...message, done_at: null, done_by_user_id: null };
      return { outcome: "updated", message: flipped };
    });
    const attachmentsLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    return {
      lookup,
      rpc,
      attachmentsLookup,
      all: [
        jwksRoute(auth),
        companyMembersRoute(env, [
          { id: "11111111-0000-4000-8000-000000000011", role: "member" },
        ]),
        lookup.route,
        rpc.route,
        attachmentsLookup.route,
      ],
    };
  }

  async function patchDone(body: unknown): Promise<Response> {
    return app.fetch(
      new Request(`https://api.jobtext.app/v1/messages/${MESSAGE_ID}`, {
        method: "PATCH",
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

  it("marks done: flips done_at + done_by_user_id via the atomic RPC", async () => {
    const stubs = doneStubs({ done_at: null, done_by_user_id: null });
    stubFetch(...stubs.all);

    const response = await patchDone({ done: true });
    expect(response.status).toBe(200);

    // Company-scoped everywhere (§10) — the pre-RPC lookup AND the RPC args.
    expect(stubs.lookup.calls[0].url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    // The flip + audit happen in ONE set_message_done transaction (D22 §5.1) —
    // never a separate PATCH + conversation_events round-trip.
    expect(stubs.rpc.calls).toHaveLength(1);
    expect(stubs.rpc.calls[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_message_id: MESSAGE_ID,
      p_done: true,
      p_actor_user_id: auth.subject,
    });

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: MESSAGE_ID,
      done_at: expect.any(String),
      done_by_user_id: auth.subject,
      attachments: [],
    });
    expect(body).not.toHaveProperty("body_tsv");
  });

  it("clears done: nulls both columns via the atomic RPC", async () => {
    const stubs = doneStubs({
      done_at: DONE_AT,
      done_by_user_id: auth.subject,
    });
    stubFetch(...stubs.all);

    const response = await patchDone({ done: false });
    expect(response.status).toBe(200);
    expect(stubs.rpc.calls[0].body).toMatchObject({
      p_done: false,
      p_message_id: MESSAGE_ID,
    });
    expect(await response.json()).toMatchObject({
      done_at: null,
      done_by_user_id: null,
    });
  });

  it("is idempotent: re-marking done returns the row unchanged (RPC no-op)", async () => {
    const stubs = doneStubs({
      done_at: DONE_AT,
      done_by_user_id: auth.subject,
    });
    stubFetch(...stubs.all);

    const response = await patchDone({ done: true });
    expect(response.status).toBe(200);
    // The route delegates idempotency to the RPC: a redundant mark-done returns
    // 'unchanged' — no flip, no audit event (the RPC writes nothing).
    expect(stubs.rpc.calls).toHaveLength(1);
    expect(await response.json()).toMatchObject({
      done_at: DONE_AT,
      done_by_user_id: auth.subject,
    });
  });

  it("is idempotent for not-done too: clearing a clear row is a no-op", async () => {
    const stubs = doneStubs({ done_at: null, done_by_user_id: null });
    stubFetch(...stubs.all);

    const response = await patchDone({ done: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      done_at: null,
      done_by_user_id: null,
    });
  });

  it("404s a message outside the caller's company (tenant isolation, §10)", async () => {
    const stubs = doneStubs({}, { found: false });
    stubFetch(...stubs.all);

    const response = await patchDone({ done: true });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
    // The pre-RPC company-scoped lookup 404s before any write RPC.
    expect(stubs.rpc.calls).toHaveLength(0);
  });

  it("422s a body without a boolean done", async () => {
    const stubs = doneStubs({});
    stubFetch(...stubs.all);
    for (const body of [{}, { done: "yes" }, { done: 1 }]) {
      const response = await patchDone(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(stubs.rpc.calls).toHaveLength(0);
  });

  it("works on notes and inbound rows alike (D14: any message is the task)", async () => {
    for (const row of [
      { direction: "note", status: null } as const,
      { direction: "inbound", status: "received" } as const,
    ]) {
      const stubs = doneStubs({ ...row, done_at: null, done_by_user_id: null });
      stubFetch(...stubs.all);
      const response = await patchDone({ done: true });
      expect(response.status, row.direction).toBe(200);
      expect(stubs.rpc.calls).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /v1/conversations/:id/messages (§7)", () => {
  it("pages newest-first with attachments summarized", async () => {
    const conversationCheck = stubRoute(
      restMatch(env, "GET", "conversations"),
      () => [{ id: CONVERSATION_ID }],
    );
    const rows = [3, 2, 1].map((n) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      conversation_id: CONVERSATION_ID,
      direction: "inbound",
      body: `m${n}`,
      status: "received",
      created_at: `2026-07-01T0${n}:00:00.000Z`,
      message_attachments:
        n === 3
          ? [{ id: "at-1", content_type: "image/jpeg", size_bytes: 4 }]
          : [],
    }));
    const list = stubRoute(restMatch(env, "GET", "messages"), () => rows);
    // T5.1: the list annotates has_task from a batch tasks lookup. Promote the
    // newest message (m3) so the response flags exactly it.
    const tasks = stubRoute(restMatch(env, "GET", "tasks"), () => [
      { message_id: "00000000-0000-4000-8000-000000000003" },
    ]);
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      conversationCheck.route,
      list.route,
      tasks.route,
    );

    const response = await app.fetch(
      new Request(
        `https://api.jobtext.app/v1/conversations/${CONVERSATION_ID}/messages?limit=2`,
        {
          headers: {
            Authorization: `Bearer ${await auth.token()}`,
            "X-Company-Id": COMPANY_ID,
          },
        },
      ),
      env,
    );
    expect(response.status).toBe(200);

    // (created_at, id) DESC keyset, limit+1 probe.
    const query = list.calls[0].url.searchParams;
    expect(query.get("order")).toBe("created_at.desc,id.desc");
    expect(query.get("limit")).toBe("3");
    // D14: every message payload carries the done fields.
    expect(query.get("select")).toContain("done_at");
    expect(query.get("select")).toContain("done_by_user_id");

    const body = (await response.json()) as {
      data: { id: string; attachments: unknown[]; has_task: boolean }[];
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].attachments).toEqual([
      { id: "at-1", content_type: "image/jpeg", size_bytes: 4 },
    ]);
    // T5.1: the promoted newest message is flagged; the other is not.
    expect(body.data[0].has_task).toBe(true);
    expect(body.data[1].has_task).toBe(false);
    // The tasks lookup was company-scoped, live-only, and keyed to the page ids.
    const taskQuery = tasks.calls[0].url.searchParams;
    expect(taskQuery.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(taskQuery.get("deleted_at")).toBe("is.null");
    expect(body.next_cursor).not.toBeNull();
  });

  it("404s an unknown conversation before listing", async () => {
    const conversationCheck = stubRoute(
      restMatch(env, "GET", "conversations"),
      () => [],
    );
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [
        { id: "11111111-0000-4000-8000-000000000011", role: "member" },
      ]),
      conversationCheck.route,
    );

    const response = await app.fetch(
      new Request(
        `https://api.jobtext.app/v1/conversations/${CONVERSATION_ID}/messages`,
        {
          headers: {
            Authorization: `Bearer ${await auth.token()}`,
            "X-Company-Id": COMPANY_ID,
          },
        },
      ),
      env,
    );
    expect(response.status).toBe(404);
  });
});
