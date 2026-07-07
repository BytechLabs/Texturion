import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.app";
const DSN = "https://abc123def456@o4506000000000.ingest.us.sentry.io/4506000000001";

// The SDK is loaded via dynamic import inside initSentryClient — mock it so
// the tests can prove exactly when (and with what) init fires.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }));
vi.mock("@sentry/browser", () => ({ init: initSpy }));

// sentry.ts imports @/env (validated at module load), so each test stubs the
// required NEXT_PUBLIC_* set first and imports a fresh copy. The scrub module
// is re-imported alongside it so identity checks (`toBe`) compare functions
// from the same post-reset module registry.
async function importSentry(dsn: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
  vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  const [sentry, scrub] = await Promise.all([
    import("./sentry"),
    import("./scrub"),
  ]);
  return { ...sentry, ...scrub };
}

beforeEach(() => {
  vi.resetModules();
  initSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentryClientOptions (D8/§10 posture, mirroring the API Worker)", () => {
  it("wires the DSN with PII off, tracing off, and the scrubbers installed", async () => {
    const { sentryClientOptions, scrubEvent, scrubBreadcrumb } =
      await importSentry(DSN);
    const options = sentryClientOptions(DSN);
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });
});

describe("initSentryClient (NEXT_PUBLIC_SENTRY_DSN optional — absent = off)", () => {
  it("is a silent no-op when the DSN is not configured", async () => {
    const { initSentryClient } = await importSentry(undefined);
    await initSentryClient();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("initializes the browser SDK with the scrubbed options when the DSN is set", async () => {
    const { initSentryClient, scrubEvent } = await importSentry(DSN);
    await initSentryClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
    const options = initSpy.mock.calls[0][0];
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(scrubEvent);
  });

  it("initializes at most once", async () => {
    const { initSentryClient } = await importSentry(DSN);
    await Promise.all([initSentryClient(), initSentryClient()]);
    await initSentryClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
