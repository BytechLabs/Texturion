/**
 * Inbound-pipeline hardening suite (#39, #121). The full §7 webhook flow
 * lives in webhooks/telnyx.test.ts; these tests drive handleInboundMessage
 * directly for two cost-posture behaviors:
 *   - #121 media storage is budget-free: inbound media is ALWAYS downloaded
 *     and stored — the old #12/#37 plan/storage-budget gate is deleted, so
 *     no plan or api_storage_usage read may happen on the media path (abuse
 *     is handled by the usage-alerts storage_abuse arm, never by dropping a
 *     customer's pictures);
 *   - #39 the daily inbound-notification budget: the threading RPC's
 *     exactly-once notification_alert (80/100) drives the owner alert email,
 *     and a capped claim (notify=false) sends no member fan-out.
 * As everywhere, the ONLY thing stubbed is the network edge (global fetch).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import {
  messageReceivedEvent,
  restMatch,
  rpcMatch,
  storageUploadMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { handleInboundMessage } from "./inbound";
import type { TelnyxEvent } from "./types";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const MESSAGE_ID = "99999999-0000-4000-8000-000000000099";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const OWNER_USER = "10000000-aaaa-4000-8000-000000000001";
const MEDIA_URL = "https://media.telnyx.com/aaaa-bbbb-cccc";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function numberStub(): Stub {
  return stubRoute(restMatch(env, "GET", "phone_numbers"), () => [
    { id: NUMBER_ID, company_id: COMPANY_ID },
  ]);
}

function threadStub(result: Record<string, unknown>): Stub {
  return stubRoute(rpcMatch(env, "thread_inbound_message"), () => ({
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    created: true,
    opted_out: false,
    notify: false,
    ...result,
  }));
}

/** Away-reply settings read (first-delivery branch): disabled → no-op. */
function awayDisabledStub(): Stub {
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
        name: "Ace Plumbing",
      },
    ],
  );
}

/** companies name read for the #39 alert copy. */
function companyNameStub(): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => url.searchParams.get("select") === "name",
    ),
    () => [{ name: "Ace Plumbing" }],
  );
}

/** company_members read (billingRecipients AND the §8 audience share it). */
function membersStub(): Stub {
  return stubRoute(restMatch(env, "GET", "company_members"), () => [
    { user_id: OWNER_USER, role: "owner" },
  ]);
}

function adminUserStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "GET" &&
      url.pathname === `/auth/v1/admin/users/${OWNER_USER}`,
    () => ({ id: OWNER_USER, email: "owner@team.example" }),
  );
}

function resendStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" && url.href === "https://api.resend.com/emails",
    () => ({ id: "email_1" }),
  );
}

function inboundEvent(
  overrides: Parameters<typeof messageReceivedEvent>[0] = {},
): TelnyxEvent {
  return messageReceivedEvent(overrides) as unknown as TelnyxEvent;
}

describe("handleInboundMessage — #121 storage is free (media never budget-gated)", () => {
  it("downloads and stores media without ever consulting a plan or storage budget", async () => {
    const mediaDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          headers: { "content-type": "image/jpeg" },
        }),
    );
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const upload = stubRoute(storageUploadMatch(env), () => ({
      Key: "mms-media/x",
    }));
    const attachmentInsert = stubRoute(
      restMatch(env, "POST", "message_attachments"),
      () => Response.json([], { status: 201 }),
    );
    // Canaries for the RETIRED budget gate (#12/#37 cap-and-drop, deleted by
    // #121): a plan read, or an api_storage_usage sum that reports usage far
    // "over" any budget that ever existed, would have dropped this media
    // under the old gate. Neither may be consulted at all now.
    const planCanary = stubRoute(
      restMatch(
        env,
        "GET",
        "companies",
        (url) => url.searchParams.get("select") === "plan",
      ),
      () => [{ plan: "starter" }],
    );
    const usageCanary = stubRoute(rpcMatch(env, "api_storage_usage"), () => ({
      attachments_bytes: 0,
      mms_bytes: 5 * 1024 ** 4, // 5 TB stored — irrelevant to the media path
    }));
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      mediaDownload,
      upload,
      attachmentInsert,
      planCanary,
      usageCanary,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 4 }],
      }),
    );

    // The customer's picture IS saved, end to end…
    expect(mediaDownload.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(1);
    expect(attachmentInsert.calls).toHaveLength(1);
    // …and no budget input was read on the way (storage cost is the
    // usage-alerts cron's storage_abuse arm now, never an ingest gate).
    expect(planCanary.calls).toHaveLength(0);
    expect(usageCanary.calls).toHaveLength(0);
  });
});

describe("handleInboundMessage — #39 notification budget", () => {
  it("sends the 100% owner alert and skips the member fan-out on a capped claim", async () => {
    const resend = resendStub();
    const conversations = stubRoute(restMatch(env, "GET", "conversations"));
    serve(
      numberStub(),
      // The RPC dropped the claim (past the ceiling) and reported the
      // one-shot 100% crossing.
      threadStub({ notify: false, notification_alert: 100 }),
      awayDisabledStub(),
      companyNameStub(),
      membersStub(),
      adminUserStub(),
      resend,
      conversations,
    );

    await handleInboundMessage(env, inboundEvent({ text: "flood message" }));

    expect(resend.calls).toHaveLength(1);
    const email = resend.calls[0].body as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(email.to).toEqual(["owner@team.example"]);
    expect(email.subject).toBe(
      "Ace Plumbing has reached today's new-text alert limit",
    );
    expect(email.text).toContain("paused until tomorrow");
    // notify=false → the §8 pipeline never ran (no conversation read).
    expect(conversations.calls).toHaveLength(0);
  });

  it("sends the 80% warning while the claim itself still notifies", async () => {
    const resend = resendStub();
    // §8 pipeline reads; prefs disable both channels so the fan-out is a
    // no-op and the ONE Resend call below is provably the #39 warning.
    const conversations = stubRoute(
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
    const prefs = stubRoute(restMatch(env, "GET", "notification_prefs"), () => [
      { user_id: OWNER_USER, email_enabled: false, push_enabled: false },
    ]);
    serve(
      numberStub(),
      threadStub({ notify: true, notification_alert: 80 }),
      awayDisabledStub(),
      companyNameStub(),
      membersStub(),
      adminUserStub(),
      resend,
      conversations,
      prefs,
    );

    await handleInboundMessage(env, inboundEvent({ text: "busy day" }));

    expect(resend.calls).toHaveLength(1);
    const email = resend.calls[0].body as { subject: string };
    expect(email.subject).toBe(
      "Ace Plumbing is nearing today's new-text alert limit",
    );
    // The claim still delivered: the §8 pipeline ran (conversation read).
    expect(conversations.calls).toHaveLength(1);
  });

  it("sends no alert when the RPC reports no threshold crossing", async () => {
    const resend = resendStub();
    serve(
      numberStub(),
      threadStub({ notify: false, notification_alert: null }),
      awayDisabledStub(),
      resend,
    );

    await handleInboundMessage(env, inboundEvent({ text: "ordinary text" }));

    expect(resend.calls).toHaveLength(0);
  });
});
