import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";

// env.ts validates at module load, so each test stubs process.env first and
// then imports a fresh copy of the module.
async function importEnv() {
  return import("./env");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public env validation (SPEC §3, §10)", () => {
  it("exposes exactly the allowed NEXT_PUBLIC_* values when all are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    const { publicEnv } = await importEnv();
    expect(publicEnv).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: VALID_KEY,
      NEXT_PUBLIC_API_URL: VALID_API,
    });
  });

  it("fails loudly and names the key when the Supabase URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("fails loudly when the publishable key is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("rejects a Supabase URL that is not a URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("fails loudly when the API origin is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);

    await expect(importEnv()).rejects.toThrowError(/NEXT_PUBLIC_API_URL/);
  });

  // The Turnstile site key is optional: local dev and CI run without it, and
  // the auth screens only render the captcha when it is present.
  it("exposes the Turnstile site key when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAAFakeKey");

    const { publicEnv } = await importEnv();
    expect(publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe("0x4AAAAAAAFakeKey");
  });

  it("treats a missing Turnstile site key as not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

    const { publicEnv } = await importEnv();
    expect(publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined();
  });

  it("treats a blank Turnstile site key as not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");

    const { publicEnv } = await importEnv();
    expect(publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined();
  });

  // Sentry DSN + PostHog key are optional: unset means the telemetry client
  // in question is silently off (lib/observability/sentry.ts,
  // lib/analytics/posthog.ts) — dev/CI/previews need neither.
  it("exposes the Sentry DSN and PostHog key when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://abc123@o4506000.ingest.us.sentry.io/4506001",
    );
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_0123456789abcdef");

    const { publicEnv } = await importEnv();
    expect(publicEnv.NEXT_PUBLIC_SENTRY_DSN).toBe(
      "https://abc123@o4506000.ingest.us.sentry.io/4506001",
    );
    expect(publicEnv.NEXT_PUBLIC_POSTHOG_KEY).toBe("phc_0123456789abcdef");
  });

  it("rejects a Sentry DSN that is not a URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "not-a-dsn");

    await expect(importEnv()).rejects.toThrowError(/NEXT_PUBLIC_SENTRY_DSN/);
  });

  it("treats blank Sentry/PostHog values as not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");

    const { publicEnv } = await importEnv();
    expect(publicEnv.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(publicEnv.NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
  });
});
