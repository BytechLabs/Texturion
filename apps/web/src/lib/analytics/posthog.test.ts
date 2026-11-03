import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";
const POSTHOG_KEY = "phc_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const COMPANY_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const PHONE = "+14165551234";

// posthog-js is loaded via dynamic import inside initPostHog — mock it so the
// tests can prove exactly when (and with what config) init/identify fire.
const { client, initSpy, identifySpy, captureSpy, registerSpy, settle } = vi.hoisted(() => {
  const identifySpy = vi.fn();
  const captureSpy = vi.fn();
  const registerSpy = vi.fn();
  const client = {
    identify: identifySpy,
    capture: captureSpy,
    register_for_session: registerSpy,
    get_session_id: () => "session",
  };
  // Like the SDK, init calls `loaded` before it returns.
  const initSpy = vi.fn();
  initSpy.mockImplementation((_key, config) => config.loaded?.(client));
  return { client, initSpy, identifySpy, captureSpy, registerSpy, settle: { gate: Promise.resolve() } };
});
// The page-settled gate: open unless a test holds it shut.
vi.mock("@/lib/perf/after-lcp-and-load", () => ({ whenPageSettles: () => settle.gate }));
vi.mock("posthog-js", () => ({ default: { ...client, init: initSpy } }));

// posthog.ts reads the key at module load, so each test stubs the
// required NEXT_PUBLIC_* set first and imports a fresh copy.
async function importPostHog(key: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
  vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key);
  return import("./posthog");
}

beforeEach(() => {
  vi.resetModules();
  initSpy.mockClear();
  identifySpy.mockClear();
  captureSpy.mockClear();
  registerSpy.mockClear();
  settle.gate = Promise.resolve();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sanitizeEventProperties (D8: UUIDs, counts, and feature events only)", () => {
  it("strips query string + fragment from URL-ish properties and redacts phones", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    expect(
      sanitizeEventProperties({
        $current_url: `https://app.loonext.com/contacts?q=${encodeURIComponent(PHONE)}`,
        $pathname: "/contacts",
        $referrer: "https://loonext.com/pricing#faq",
        $session_entry_url: `https://app.loonext.com/inbox/${COMPANY_ID}?q=1#x`,
      }),
    ).toEqual({
      $current_url: "https://app.loonext.com/contacts",
      $pathname: "/contacts",
      $referrer: "https://loonext.com/pricing",
      $session_entry_url: `https://app.loonext.com/inbox/${COMPANY_ID}`,
    });
  });

  it("redacts phone runs inside a URL path even after the query is gone", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    expect(
      sanitizeEventProperties({
        $current_url: "https://app.loonext.com/contacts/+14165551234?tab=notes",
      }),
    ).toEqual({
      $current_url: "https://app.loonext.com/contacts/[phone redacted]",
    });
  });

  it("#651 keeps a distinct_id whole when its last group opens with ten digits", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    const ids = [
      "550e8400-e29b-41d4-a716-446655440000",
      "0192f1a3-7c4e-7b2a-9f00-1234567890ab",
    ];
    for (const id of ids) {
      expect(sanitizeEventProperties({ distinct_id: id, $device_id: id })).toEqual({
        distinct_id: id,
        $device_id: id,
      });
    }
  });

  it("scrubs phones and name-keys in ordinary properties, deeply", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    expect(
      sanitizeEventProperties({
        note: `call me at ${PHONE}`,
        contact_name: "Jane Doe",
        nested: { displayName: "Jane Doe", numbers: [PHONE] },
      }),
    ).toEqual({
      note: "call me at [phone redacted]",
      contact_name: "[name redacted]",
      nested: { displayName: "[name redacted]", numbers: ["[phone redacted]"] },
    });
  });

  it("passes UUIDs, counts, and flags through untouched", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    expect(
      sanitizeEventProperties({
        company_id: COMPANY_ID,
        message_count: 42,
        mms: true,
      }),
    ).toEqual({ company_id: COMPANY_ID, message_count: 42, mms: true });
  });
});

describe("initPostHog (NEXT_PUBLIC_POSTHOG_KEY optional — absent = off)", () => {
  it("is a silent no-op when the key is not configured", async () => {
    const { initPostHog } = await importPostHog(undefined);
    expect(await initPostHog()).toBeNull();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("initializes with the D8 config: autocapture/recording/surveys off, pageviews sanitized", async () => {
    const { initPostHog, POSTHOG_HOST, sanitizeEventProperties } =
      await importPostHog(POSTHOG_KEY);
    await initPostHog();

    expect(initSpy).toHaveBeenCalledTimes(1);
    const [key, config] = initSpy.mock.calls[0];
    expect(key).toBe(POSTHOG_KEY);
    expect(config.api_host).toBe(POSTHOG_HOST);
    expect(config.autocapture).toBe(false);
    expect(config.disable_session_recording).toBe(true);
    expect(config.disable_surveys).toBe(true);
    expect(config.capture_pageview).toBe("history_change");
    expect(config.capture_pageleave).toBe(false);
    expect(config.person_profiles).toBe("identified_only");
    // The privacy policy claims analytics is cookieless — pin persistence to
    // localStorage so PostHog never writes a ph_* cookie (the SDK default
    // "localStorage+cookie" would falsify the legal copy).
    expect(config.persistence).toBe("localStorage");

    // The sanitizer is actually wired in, not just exported.
    expect(
      config.sanitize_properties({ $current_url: "https://x.test/a?q=1" }, "$pageview"),
    ).toEqual(sanitizeEventProperties({ $current_url: "https://x.test/a?q=1" }));
  });

  it("initializes at most once", async () => {
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    await Promise.all([initPostHog(), initPostHog()]);
    await initPostHog();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("does not identify when no workspace cookie exists (marketing / signed out)", async () => {
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    await initPostHog();
    expect(identifySpy).not.toHaveBeenCalled();
  });

  it("identifies as the persisted company UUID — the API Worker's distinct_id space", async () => {
    vi.stubGlobal("document", { cookie: `jt-company=${COMPANY_ID}` });
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    await initPostHog();
    expect(identifySpy).toHaveBeenCalledExactlyOnceWith(COMPANY_ID);
  });
});

describe("exception capture (D146)", () => {
  it("turns on posthog-js exception capture and scrubs through before_send", async () => {
    const { initPostHog, scrubExceptionEvent } = await importPostHog(POSTHOG_KEY);
    await initPostHog();

    const [, config] = initSpy.mock.calls[0];
    expect(config.capture_exceptions).toBe(true);
    expect(config.autocapture).toBe(false);
    expect(config.before_send).toBeTypeOf("function");
    const event = { event: "$exception", properties: {} };
    expect(config.before_send(event)).toEqual(scrubExceptionEvent(event as never));
  });

  it("delivers a thrown error's phone number and email address scrubbed", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
    const { scrubExceptionEvent } = await importPostHog(POSTHOG_KEY);
    // The shape posthog-js builds for `new Error("+16135551234 a@b.co")`.
    const out = scrubExceptionEvent({
      uuid: "u",
      event: "$exception",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: "+16135551234 a@b.co",
            mechanism: { handled: false, synthetic: false },
            stacktrace: {
              type: "raw",
              frames: [{ filename: "https://app.loonext.com/_next/static/chunks/a.js", lineno: 1 }],
            },
          },
        ],
        $current_url: "https://app.loonext.com/inbox?q=Jane",
      },
    } as never);

    expect(JSON.stringify(out)).not.toContain("6135551234");
    expect(JSON.stringify(out)).not.toContain("a@b.co");
    const [entry] = out?.properties.$exception_list as { value: string }[];
    expect(entry.value).toBe("[phone redacted] [email redacted]");
    expect(out?.properties).toMatchObject({
      $current_url: "https://app.loonext.com/inbox",
      environment: "production",
      source: "web",
    });
  });

  it("keeps the source a caller gave, so failed queries and mutations stay apart", async () => {
    const { scrubExceptionEvent } = await importPostHog(POSTHOG_KEY);
    const out = scrubExceptionEvent({
      uuid: "u",
      event: "$exception",
      properties: { $exception_list: [{ type: "Error", value: "boom" }], source: "mutation" },
    } as never);
    expect(out?.properties.source).toBe("mutation");
  });

  it("drops a bare network failure, which is the visitor's connection", async () => {
    const { scrubExceptionEvent } = await importPostHog(POSTHOG_KEY);
    expect(
      scrubExceptionEvent({
        uuid: "u",
        event: "$exception",
        properties: { $exception_list: [{ type: "TypeError", value: "Failed to fetch" }] },
      } as never),
    ).toBeNull();
  });

  it("passes every other event through untouched", async () => {
    const { scrubExceptionEvent } = await importPostHog(POSTHOG_KEY);
    const pageview = { uuid: "u", event: "$pageview", properties: { $pathname: "/a" } };
    expect(scrubExceptionEvent(pageview as never)).toBe(pageview);
  });
});

describe("the SDK waits for the page to settle (#640)", () => {
  /** A window whose URL the test can move, as a client navigation does. */
  function stubLocation(href: string) {
    const location = { href, pathname: new URL(href).pathname };
    vi.stubGlobal("window", { location });
    return (next: string) => {
      location.href = next;
      location.pathname = new URL(next).pathname;
    };
  }

  it("downloads and starts only once the page has settled", async () => {
    let open = () => {};
    settle.gate = new Promise<void>((resolve) => (open = resolve));
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    const ready = initPostHog();
    await new Promise((r) => setTimeout(r, 0));
    expect(initSpy).not.toHaveBeenCalled();
    open();
    expect(await ready).not.toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("records the landing page when the visitor moved on before the SDK started", async () => {
    const navigate = stubLocation(
      "https://loonext.com/?utm_source=google&utm_campaign=crew&gclid=TESTGCLID&q=1",
    );
    let open = () => {};
    settle.gate = new Promise<void>((resolve) => (open = resolve));
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    const ready = initPostHog();
    navigate("https://loonext.com/pricing");
    open();
    await ready;

    // The campaign and click id stay on every event of the session, and the
    // landing pageview goes out ahead of the SDK's own one for /pricing.
    expect(registerSpy).toHaveBeenCalledExactlyOnceWith({
      utm_source: "google",
      utm_campaign: "crew",
      gclid: "TESTGCLID",
    });
    expect(captureSpy).toHaveBeenCalledExactlyOnceWith("$pageview", {
      $current_url: "https://loonext.com/?utm_source=google&utm_campaign=crew&gclid=TESTGCLID&q=1",
      $host: "loonext.com",
      $pathname: "/",
    });
    expect(registerSpy.mock.invocationCallOrder[0]).toBeLessThan(
      captureSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("adds no pageview for an in-page anchor, which the SDK does not count as a new page", async () => {
    const navigate = stubLocation("https://loonext.com/legal/privacy?utm_source=google");
    let open = () => {};
    settle.gate = new Promise<void>((resolve) => (open = resolve));
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    const ready = initPostHog();
    navigate("https://loonext.com/legal/privacy?utm_source=google#scope");
    open();
    await ready;
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("adds no pageview for a query change on the same path, but keeps the campaign", async () => {
    const navigate = stubLocation("https://loonext.com/?utm_source=google");
    let open = () => {};
    settle.gate = new Promise<void>((resolve) => (open = resolve));
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    const ready = initPostHog();
    navigate("https://loonext.com/?plan=crew");
    open();
    await ready;
    expect(captureSpy).not.toHaveBeenCalled();
    expect(registerSpy).toHaveBeenCalledExactlyOnceWith({ utm_source: "google" });
  });

  it("leaves the first pageview to the SDK when the visitor is still on the landing page", async () => {
    stubLocation("https://loonext.com/?utm_source=google");
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    await initPostHog();
    expect(captureSpy).not.toHaveBeenCalled();
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it("starts at once on the app, where no page is scored", async () => {
    stubLocation("https://app.loonext.com/inbox");
    settle.gate = new Promise<void>(() => {});
    const { initPostHog } = await importPostHog(POSTHOG_KEY);
    expect(await initPostHog()).not.toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
