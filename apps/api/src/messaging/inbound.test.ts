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

describe("handleInboundMessage — #189 widened inbound media", () => {
  it("stores a non-image type carriers deliver, canonicalizing vendor spellings", async () => {
    // The carrier CDN reports the vendor alias; the stored row must carry the
    // canonical audio/amr so the bucket's allowed_mime_types accept it.
    const mediaDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new TextEncoder().encode("#!AMR\n frames"), {
          headers: { "content-type": "audio/amr-nb" },
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
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      mediaDownload,
      upload,
      attachmentInsert,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "audio/amr-nb", size: 12 }],
      }),
    );

    expect(mediaDownload.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(1);
    expect(attachmentInsert.calls).toHaveLength(1);
    expect(attachmentInsert.calls[0].body).toMatchObject({
      content_type: "audio/amr",
    });
  });

  it("still skips a type the platform cannot serve", async () => {
    const mediaDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new Uint8Array([0x00, 0x01]), {
          headers: { "content-type": "application/vnd.wap.mms-message" },
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
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      mediaDownload,
      upload,
      attachmentInsert,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [
          {
            url: MEDIA_URL,
            content_type: "application/vnd.wap.mms-message",
            size: 2,
          },
        ],
      }),
    );

    expect(mediaDownload.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(0);
    expect(attachmentInsert.calls).toHaveLength(0);
  });

  it("skips media whose Content-Length declares it over the cap, without storing", async () => {
    const mediaDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(new Uint8Array([0x00]), {
          headers: {
            "content-type": "image/jpeg",
            // Declares 10 MB — over the 5 MB inbound cap; must be rejected on
            // the header alone, before the body is buffered.
            "content-length": String(10 * 1024 * 1024),
          },
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
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      mediaDownload,
      upload,
      attachmentInsert,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 999 }],
      }),
    );

    expect(mediaDownload.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(0);
    expect(attachmentInsert.calls).toHaveLength(0);
  });
});

describe("handleInboundMessage — notify runs before media download", () => {
  it("still fires the §8 notification when the media download fails (sweeper-replay safety)", async () => {
    // A transient media-CDN failure makes downloadInboundMedia throw (so the
    // §11 sweeper replays it). The notification pipeline now runs FIRST, so the
    // one-shot alert is sent BEFORE that throw — otherwise the create-gated
    // replay (created=false) would skip it forever and the customer's MMS would
    // produce no alert at all.
    const mediaDownload = stubRoute(
      (url, request) =>
        request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () => new Response("upstream boom", { status: 500 }),
    );
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
    // Prefs disable both channels so the fan-out is a no-op; the conversation
    // read still proves the pipeline ran before the media throw.
    const prefs = stubRoute(restMatch(env, "GET", "notification_prefs"), () => [
      { user_id: OWNER_USER, email_enabled: false, push_enabled: false },
    ]);
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    serve(
      numberStub(),
      threadStub({ created: true, notify: true }),
      awayDisabledStub(),
      membersStub(),
      conversations,
      prefs,
      attachmentLookup,
      mediaDownload,
    );

    await expect(
      handleInboundMessage(
        env,
        inboundEvent({
          text: "here's the leak",
          media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 4 }],
        }),
      ),
    ).rejects.toThrow();

    // The §8 pipeline read the conversation → it ran BEFORE the media failure.
    expect(conversations.calls).toHaveLength(1);
    expect(mediaDownload.calls).toHaveLength(1);
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
      "Ace Plumbing has reached today's email alert limit",
    );
    // #401: the channel is named, and push is NOT claimed to be paused —
    // at the email ceiling it keeps delivering for another 1,900 claims.
    expect(email.text).toContain("email alerts are paused until midnight");
    expect(email.text).toContain("still buzzing");
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
      "Ace Plumbing is nearing today's email alert limit",
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

  it("emails the owner when PUSH caps — the crossing that used to reach nobody", async () => {
    // #401. The RPC has always reported this in notification_alerts; the
    // handler read only the legacy scalar, which the EMAIL ladder alone sets.
    // So the crew's phones could stop buzzing for new texts on the busiest day
    // of the year with nobody told at all.
    const resend = resendStub();
    serve(
      numberStub(),
      threadStub({
        notify: false,
        notification_alert: null,
        notification_alerts: [{ channel: "push", threshold: 100 }],
      }),
      awayDisabledStub(),
      companyNameStub(),
      membersStub(),
      adminUserStub(),
      resend,
    );

    await handleInboundMessage(env, inboundEvent({ text: "flood message" }));

    expect(resend.calls).toHaveLength(1);
    const email = resend.calls[0].body as { subject: string; text: string };
    expect(email.subject).toBe(
      "Ace Plumbing's phones have stopped buzzing for new texts today",
    );
    expect(email.text).toContain("still lands in your Loonext inbox");
  });
});

/**
 * #317 — a customer's file that does not make it in leaves a record.
 *
 * Two things were true of this path before. It stored whatever type the carrier
 * CDN declared, without ever looking at the bytes — the uploaded-attachment route
 * has re-derived the type from the leading bytes since D19, and this is the path
 * the issue calls uncontrolled, because anyone who knows the number can reach it
 * with no signup and no relationship. And every refusal was a \`console.warn\`, so
 * the crew saw a message with no picture and concluded the customer forgot to
 * attach one.
 */
describe("handleInboundMessage — #317 inbound media is checked, and refusals are visible", () => {
  /** The events insert the refusal record lands in. */
  function eventsStub(): Stub {
    return stubRoute(restMatch(env, "POST", "conversation_events"), () =>
      Response.json([], { status: 201 }),
    );
  }

  function mediaServing(bytes: Uint8Array, contentType: string): Stub {
    return stubRoute(
      (url, request) => request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () => new Response(bytes, { headers: { "content-type": contentType } }),
    );
  }

  function refusal(events: Stub): Record<string, unknown> {
    expect(events.calls).toHaveLength(1);
    const rows = events.calls[0].body as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("media_refused");
    return rows[0].payload as Record<string, unknown>;
  }

  it("refuses a PDF that runs a script when it opens — the right type, the wrong insides", async () => {
    // The gap the type checks structurally cannot close. This file IS a PDF,
    // `application/pdf` IS on the allow-list, and `bytesMatchDeclaredType`
    // passes it, because none of that is the wrong type. What is wrong is what
    // it does when a tech taps it on a phone between jobs.
    const weaponised = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >> endobj\n%%EOF",
    );
    const media = mediaServing(weaponised, "application/pdf");
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const events = eventsStub();
    const upload = stubRoute(
      (url, request) => request.method === "POST" && url.pathname.includes("mms-media"),
      () => Response.json({}, { status: 200 }),
    );
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      events,
      upload,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "application/pdf", size: 60 }],
      }),
    );

    const payload = refusal(events);
    expect(payload.reason).toBe("unsafe_content");
    expect(payload.scan_reason).toBe("pdf_auto_javascript");
    // Refused BEFORE the object exists: nothing was uploaded, so there is no
    // stored file for a signed URL to ever point at.
    expect(upload.calls).toHaveLength(0);
  });

  it("never receives an Office document this way — the carrier path cannot carry one", async () => {
    // Worth pinning rather than assuming. The ZIP-container half of #317 — macro
    // projects, packed executables, decompression bombs — applies to the UPLOAD
    // route, where OpenXML and ODF are on the allow-list. It cannot apply here:
    // the deliverable MMS set is images, audio, video, vCard, calendar, PDF and
    // text, so an .xlsx is refused as an unsupported type long before anything
    // reads inside it.
    //
    // So the inbound scan's real surface is PDF. This test exists so that
    // widening the MMS allow-list to documents cannot happen quietly — it would
    // change this line, and whoever changes it has to notice why.
    const unreadable = new TextEncoder().encode("PK not really a zip");
    const media = mediaServing(
      unreadable,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const events = eventsStub();
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      events,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [
          {
            url: MEDIA_URL,
            content_type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 24,
          },
        ],
      }),
    );

    expect(refusal(events).reason).toBe("unsupported_type");
  });

  it("refuses an executable wearing an image content type, and says so in the thread", async () => {
    // \`MZ\` — a Windows .exe. The carrier says image/jpeg because the sender's
    // phone said image/jpeg. Nothing downstream would have questioned it: the
    // bucket accepts image/jpeg, the gallery renders it inline (D87), and the
    // file lands on a tech's phone with our name on the delivery.
    const media = mediaServing(
      new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
      "image/jpeg",
    );
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const upload = stubRoute(storageUploadMatch(env), () => ({ Key: "x" }));
    const attachmentInsert = stubRoute(
      restMatch(env, "POST", "message_attachments"),
      () => Response.json([], { status: 201 }),
    );
    const events = eventsStub();
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      upload,
      attachmentInsert,
      events,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 6 }],
      }),
    );

    // Fetched (we cannot judge bytes we have not read) and then refused: nothing
    // stored, no row minted, so no signed URL can ever be issued for it.
    expect(media.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(0);
    expect(attachmentInsert.calls).toHaveLength(0);
    expect(refusal(events)).toMatchObject({
      reason: "type_mismatch",
      content_type: "image/jpeg",
      index: 0,
    });
  });

  it("records the reason a type carriers relay but we cannot serve was dropped", async () => {
    const media = mediaServing(
      new TextEncoder().encode("whatever"),
      "application/x-shockwave-flash",
    );
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const upload = stubRoute(storageUploadMatch(env), () => ({ Key: "x" }));
    const events = eventsStub();
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      upload,
      events,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [
          { url: MEDIA_URL, content_type: "application/x-shockwave-flash", size: 8 },
        ],
      }),
    );

    expect(upload.calls).toHaveLength(0);
    expect(refusal(events)).toMatchObject({ reason: "unsupported_type" });
  });

  it("records a refusal for an empty file rather than dropping it silently", async () => {
    const media = mediaServing(new Uint8Array([]), "image/jpeg");
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const upload = stubRoute(storageUploadMatch(env), () => ({ Key: "x" }));
    const events = eventsStub();
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      upload,
      events,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 0 }],
      }),
    );

    expect(upload.calls).toHaveLength(0);
    expect(refusal(events)).toMatchObject({ reason: "empty", size_bytes: 0 });
  });

  it("puts no attacker-controlled text and no live media URL in the record", async () => {
    // The payload renders in the thread on three clients, and the only fields a
    // stranger controls are the file name and the source URL. The name would be
    // text we display; the URL is a live handle to bytes we just declined to
    // store, which is the last thing to hand to anyone reading the timeline.
    const media = mediaServing(new Uint8Array([0x4d, 0x5a]), "image/png");
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const events = eventsStub();
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      events,
    );

    await handleInboundMessage(
      env,
      inboundEvent({
        media: [{ url: MEDIA_URL, content_type: "image/png", size: 2 }],
      }),
    );

    const payload = refusal(events);
    expect(Object.keys(payload).sort()).toEqual([
      "content_type",
      "index",
      "message_id",
      "reason",
      // #317: the structural finding. It is in the pinned set deliberately —
      // this assertion is the thing standing between the timeline and
      // attacker-controlled text, so a NEW key has to be a decision somebody
      // made rather than a field that appeared.
      "scan_reason",
      "size_bytes",
    ]);
    expect(JSON.stringify(payload)).not.toContain(MEDIA_URL);
    // …and scan_reason may only ever carry OUR vocabulary. The sender picks
    // the file name and the bytes; they do not get to pick this.
    expect(payload.scan_reason === null || /^[a-z_]+$/.test(String(payload.scan_reason))).toBe(
      true,
    );
  });

  it("still delivers the message when the refusal record itself cannot be written", async () => {
    // The customer's text matters more than our note about their attachment. A
    // database that has not taken the enum migration yet must not turn an
    // inbound message into a failed webhook and an endlessly retried ledger row.
    const media = mediaServing(new Uint8Array([0x4d, 0x5a]), "image/jpeg");
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const events = stubRoute(restMatch(env, "POST", "conversation_events"), () =>
      Response.json({ message: "invalid input value for enum" }, { status: 400 }),
    );
    serve(
      numberStub(),
      threadStub({}),
      awayDisabledStub(),
      attachmentLookup,
      media,
      events,
    );

    await expect(
      handleInboundMessage(
        env,
        inboundEvent({
          media: [{ url: MEDIA_URL, content_type: "image/jpeg", size: 2 }],
        }),
      ),
    ).resolves.toBeUndefined();
    expect(events.calls).toHaveLength(1);
  });

  it("leaves a genuine photo and a signature-less voice note alone", async () => {
    // The other half of the guarantee. A real JPEG passes, and so does audio
    // with no distinctive magic — refusing a customer's voice note because we
    // have no AMR signature would be the silent drop this change exists to end.
    for (const [bytes, type] of [
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
      [new TextEncoder().encode("#!AMR\n frames"), "audio/amr"],
    ] as [Uint8Array, string][]) {
      const media = mediaServing(bytes, type);
      const attachmentLookup = stubRoute(
        restMatch(env, "GET", "message_attachments"),
        () => [],
      );
      const upload = stubRoute(storageUploadMatch(env), () => ({ Key: "x" }));
      const attachmentInsert = stubRoute(
        restMatch(env, "POST", "message_attachments"),
        () => Response.json([], { status: 201 }),
      );
      const events = eventsStub();
      serve(
        numberStub(),
        threadStub({}),
        awayDisabledStub(),
        attachmentLookup,
        media,
        upload,
        attachmentInsert,
        events,
      );

      await handleInboundMessage(
        env,
        inboundEvent({
          media: [{ url: MEDIA_URL, content_type: type, size: bytes.byteLength }],
        }),
      );

      expect(upload.calls, type).toHaveLength(1);
      expect(events.calls, type).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });
});
