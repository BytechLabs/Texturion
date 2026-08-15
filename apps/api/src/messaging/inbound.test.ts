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
  type StubCall,
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

/**
 * #307: the away-reply reads the conversation with the LINE's own toggle, zone
 * and hours embedded. A test that stubs `conversations` for the §8 notify read
 * would otherwise swallow that request too and answer it with a row shaped for
 * a different query. This predicate keeps the two apart.
 */
function notAwaySelect(url: URL): boolean {
  return !(
    url.searchParams.get("select")?.includes("phone_numbers(number_e164") ?? false
  );
}

/**
 * #250: the classifier's reads, appended AFTER every test's own stubs so a
 * test that cares can still override them.
 *
 * They are defaults rather than per-test setup because classification now runs
 * on every inbound and answers "is this a robotext" for a suite whose fixtures
 * are all ordinary customer texts from ordinary mobiles. Without them each of
 * these tests pays an unstubbed-fetch timeout for a question none of them is
 * asking.
 */
function spamDefaults(): Stub[] {
  return [
    // #288: the activation stamp no longer depends on analytics being configured,
    // and this test env has no PostHog key — so what used to be an immediate
    // return now does real work on EVERY inbound. These two defaults end that path
    // where the early return used to: no dispatched outbound on the thread means
    // the customer started it, which is not the activation loop closing.
    //
    // A test that cares stubs both itself and wins, because `serve` appends these
    // last and the harness is first-match-wins.
    stubRoute(restMatch(env, "GET", "messages"), () => []),
    stubRoute(rpcMatch(env, "qualify_referral"), () => ({ outcome: "noop" })),
    // Nobody blocked this sender. Nothing else is needed: an ordinary
    // customer text scores no content signals, so the classifier never
    // reaches its relationship queries.
    stubRoute(restMatch(env, "GET", "blocked_senders"), () => []),
    // #307: the away-reply now resolves the LINE's toggle, zone and hours, so
    // it reads the conversation alongside the company instead of after it —
    // on every inbound, not only after-hours ones. These tests are about media,
    // notifications and refusals, not away; an empty row set ends the away path
    // exactly where the old company-first short-circuit used to end it. LAST in
    // the list, so a test that stubs conversations itself still wins.
    stubRoute(
      restMatch(
        env,
        "GET",
        "conversations",
        (url) =>
          url.searchParams.get("select")?.includes("phone_numbers(number_e164") ??
          false,
      ),
      () => [],
    ),
  ];
}

function serve(...stubs: Stub[]) {
  stubFetch(
    ...([...stubs, ...spamDefaults()].map((s) => s.route) as FetchRoute[]),
  );
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

describe("handleInboundMessage — #288 the reply that earns a referral", () => {
  /**
   * The workspace row this handler reads. `first_inbound_reply_at` null means the
   * activation loop has not closed yet, which is the only case any of this runs in.
   */
  function unactivatedCompany(): Stub {
    return stubRoute(
      restMatch(env, "GET", "companies"),
      () => [
        {
          id: COMPANY_ID,
          first_inbound_reply_at: null,
          country: "US",
          us_texting_enabled: true,
        },
      ],
    );
  }

  it("stamps activation and qualifies the referral on the reply itself", async () => {
    // Both halves matter. The stamp is D12's second condition, and qualifying HERE
    // rather than on the referee's next send is the difference between a referrer
    // being paid and being paid whenever their friend happens to text somebody
    // again — which nobody would ever have reported as a bug.
    const precedent = stubRoute(
      restMatch(env, "GET", "messages"),
      () => [{ id: "an-earlier-outbound" }],
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "companies"), () => [
      { id: COMPANY_ID },
    ]);
    const qualify = stubRoute(rpcMatch(env, "qualify_referral"), () => ({
      outcome: "noop",
    }));
    serve(
      numberStub(),
      unactivatedCompany(),
      threadStub({}),
      awayDisabledStub(),
      precedent,
      stamp,
      qualify,
    );

    await handleInboundMessage(env, inboundEvent({}));

    expect(stamp.calls, "activation was not stamped").toHaveLength(1);
    expect(qualify.calls, "the referral was not qualified on the reply").toHaveLength(1);
    expect(qualify.calls[0].body).toMatchObject({ p_referee_company: COMPANY_ID });
  });

  it("stamps activation even with analytics switched off", async () => {
    // THE ONE THAT MATTERS. The whole block used to return early when
    // POSTHOG_API_KEY was absent, so `first_inbound_reply_at` — a product column
    // that reports read and that a referral payout now turns on — was written only
    // as a side effect of analytics being configured. Nothing would have surfaced
    // that: reports would just have shown nobody ever activating.
    const quiet: Env = { ...env, POSTHOG_API_KEY: undefined };
    const precedent = stubRoute(
      restMatch(quiet, "GET", "messages"),
      () => [{ id: "an-earlier-outbound" }],
    );
    const stamp = stubRoute(restMatch(quiet, "PATCH", "companies"), () => [
      { id: COMPANY_ID },
    ]);
    const qualify = stubRoute(rpcMatch(quiet, "qualify_referral"), () => ({
      outcome: "noop",
    }));
    serve(
      numberStub(),
      unactivatedCompany(),
      threadStub({}),
      awayDisabledStub(),
      precedent,
      stamp,
      qualify,
    );

    await handleInboundMessage(quiet, inboundEvent({}));

    expect(stamp.calls, "activation depends on analytics being on").toHaveLength(1);
    expect(qualify.calls).toHaveLength(1);
  });

  it("does nothing for a thread the customer started", async () => {
    // A reply needs something to reply TO. An inbound on a thread with no dispatched
    // outbound is a new customer getting in touch, not the activation loop closing.
    const precedent = stubRoute(restMatch(env, "GET", "messages"), () => []);
    const stamp = stubRoute(restMatch(env, "PATCH", "companies"), () => [
      { id: COMPANY_ID },
    ]);
    const qualify = stubRoute(rpcMatch(env, "qualify_referral"), () => ({
      outcome: "noop",
    }));
    serve(
      numberStub(),
      unactivatedCompany(),
      threadStub({}),
      awayDisabledStub(),
      precedent,
      stamp,
      qualify,
    );

    await handleInboundMessage(env, inboundEvent({}));

    expect(stamp.calls).toHaveLength(0);
    expect(qualify.calls).toHaveLength(0);
  });
});

describe("handleInboundMessage — #294/D128 the sender's own location", () => {
  it("stores the customer's photo with the coordinates already gone", async () => {
    // Both of D28's doors, not just the one the crew uploads through. A homeowner
    // texting a picture of a leaking pipe sends the position of their kitchen; they
    // never agreed to us keeping that and could not have.
    //
    // Asserted on the bytes that reach the BUCKET rather than on a return value,
    // because the strip works by mutating a view over the same buffer the upload
    // sends. A refactor that copies instead of viewing would leave every other test
    // here passing and quietly store the coordinates again.
    const jpeg = jpegWithGpsLatitude();
    const mediaDownload = stubRoute(
      (url, request) => request.method === "GET" && url.href.startsWith(MEDIA_URL),
      () =>
        new Response(jpeg.bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    const attachmentLookup = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    // Hand-rolled rather than `stubRoute`, which decodes bodies as text for the
    // JSON routes and would mangle a JPEG on the way past.
    const stored: Uint8Array[] = [];
    const uploadCalls: StubCall[] = [];
    const upload: Stub = {
      calls: uploadCalls,
      route: async (url, request) => {
        if (!storageUploadMatch(env)(url, request)) return undefined;
        stored.push(new Uint8Array(await request.clone().arrayBuffer()));
        uploadCalls.push({
          url,
          method: request.method,
          headers: request.headers,
          body: undefined,
        });
        return Response.json({ Key: "mms-media/x" });
      },
    };
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
          { url: MEDIA_URL, content_type: "image/jpeg", size: jpeg.bytes.length },
        ],
      }),
    );

    expect(upload.calls, "the photo must still be stored").toHaveLength(1);
    expect(stored, "no bytes reached the bucket").toHaveLength(1);
    const bytes = stored[0];
    const latitude = bytes.slice(jpeg.latAt, jpeg.latAt + jpeg.latLength);
    expect(
      latitude.every((byte) => byte === 0),
      "the sender's coordinates reached the bucket",
    ).toBe(true);
    // And the photo is intact: same length, still a JPEG.
    expect(bytes.length).toBe(jpeg.bytes.length);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  });
});

/**
 * A JPEG whose Exif carries a GPS directory with an out-of-line latitude.
 *
 * Built rather than fixtured so the latitude's exact position is known and can be
 * asserted on directly. The layout matches the one in
 * apps/api/src/attachments/location.test.ts, which is where the format is explained.
 */
function jpegWithGpsLatitude(): {
  bytes: Uint8Array;
  latAt: number;
  latLength: number;
} {
  const tiff = new Uint8Array(80);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true); // one entry: the GPS pointer
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true); // LONG
  view.setUint32(14, 1, true);
  view.setUint32(18, 38, true); // GPS directory at 38
  view.setUint32(22, 0, true); // no next IFD
  view.setUint16(38, 1, true); // one entry
  view.setUint16(40, 0x0002, true); // GPSLatitude
  view.setUint16(42, 5, true); // RATIONAL
  view.setUint32(44, 3, true);
  view.setUint32(48, 56, true); // values at 56
  view.setUint32(52, 0, true);
  tiff.fill(0xab, 56, 80); // the latitude itself

  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // the Exif header, NUL-terminated
  const segment = 2 + header.length + tiff.length;
  const bytes = new Uint8Array(4 + 2 + header.length + tiff.length + 2);
  bytes.set([0xff, 0xd8, 0xff, 0xe1], 0);
  bytes[4] = (segment >> 8) & 0xff;
  bytes[5] = segment & 0xff;
  bytes.set(header, 6);
  const tiffAt = 6 + header.length;
  bytes.set(tiff, tiffAt);
  bytes.set([0xff, 0xd9], tiffAt + tiff.length);
  return { bytes, latAt: tiffAt + 56, latLength: 24 };
}

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
      restMatch(env, "GET", "conversations", notAwaySelect),
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
    const conversations = stubRoute(restMatch(env, "GET", "conversations", notAwaySelect));
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
      restMatch(env, "GET", "conversations", notAwaySelect),
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

describe("handleInboundMessage — #243 the workspace's own systems get told", () => {
  it("queues one delivery per subscribed endpoint, carrying the message", async () => {
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      { id: "eeeeeeee-1111-4222-8333-444444444444" },
    ]);
    const deliveries = stubRoute(
      restMatch(env, "POST", "webhook_deliveries"),
      () => Response.json([], { status: 201 }),
    );
    serve(numberStub(), threadStub({}), awayDisabledStub(), endpoints, deliveries);

    await handleInboundMessage(env, inboundEvent({}));

    expect(deliveries.calls, "no delivery was queued").toHaveLength(1);
    const rows = deliveries.calls[0].body as {
      event_type: string;
      payload: { type: string; data: { message_id: string; body: string } };
    }[];
    expect(rows[0].event_type).toBe("message.received");
    expect(rows[0].payload.data.message_id).toBe(MESSAGE_ID);

    // Asked for the RIGHT endpoints: this workspace, active, subscribed to
    // this name. A query missing any of those fans a customer's messages out
    // to somebody who did not ask for them.
    const query = endpoints.calls[0].url.searchParams;
    expect(query.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(query.get("active")).toBe("eq.true");
    expect(query.get("events")).toBe("cs.{message.received}");
  });

  it("does not re-tell anybody when the §11 sweeper replays the same message", async () => {
    // THE ONE THAT MATTERS. This handler is replayed on failure, and an
    // integration that receives the same customer message as two different
    // deliveries is one that books the job twice. `created: false` is what a
    // replay looks like.
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      { id: "eeeeeeee-1111-4222-8333-444444444444" },
    ]);
    const deliveries = stubRoute(
      restMatch(env, "POST", "webhook_deliveries"),
      () => Response.json([], { status: 201 }),
    );
    serve(
      numberStub(),
      threadStub({ created: false }),
      awayDisabledStub(),
      endpoints,
      deliveries,
    );

    await handleInboundMessage(env, inboundEvent({}));

    expect(deliveries.calls, "a replay queued a second delivery").toHaveLength(0);
  });

  it("still stores the message when the integration ledger refuses the write", async () => {
    // A workspace's integration preference must never be able to lose a
    // customer's message. The enqueue swallows and the handler completes.
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      { id: "eeeeeeee-1111-4222-8333-444444444444" },
    ]);
    const deliveries = stubRoute(
      restMatch(env, "POST", "webhook_deliveries"),
      () => new Response("boom", { status: 500 }),
    );
    serve(numberStub(), threadStub({}), awayDisabledStub(), endpoints, deliveries);

    await expect(handleInboundMessage(env, inboundEvent({}))).resolves.toBeUndefined();
  });
});
