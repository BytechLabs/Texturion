/**
 * /webhooks/telnyx suite (SPEC §7, §5, §6): REAL Ed25519 signature
 * verification (via the verify contract), ledger dedupe, ack-then-waitUntil
 * dispatch, the inbound pipeline against a realistic message.received payload
 * (threading RPC args asserted at the PostgREST HTTP layer), STOP/START
 * keyword handling, inbound MMS download/store, and 10dlc.* forwarding.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import type { Env } from "../env";
// Resolved to the contract double (vitest alias) until src/telnyx lands in
// the integrated tree; the double is a vi.fn so forwarding is assertable.
import { handle10dlcEvent } from "../telnyx/registration";
import {
  messageReceivedEvent,
  pgUniqueViolation,
  restMatch,
  rpcMatch,
  signedTelnyxRequest,
  storageUploadMatch,
  stubRoute,
  telnyxSigningKeys,
  testExecutionContext,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { telnyxWebhookRoute } from "./telnyx";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const MESSAGE_ID = "99999999-0000-4000-8000-000000000099";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";

let env: Env;
let privateKey: CryptoKey;

const app = new Hono<AppEnv>();
app.route("/webhooks/telnyx", telnyxWebhookRoute);

beforeEach(async () => {
  const keys = await telnyxSigningKeys();
  privateKey = keys.privateKey;
  env = { ...completeEnv(), TELNYX_PUBLIC_KEY: keys.publicKeyB64 };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * Away-settings lookup (FEATURE-GAPS Step 1). The inbound pipeline reads
 * companies away-settings on every first-delivery inbound; a company with
 * away_enabled=false short-circuits the away branch (no send), which is the
 * default for these threading/opt-out/MMS suites. A dedicated away-reply suite
 * exercises the enabled path.
 */
function awayDisabledStub() {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => url.searchParams.get("select")?.includes("away_enabled") ?? false,
    ),
    () => [
      {
        timezone: "America/Toronto",
        business_hours: {},
        away_enabled: false,
        away_message: null,
        name: "Test Co",
        google_review_link: null,
      },
    ],
  );
}

/** Ledger stubs: insert-once then conflict-empty on repeats. */
function ledgerStubs() {
  const seen = new Set<string>();
  const insert = stubRoute(restMatch(env, "POST", "webhook_events"), (call) => {
    const row = call.body as { event_id: string };
    if (seen.has(row.event_id)) return [];
    seen.add(row.event_id);
    return [{ event_id: row.event_id }];
  });
  const stamp = stubRoute(restMatch(env, "PATCH", "webhook_events"));
  return { insert, stamp };
}

function serve(...routes: (Stub | { route: FetchRoute })[]) {
  stubFetch(...routes.map((stub) => stub.route));
}

async function deliver(event: unknown, options?: { timestamp?: number; tamper?: boolean }) {
  const { ctx, flush } = testExecutionContext();
  const request = await signedTelnyxRequest(privateKey, event, options);
  const response = await app.fetch(request, env, ctx);
  return { response, flush };
}

describe("POST /webhooks/telnyx — verification", () => {
  it("rejects a tampered signature with 400 and never touches the ledger", async () => {
    const ledger = ledgerStubs();
    serve(ledger.insert, ledger.stamp);

    const { response } = await deliver(messageReceivedEvent(), { tamper: true });
    expect(response.status).toBe(400);
    expect(ledger.insert.calls).toHaveLength(0);
  });

  it("rejects a stale timestamp (>5 min) even with a valid signature", async () => {
    const ledger = ledgerStubs();
    serve(ledger.insert, ledger.stamp);

    const { response } = await deliver(messageReceivedEvent(), {
      timestamp: Math.floor(Date.now() / 1000) - 6 * 60,
    });
    expect(response.status).toBe(400);
    expect(ledger.insert.calls).toHaveLength(0);
  });

  it("acks an authentic but unusable envelope without processing", async () => {
    const ledger = ledgerStubs();
    serve(ledger.insert, ledger.stamp);

    const { response, flush } = await deliver({ data: { payload: {} } });
    expect(response.status).toBe(200);
    await flush();
    expect(ledger.insert.calls).toHaveLength(0);
  });
});

describe("POST /webhooks/telnyx — ledger + dispatch", () => {
  it("threads an inbound SMS: ledger insert, 200 ack, RPC called with the right args, processed stamped", async () => {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      created: true,
      opted_out: false,
    }));
    serve(ledger.insert, ledger.stamp, numberLookup, threadRpc, awayDisabledStub());

    const event = messageReceivedEvent({
      eventId: "e1e1e1e1-0000-4000-8000-000000000001",
      telnyxMessageId: "40385f64-5717-4562-b3fc-2c963f66aaaa",
      from: "+16135551000",
      to: "+16135550100",
      text: "Hi, do you do gutters?",
    });
    const { response, flush } = await deliver(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    await flush();

    // Ledger row carried the full event.
    expect(ledger.insert.calls).toHaveLength(1);
    const inserted = ledger.insert.calls[0].body as Record<string, unknown>;
    expect(inserted.provider).toBe("telnyx");
    expect(inserted.event_id).toBe("e1e1e1e1-0000-4000-8000-000000000001");
    expect(inserted.event_type).toBe("message.received");

    // Receiving-number resolution hit PostgREST with the webhook's "to".
    const lookupUrl = numberLookup.calls[0].url;
    expect(lookupUrl.searchParams.get("number_e164")).toBe("eq.+16135550100");
    expect(lookupUrl.searchParams.get("status")).toBe("neq.released");

    // The threading RPC got exactly the §6 transaction inputs.
    expect(threadRpc.calls).toHaveLength(1);
    expect(threadRpc.calls[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_phone_number_id: NUMBER_ID,
      p_from_e164: "+16135551000",
      p_body: "Hi, do you do gutters?",
      p_telnyx_message_id: "40385f64-5717-4562-b3fc-2c963f66aaaa",
    });

    // processed_at stamped.
    expect(ledger.stamp.calls).toHaveLength(1);
    expect(ledger.stamp.calls[0].body).toMatchObject({
      processed_at: expect.any(String),
    });
  });

  it("acks a duplicate delivery from the ledger without dispatching", async () => {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      created: true,
      opted_out: false,
    }));
    serve(ledger.insert, ledger.stamp, numberLookup, threadRpc, awayDisabledStub());

    const event = messageReceivedEvent();
    const first = await deliver(event);
    await first.flush();
    const second = await deliver(event);
    expect(second.response.status).toBe(200);
    expect(await second.response.json()).toEqual({
      received: true,
      duplicate: true,
    });
    await second.flush();

    expect(threadRpc.calls).toHaveLength(1); // first delivery only
  });

  it("acks unknown event types as no-ops and stamps them processed", async () => {
    const ledger = ledgerStubs();
    serve(ledger.insert, ledger.stamp);

    const { response, flush } = await deliver({
      data: {
        event_type: "message.some_future_thing",
        id: "e2e2e2e2-0000-4000-8000-000000000002",
        payload: {},
      },
    });
    expect(response.status).toBe(200);
    await flush();
    expect(ledger.stamp.calls).toHaveLength(1);
  });

  it("forwards 10dlc.* events to the registration contract", async () => {
    const ledger = ledgerStubs();
    serve(ledger.insert, ledger.stamp);

    const event = {
      data: {
        event_type: "10dlc.campaign.update",
        id: "e3e3e3e3-0000-4000-8000-000000000003",
        payload: { campaignId: "cmp-1", status: "ACCEPTED" },
      },
    };
    const { response, flush } = await deliver(event);
    expect(response.status).toBe(200);
    await flush();

    expect(handle10dlcEvent).toHaveBeenCalledTimes(1);
    expect(handle10dlcEvent).toHaveBeenCalledWith(env, event);
    expect(ledger.stamp.calls).toHaveLength(1);
  });

  it("records the failure (attempts + last_error) when processing throws", async () => {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(
      rpcMatch(env, "thread_inbound_message"),
      () => Response.json({ message: "boom" }, { status: 500 }),
    );
    const attemptsLookup = stubRoute(
      restMatch(env, "GET", "webhook_events"),
      () => [{ attempts: 0 }],
    );
    serve(
      ledger.insert,
      ledger.stamp,
      numberLookup,
      threadRpc,
      attemptsLookup,
      awayDisabledStub(),
    );

    const { response, flush } = await deliver(messageReceivedEvent());
    expect(response.status).toBe(200); // still acked — sweeper owns retries
    await flush();

    const failurePatch = ledger.stamp.calls.find(
      (call) => (call.body as Record<string, unknown>).attempts === 1,
    );
    expect(failurePatch).toBeDefined();
    expect(
      (failurePatch?.body as Record<string, unknown>).last_error,
    ).toContain("thread_inbound_message failed");
  });
});

describe("inbound pipeline — opt-out keywords (§5)", () => {
  async function deliverKeyword(
    text: string,
    threadResult: { created: boolean; opted_out: boolean },
    extraStubs: Stub[] = [],
  ) {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      ...threadResult,
    }));
    const optOutUpsert = stubRoute(restMatch(env, "POST", "opt_outs"), () =>
      Response.json([], { status: 201 }),
    );
    const optOutRevoke = stubRoute(restMatch(env, "PATCH", "opt_outs"), () => [
      { id: "0f0f0f0f-0000-4000-8000-000000000001" },
    ]);
    const events = stubRoute(restMatch(env, "POST", "conversation_events"), () =>
      Response.json([], { status: 201 }),
    );
    serve(
      ledger.insert,
      ledger.stamp,
      numberLookup,
      threadRpc,
      optOutUpsert,
      optOutRevoke,
      events,
      awayDisabledStub(),
      ...extraStubs,
    );
    const { response, flush } = await deliver(
      messageReceivedEvent({ text, eventId: crypto.randomUUID() }),
    );
    expect(response.status).toBe(200);
    await flush();
    return { optOutUpsert, optOutRevoke, events };
  }

  it("STOP writes the opt_outs row (stop_keyword) and an opted_out event", async () => {
    const { optOutUpsert, events } = await deliverKeyword("STOP", {
      created: true,
      opted_out: false,
    });
    expect(optOutUpsert.calls).toHaveLength(1);
    expect(optOutUpsert.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      phone_e164: "+16135551000",
      source: "stop_keyword",
      revoked_at: null,
    });
    // Upsert (never a second row) on the (company, phone) unique.
    expect(optOutUpsert.calls[0].url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );
    expect(events.calls).toHaveLength(1);
    expect(events.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      actor_user_id: null,
      type: "opted_out",
    });
  });

  it("detects standalone keywords case-insensitively with surrounding whitespace", async () => {
    const { optOutUpsert } = await deliverKeyword("  unsubscribe  ", {
      created: true,
      opted_out: false,
    });
    expect(optOutUpsert.calls).toHaveLength(1);
  });

  it("does NOT opt out on a sentence containing stop", async () => {
    const { optOutUpsert, events } = await deliverKeyword(
      "please stop by tomorrow",
      { created: true, opted_out: false },
    );
    expect(optOutUpsert.calls).toHaveLength(0);
    expect(events.calls).toHaveLength(0);
  });

  it("START revokes an active opt-out and writes opt_out_revoked", async () => {
    const { optOutRevoke, events } = await deliverKeyword("START", {
      created: true,
      opted_out: true,
    });
    expect(optOutRevoke.calls).toHaveLength(1);
    const url = optOutRevoke.calls[0].url;
    expect(url.searchParams.get("phone_e164")).toBe("eq.+16135551000");
    expect(url.searchParams.get("revoked_at")).toBe("is.null");
    expect(events.calls).toHaveLength(1);
    expect(events.calls[0].body).toMatchObject({ type: "opt_out_revoked" });
  });

  it("skips keyword side effects on a duplicate delivery (created=false)", async () => {
    const { optOutUpsert, events } = await deliverKeyword("STOP", {
      created: false,
      opted_out: true,
    });
    expect(optOutUpsert.calls).toHaveLength(0);
    expect(events.calls).toHaveLength(0);
  });
});

describe("inbound pipeline — notification pipeline (§8)", () => {
  const MEMBER_USER = "10000000-aaaa-4000-8000-000000000001";

  function notificationStubs(notify: boolean) {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      created: true,
      opted_out: false,
      notify,
    }));
    const conversationLookup = stubRoute(
      restMatch(env, "GET", "conversations"),
      () => [
        {
          id: CONVERSATION_ID,
          assigned_user_id: null,
          is_spam: false,
          contacts: { name: "Dana Smith", phone_e164: "+16135551000" },
        },
      ],
    );
    const membersLookup = stubRoute(
      restMatch(env, "GET", "company_members"),
      () => [{ user_id: MEMBER_USER }],
    );
    // Email on, push off: the email leg alone proves the pipeline ran.
    const prefsLookup = stubRoute(
      restMatch(env, "GET", "notification_prefs"),
      () => [
        { user_id: MEMBER_USER, email_enabled: true, push_enabled: false },
      ],
    );
    const adminUser = stubRoute(
      (url, request) =>
        request.method === "GET" &&
        url.pathname === `/auth/v1/admin/users/${MEMBER_USER}`,
      () => ({ id: MEMBER_USER, email: "owner@team.example" }),
    );
    const resend = stubRoute(
      (url, request) =>
        request.method === "POST" && url.href === "https://api.resend.com/emails",
      () => ({ id: "email_1" }),
    );
    return {
      ledger,
      stubs: [
        ledger.insert,
        ledger.stamp,
        numberLookup,
        threadRpc,
        awayDisabledStub(),
        conversationLookup,
        membersLookup,
        prefsLookup,
        adminUser,
        resend,
      ],
      resend,
    };
  }

  it("notify=true from the threading RPC drives the §8 email with name + snippet + deep link", async () => {
    const world = notificationStubs(true);
    serve(...world.stubs);

    const { response, flush } = await deliver(
      messageReceivedEvent({ text: "Hi, do you do gutters?" }),
    );
    expect(response.status).toBe(200);
    await flush();

    expect(world.resend.calls).toHaveLength(1);
    const email = world.resend.calls[0].body as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(email.to).toEqual(["owner@team.example"]);
    expect(email.subject).toBe("New text from Dana Smith");
    expect(email.text).toContain("Hi, do you do gutters?");
    expect(email.text).toContain(
      `${env.APP_ORIGIN}/inbox/${CONVERSATION_ID}`,
    );
    expect(world.ledger.stamp.calls).toHaveLength(1); // processed
  });

  it("notify=false (debounced) sends nothing", async () => {
    const world = notificationStubs(false);
    serve(...world.stubs);

    const { flush } = await deliver(
      messageReceivedEvent({ text: "Second message seconds later" }),
    );
    await flush();

    expect(world.resend.calls).toHaveLength(0);
    expect(world.ledger.stamp.calls).toHaveLength(1); // still processed
  });
});

describe("inbound pipeline — MMS media (§7)", () => {
  const MEDIA_URL = "https://media.telnyx.com/aaaa-bbbb-cccc";

  function mediaStubs(existingSourceUrls: string[] = []) {
    const ledger = ledgerStubs();
    const numberLookup = stubRoute(
      restMatch(env, "GET", "phone_numbers"),
      () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
    );
    const threadRpc = stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      created: true,
      opted_out: false,
    }));
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => existingSourceUrls.map((source_url) => ({ source_url })),
    );
    const mediaDownload = stubRoute(
      (url, request) => request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          headers: { "content-type": "image/jpeg" },
        }),
    );
    const upload = stubRoute(storageUploadMatch(env), () => ({
      Key: "mms-media/x",
    }));
    const attachmentInsert = stubRoute(
      restMatch(env, "POST", "message_attachments"),
      () => Response.json([], { status: 201 }),
    );
    return {
      ledger,
      numberLookup,
      threadRpc,
      away: awayDisabledStub(),
      attachmentLookup,
      mediaDownload,
      upload,
      attachmentInsert,
    };
  }

  it("downloads, stores, and records each media item", async () => {
    const stubs = mediaStubs();
    serve(
      stubs.ledger.insert,
      stubs.ledger.stamp,
      stubs.numberLookup,
      stubs.threadRpc,
      stubs.away,
      stubs.attachmentLookup,
      stubs.mediaDownload,
      stubs.upload,
      stubs.attachmentInsert,
    );

    const { response, flush } = await deliver(
      messageReceivedEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 4 }],
      }),
    );
    expect(response.status).toBe(200);
    await flush();

    expect(stubs.mediaDownload.calls).toHaveLength(1);
    expect(stubs.upload.calls).toHaveLength(1);
    expect(stubs.upload.calls[0].url.pathname).toBe(
      `/storage/v1/object/mms-media/${COMPANY_ID}/${MESSAGE_ID}/0`,
    );
    expect(stubs.attachmentInsert.calls).toHaveLength(1);
    expect(stubs.attachmentInsert.calls[0].body).toMatchObject({
      message_id: MESSAGE_ID,
      company_id: COMPANY_ID,
      storage_path: `${COMPANY_ID}/${MESSAGE_ID}/0`,
      content_type: "image/jpeg",
      size_bytes: 4,
      source_url: MEDIA_URL, // inbound rows keep the Telnyx URL (§6)
    });
    expect(stubs.ledger.stamp.calls).toHaveLength(1); // processed
  });

  it("is idempotent: already-stored source URLs are never re-downloaded", async () => {
    const stubs = mediaStubs([MEDIA_URL]);
    serve(
      stubs.ledger.insert,
      stubs.ledger.stamp,
      stubs.numberLookup,
      stubs.threadRpc,
      stubs.away,
      stubs.attachmentLookup,
      stubs.mediaDownload,
      stubs.upload,
      stubs.attachmentInsert,
    );

    const { flush } = await deliver(
      messageReceivedEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 4 }],
      }),
    );
    await flush();

    expect(stubs.mediaDownload.calls).toHaveLength(0);
    expect(stubs.upload.calls).toHaveLength(0);
    expect(stubs.attachmentInsert.calls).toHaveLength(0);
  });

  it("skips unsupported media types without failing the pipeline", async () => {
    const stubs = mediaStubs();
    const videoDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new Uint8Array([0x00]), {
          headers: { "content-type": "video/mp4" },
        }),
    );
    serve(
      stubs.ledger.insert,
      stubs.ledger.stamp,
      stubs.numberLookup,
      stubs.threadRpc,
      stubs.away,
      stubs.attachmentLookup,
      videoDownload,
      stubs.upload,
      stubs.attachmentInsert,
    );

    const { flush } = await deliver(
      messageReceivedEvent({
        media: [{ url: MEDIA_URL, content_type: "video/mp4" }],
      }),
    );
    await flush();

    expect(stubs.upload.calls).toHaveLength(0);
    expect(stubs.attachmentInsert.calls).toHaveLength(0);
    expect(stubs.ledger.stamp.calls).toHaveLength(1); // still processed
  });

  it("insert conflicts on (message_id, source_url) are benign (concurrent replay)", async () => {
    const stubs = mediaStubs();
    const conflictInsert = stubRoute(
      restMatch(env, "POST", "message_attachments"),
      () => pgUniqueViolation(),
    );
    serve(
      stubs.ledger.insert,
      stubs.ledger.stamp,
      stubs.numberLookup,
      stubs.threadRpc,
      stubs.away,
      stubs.attachmentLookup,
      stubs.mediaDownload,
      stubs.upload,
      conflictInsert,
    );

    const { flush } = await deliver(
      messageReceivedEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg" }],
      }),
    );
    await flush();
    expect(stubs.ledger.stamp.calls).toHaveLength(1); // processed, not failed
  });
});
