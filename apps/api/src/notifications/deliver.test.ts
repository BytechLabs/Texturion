/**
 * The shared push fan-out. The inbound and missed-call suites already exercise
 * it through their pipelines; this pins the mechanics that must hold for every
 * caller, including ones that do not exist yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { deliverPush, newestPerUser } from "./deliver";
import { pushTopic } from "./webpush";

const env = completeEnv();
const USER = "10000000-aaaa-4000-8000-000000000001";
const SUB_ID = "50000000-0000-4000-8000-000000000001";
const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/";
/** Minimum viable notification content for the mechanics under test. */
const ALERT_TEXT = {
  title: "Sam",
  body: "On my way",
  url: "https://app.test/inbox/t1",
};

/**
 * #228: a payload is now a function of the reader's language. This one ignores
 * it — most of this file is about fan-out, pruning and metering rather than
 * copy, and a fixture that varied by language would make those assertions read
 * as if they cared.
 */
const ALERT = () => ALERT_TEXT;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A subscription with real P-256 material, so the encryption path runs. */
async function subscription(id: string, userId: string = USER) {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
  );
  const b64u = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    id,
    user_id: userId,
    endpoint: `${PUSH_ENDPOINT}${id}`,
    p256dh: b64u(raw),
    auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const DEVICE = {
  id: "60000000-0000-4000-8000-000000000001",
  user_id: USER,
  platform: "android" as const,
  token: "device-token-1",
};

interface PushSend {
  endpoint: string;
  topic: string | null;
}

function world(
  options: {
    subscriptions?: Record<string, unknown>[];
    pushStatus?: number;
    /** #228: what each member chose. Rows of { user_id, locale }. */
    profiles?: Record<string, unknown>[];
    /** #228: the workspace's language, the rung below the device's. */
    companyLocale?: string | null;
  } = {},
): { sb: SupabaseStub; routes: FetchRoute[]; sends: PushSend[] } {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/push_subscriptions", () => options.subscriptions ?? []);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  // #228: the workspace's language and the #430 content setting, one read.
  sb.on("GET", "/rest/v1/companies", () => [
    { push_include_content: true, locale: options.companyLocale ?? "en" },
  ]);
  // #228: what each member chose for themselves. Empty = nobody chose.
  sb.on("GET", "/rest/v1/profiles", () => options.profiles ?? []);
  const sends: PushSend[] = [];
  const pushRoute: FetchRoute = (url, request) => {
    if (!url.href.startsWith(PUSH_ENDPOINT)) return undefined;
    sends.push({ endpoint: url.href, topic: request.headers.get("topic") });
    return new Response(null, { status: options.pushStatus ?? 201 });
  };
  return { sb, routes: [sb.route, pushRoute], sends };
}

describe("deliverPush", () => {
  it("asks for nothing when there is nobody to reach", async () => {
    // A pipeline whose audience filtered down to nobody must not spend two
    // queries proving it.
    const { sb, routes } = world();
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [],
      web: ALERT,
      collapseKey: "conversation:x",
      failures: [],
    });

    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("prunes a subscription the push service says is gone", async () => {
    const { sb, routes } = world({
      subscriptions: [await subscription(SUB_ID)],
      pushStatus: 410,
    });
    stubFetch(...routes);
    const failures: unknown[] = [];

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "conversation:x",
      failures,
    });

    // An unsubscribed or expired endpoint is cleanup, not a delivery failure.
    const deletes = sb.find("DELETE", "/rest/v1/push_subscriptions");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url.searchParams.get("id")).toBe(`eq.${SUB_ID}`);
    expect(failures).toEqual([]);
  });

  it("collects a delivery failure instead of stopping the fan-out", async () => {
    // One unhealthy push service must not cost the other recipients their
    // alert, so a failure is recorded and the loop carries on.
    const { routes } = world({
      subscriptions: [
        await subscription(SUB_ID),
        await subscription("50000000-0000-4000-8000-000000000002"),
      ],
      pushStatus: 500,
    });
    stubFetch(...routes);
    const failures: unknown[] = [];

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "conversation:x",
      failures,
    });

    expect(failures).toHaveLength(2);
  });

  it("sends the web payload natively unless a native one is given", async () => {
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    // #228: the workspace language + the #430 content setting, one read.
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    // #228: nobody in these fixtures chose a language of their own.
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => [DEVICE]);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: () => ({ ...ALERT_TEXT, title: "Web" }),
      collapseKey: "conversation:x",
      failures: [],
    });
    await deliverPush(fcm, getDb(fcm), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: () => ({ ...ALERT_TEXT, title: "Web" }),
      // Only the native clients see the discriminator that picks a channel.
      native: () => ({ ...ALERT_TEXT, title: "Web", kind: "missed_call" }),
      collapseKey: "conversation:x",
      failures: [],
    });

    const data = service.sends.map(
      (send) => send.message.data as Record<string, string>,
    );
    expect(data[0].kind).toBeUndefined();
    expect(data[1].kind).toBe("missed_call");
    expect(data.map((entry) => entry.title)).toEqual(["Web", "Web"]);
  });

  // --- #266: one collapse identity, on every client ---

  it("puts the collapse key in the payload both clients read", async () => {
    // Web and Android coalesce on the payload tag. Letting them derive it from
    // the deep link instead rewrote every key to "per thread", so a second
    // mention on a note — or a customer's text — replaced the first alert.
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    // #228: the workspace language + the #430 content setting, one read.
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    // #228: nobody in these fixtures chose a language of their own.
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => [DEVICE]);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "mention:note-7",
      failures: [],
    });

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.tag).toBe("mention:note-7");
    // iOS can't retag a remote alert, so it coalesces on the header instead.
    const apns = service.sends[0].message.apns as
      | { headers?: Record<string, string> }
      | undefined;
    expect(apns?.headers?.["apns-collapse-id"] ?? data.tag).toBe(
      "mention:note-7",
    );
  });

  it("collapses queued web pushes on the same subject, not on others", async () => {
    // RFC 8030 Topic: a phone that was off all morning wakes to one alert per
    // subject. Two subjects must never share a topic — hence the hash, not a
    // truncation of `conversation:<uuid>`.
    const { routes, sends } = world({ subscriptions: [await subscription(SUB_ID)] });
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "conversation:abc",
      failures: [],
    });

    expect(sends[0].topic).toBe(await pushTopic("conversation:abc"));
    expect(sends[0].topic).not.toBe(await pushTopic("conversation:abd"));
    // The header's alphabet is fixed: ≤32 chars of base64url.
    expect(sends[0].topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  // --- #267: the bound is per recipient, not per fan-out ---

  it("reaches everyone when one member has registered many devices", async () => {
    // A single ceiling across the audience cut the same longest-tenured
    // members every time, because the sort is newest-first: a permanent silent
    // blackout, not an occasional miss.
    const crowded = "10000000-aaaa-4000-8000-000000000002";
    const oldest = "10000000-aaaa-4000-8000-000000000003";
    const rows = [];
    for (let index = 0; index < 12; index += 1) {
      rows.push(
        await subscription(`50000000-0000-4000-8000-00000000010${index}`, crowded),
      );
    }
    // Newest-first, so the longest-tenured member's row sorts last.
    const oldestRow = await subscription(
      "50000000-0000-4000-8000-000000000999",
      oldest,
    );
    rows.push(oldestRow);
    const { sb, routes, sends } = world({ subscriptions: rows });
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [crowded, oldest],
      web: ALERT,
      collapseKey: "conversation:x",
      failures: [],
    });

    // The window scales with the audience...
    expect(
      sb.find("GET", "/rest/v1/push_subscriptions")[0].url.searchParams.get(
        "limit",
      ),
    ).toBe("20");
    // ...the noisy member is still capped at their own 10...
    expect(sends).toHaveLength(11);
    // ...and the quiet, longest-tenured member is reached.
    expect(sends.some((send) => send.endpoint === oldestRow.endpoint)).toBe(true);
  });
});

/**
 * #228 — a push arrives in the language its reader chose.
 *
 * These use the FCM path deliberately: a Web Push body is encrypted, and the
 * native payload is the one a test can read back and prove the composition on.
 *
 * The composer here returns the locale itself as the body. That is not a
 * shortcut — it is the only way to assert WHICH language each device was
 * composed for, rather than that two payloads differed.
 */
describe("#228 a push speaks the reader's language", () => {
  const OTHER_USER = "20000000-0000-4000-8000-000000000002";

  /** Reports the locale it was handed, so each send names its own language. */
  const SAYS_LOCALE = (locale: string) => ({
    title: "T",
    body: locale,
    url: "https://app.test/inbox/t1",
  });

  function phone(id: string, userId: string, locale: string | null) {
    return {
      id,
      user_id: userId,
      platform: "android" as const,
      token: `token-${id}`,
      locale,
    };
  }

  async function deliverTo(
    devices: Record<string, unknown>[],
    options: {
      profiles?: Record<string, unknown>[];
      companyLocale?: string | null;
    } = {},
  ) {
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => devices);
    sb.on("GET", "/rest/v1/companies", () => [
      {
        push_include_content: true,
        locale: options.companyLocale === undefined ? "en" : options.companyLocale,
      },
    ]);
    sb.on("GET", "/rest/v1/profiles", () => options.profiles ?? []);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER, OTHER_USER],
      web: (locale) => SAYS_LOCALE(locale),
      collapseKey: "conversation:x",
      failures: [],
    });

    return {
      sb,
      bodies: service.sends.map(
        (send) => (send.message.data as Record<string, string>).body,
      ),
    };
  }

  it("composes each device in the language that device reads", async () => {
    // The DEVICE rung, which has never had a value on the server before. One
    // person, two phones, two languages — which is not a hypothetical: it is
    // the shape of every "my work phone is in English" arrangement.
    const { bodies } = await deliverTo([
      phone("60000000-0000-4000-8000-000000000001", USER, "fr-CA"),
      phone("60000000-0000-4000-8000-000000000002", OTHER_USER, "en"),
    ]);
    expect(bodies.sort()).toEqual(["en", "fr-CA"]);
  });

  it("lets what a member CHOSE beat what their handset reports", async () => {
    // resolveUiLocale's order, end to end: a French-speaking member who picked
    // the language in the app still reads French on an English handset.
    const { bodies } = await deliverTo(
      [phone("60000000-0000-4000-8000-000000000001", USER, "en")],
      { profiles: [{ user_id: USER, locale: "fr-CA" }] },
    );
    expect(bodies).toEqual(["fr-CA"]);
  });

  it("falls through a silent device to the workspace's language", async () => {
    // Null is "this device never said", NOT English — every row written before
    // the column existed is silent, and they must not all assert English.
    const { bodies } = await deliverTo(
      [phone("60000000-0000-4000-8000-000000000001", USER, null)],
      { companyLocale: "fr-CA" },
    );
    expect(bodies).toEqual(["fr-CA"]);
  });

  it("ends at English when nothing anywhere says otherwise", async () => {
    const { bodies } = await deliverTo(
      [phone("60000000-0000-4000-8000-000000000001", USER, null)],
      { companyLocale: null },
    );
    expect(bodies).toEqual(["en"]);
  });

  it("composes once per language, not once per device", async () => {
    // The cost control. A crew of five on one language must not run the
    // composer five times, and the collapse tag must stay identical across
    // translations or two renderings of one alert would stack.
    let composed = 0;
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => [
      phone("60000000-0000-4000-8000-000000000001", USER, "en"),
      phone("60000000-0000-4000-8000-000000000002", OTHER_USER, "en"),
    ]);
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    sb.on("GET", "/rest/v1/profiles", () => []);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      category: "messages_all",
      companyId: "c0000000-0000-4000-8000-00000000000c",
      content: { written: "us" },
      userIds: [USER, OTHER_USER],
      web: (locale) => {
        composed += 1;
        return SAYS_LOCALE(locale);
      },
      collapseKey: "conversation:x",
      failures: [],
    });

    expect(service.sends).toHaveLength(2);
    expect(composed).toBe(1);
    const tags = service.sends.map(
      (send) => (send.message.data as Record<string, string>).tag,
    );
    expect(tags).toEqual(["conversation:x", "conversation:x"]);
  });

  it("reads the workspace and the members once each, however many devices", async () => {
    // Two new queries per delivery is the price of this feature. Two PER
    // DEVICE would not be.
    const { sb } = await deliverTo([
      phone("60000000-0000-4000-8000-000000000001", USER, "en"),
      phone("60000000-0000-4000-8000-000000000002", OTHER_USER, "fr-CA"),
    ]);
    expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(1);
    expect(sb.find("GET", "/rest/v1/profiles")).toHaveLength(1);
  });
});

describe("newestPerUser", () => {
  it("gives every recipient their own quota", () => {
    const rows = [
      { user_id: "a", id: "a1" },
      { user_id: "a", id: "a2" },
      { user_id: "a", id: "a3" },
      { user_id: "b", id: "b1" },
    ];

    // Newest-first in, newest-first out: `a` keeps its two most recent, and
    // `b` is never crowded out by a teammate's device count.
    expect(newestPerUser(rows, 2).map((row) => row.id)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
  });
});

/**
 * #244 — a member's own quiet hours, and the override that makes them safe.
 *
 * The filter lives inside `deliverPush` rather than at the call sites, so a new
 * push site inherits it by construction. These tests are what make that claim
 * true rather than aspirational.
 */
describe("#244 member quiet hours", () => {
  const COMPANY = "c0000000-0000-4000-8000-00000000000c";
  const SLEEPING = "u-sleeping";
  const AWAKE = "u-awake";

  /**
   * The clock is FROZEN for this block, and it has to be.
   *
   * These fixtures use a 00:00–23:59 window to mean "quiet all day", and
   * `isMemberQuietNow` is half-open — `now >= from && now < to` — which is the
   * correct reading of a window and leaves 23:59 itself outside it. So the
   * fixture was quiet for 1,439 minutes of every day and not quiet for one,
   * and on 2026-08-15 CI ran inside that minute: 03:59:06Z is 23:59:06 in
   * America/Toronto, and main went red on a test nobody had touched.
   *
   * Widening the window would only move the hole. What was actually wrong is
   * that a test about a rule was reading the wall clock at all — so it reads a
   * fixed instant instead, comfortably inside the window and unrelated to when
   * anybody runs it.
   *
   * Only `Date` is faked. Faking timers wholesale would stall the real
   * awaits in `deliverPush`.
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 14:00 in America/Toronto — mid-afternoon, mid-window, no boundary near.
    vi.setSystemTime(new Date("2026-08-14T18:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function quietWorld() {
    const sb = supabaseStub(env);
    // #228: the workspace language + the #430 content setting, one read.
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    // #228: nobody in these fixtures chose a language of their own.
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      {
        user_id: SLEEPING,
        quiet_from: "00:00",
        quiet_to: "23:59",
        quiet_timezone: "America/Toronto",
        companies: { timezone: "America/Toronto" },
      },
      {
        user_id: AWAKE,
        quiet_from: null,
        quiet_to: null,
        quiet_timezone: null,
        companies: { timezone: "America/Toronto" },
      },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => []);
    stubFetch(sb.route);
    return sb;
  }

  function delivery(overrides: Record<string, unknown> = {}) {
    return {
      companyId: COMPANY,
      category: "messages_all" as const,
      userIds: [SLEEPING, AWAKE],
      content: { written: "us" as const },
      web: () => ({ title: "t", body: "b", url: "https://app/x" }),
      collapseKey: "conversation:x",
      failures: [] as unknown[],
      ...overrides,
    };
  }

  it("QH-1: a routine push skips the member whose window is running", async () => {
    const sb = quietWorld();

    await deliverPush(env, getDb(env), delivery());

    const lookup = sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${AWAKE})`);
  });

  it("QH-2: a page reaches them anyway — the emergency override", async () => {
    // This is what makes the window safe to set. Somebody can silence the
    // 1:40am customer text without also silencing the night they agreed to
    // hold the phone.
    const sb = quietWorld();

    await deliverPush(
      env,
      getDb(env),
      delivery({ overridesQuietHours: { reason: "on_call_page" } }),
    );

    const lookup = sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    const targeted = lookup?.url.searchParams.get("user_id") ?? "";
    expect(targeted).toContain(SLEEPING);
    expect(targeted).toContain(AWAKE);
    // And it does not even ask, because the answer cannot change what it does.
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/notification_prefs"),
    ).toBe(false);
  });

  it("QH-3: the window is read for THIS workspace only", async () => {
    // Preferences are keyed (user_id, company_id): a member of two workspaces
    // has two windows, and reading by user alone would apply the wrong one.
    const sb = quietWorld();

    await deliverPush(env, getDb(env), delivery());

    const read = sb.calls.find(
      (call) => call.path === "/rest/v1/notification_prefs",
    );
    expect(read?.url.searchParams.get("company_id")).toBe(`eq.${COMPANY}`);
  });

  it("QH-4: a failed lookup notifies everybody rather than silencing them", async () => {
    // The uncertain direction is to NOTIFY. Silently withholding a message
    // somebody was waiting for is invisible to them; an unwanted buzz is not.
    const sb = supabaseStub(env);
    // #228: the workspace language + the #430 content setting, one read.
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    // #228: nobody in these fixtures chose a language of their own.
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on(
      "GET",
      "/rest/v1/notification_prefs",
      () => new Response("boom", { status: 500 }),
    );
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => []);
    stubFetch(sb.route);

    await deliverPush(env, getDb(env), delivery());

    const lookup = sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    const targeted = lookup?.url.searchParams.get("user_id") ?? "";
    expect(targeted).toContain(SLEEPING);
    expect(targeted).toContain(AWAKE);
  });

  it("QH-5: everybody quiet means no push at all, not a push to nobody", async () => {
    const sb = supabaseStub(env);
    // #228: the workspace language + the #430 content setting, one read.
    sb.on("GET", "/rest/v1/companies", () => [
      { push_include_content: true, locale: "en" },
    ]);
    // #228: nobody in these fixtures chose a language of their own.
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      {
        user_id: SLEEPING,
        quiet_from: "00:00",
        quiet_to: "23:59",
        quiet_timezone: "America/Toronto",
        companies: { timezone: "America/Toronto" },
      },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => []);
    stubFetch(sb.route);

    await deliverPush(env, getDb(env), delivery({ userIds: [SLEEPING] }));

    expect(
      sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(false);
  });
});
