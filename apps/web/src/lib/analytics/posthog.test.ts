import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.app";
const POSTHOG_KEY = "phc_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const COMPANY_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const PHONE = "+14165551234";

// posthog-js is loaded via dynamic import inside initPostHog — mock it so the
// tests can prove exactly when (and with what config) init/identify fire.
const { initSpy, identifySpy } = vi.hoisted(() => ({
  initSpy: vi.fn(),
  identifySpy: vi.fn(),
}));
vi.mock("posthog-js", () => ({
  default: { init: initSpy, identify: identifySpy },
}));

// posthog.ts imports @/env (validated at module load), so each test stubs the
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
        $current_url: `https://app.loonext.app/contacts?q=${encodeURIComponent(PHONE)}`,
        $pathname: "/contacts",
        $referrer: "https://loonext.com/pricing#faq",
        $session_entry_url: `https://app.loonext.app/inbox/${COMPANY_ID}?q=1#x`,
      }),
    ).toEqual({
      $current_url: "https://app.loonext.app/contacts",
      $pathname: "/contacts",
      $referrer: "https://loonext.com/pricing",
      $session_entry_url: `https://app.loonext.app/inbox/${COMPANY_ID}`,
    });
  });

  it("redacts phone runs inside a URL path even after the query is gone", async () => {
    const { sanitizeEventProperties } = await importPostHog(POSTHOG_KEY);
    expect(
      sanitizeEventProperties({
        $current_url: "https://app.loonext.app/contacts/+14165551234?tab=notes",
      }),
    ).toEqual({
      $current_url: "https://app.loonext.app/contacts/[phone redacted]",
    });
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
