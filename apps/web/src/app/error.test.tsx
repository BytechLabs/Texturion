import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Root error boundary guards: branded retry surface (v4 palette, wordmark,
 * reset() button) plus the Sentry hand-off — captureException only when
 * NEXT_PUBLIC_SENTRY_DSN is configured, silent no-op otherwise, and never a
 * rejection (the error page must not itself error).
 */

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";
const DSN =
  "https://abc123def456@o4506000000000.ingest.us.sentry.io/4506000000001";

// The SDK is loaded via dynamic import inside reportBoundaryError — mock it
// so the tests can prove exactly when (and with what) capture fires.
const { captureSpy } = vi.hoisted(() => ({ captureSpy: vi.fn() }));
vi.mock("@sentry/browser", () => ({ captureException: captureSpy }));

// error.tsx imports @/env (validated at module load), so each test stubs the
// required NEXT_PUBLIC_* set first and imports a fresh copy.
async function importBoundary(dsn: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
  vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  return import("./error");
}

beforeEach(() => {
  vi.resetModules();
  captureSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reportBoundaryError (Sentry hand-off)", () => {
  it("is a silent no-op when the DSN is not configured", async () => {
    const { reportBoundaryError } = await importBoundary(undefined);
    await reportBoundaryError(new Error("boom"));
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures the error when the DSN is set", async () => {
    const { reportBoundaryError } = await importBoundary(DSN);
    const error = Object.assign(new Error("boom"), { digest: "d1g3st" });
    await reportBoundaryError(error);
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(error);
  });

  it("never rejects, even when the SDK throws", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureSpy.mockImplementation(() => {
      throw new Error("sdk exploded");
    });
    const { reportBoundaryError } = await importBoundary(DSN);
    await expect(reportBoundaryError(new Error("boom"))).resolves.toBe(
      undefined,
    );
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("root error page markup", () => {
  async function render(digest?: string) {
    const { default: RootError } = await importBoundary(undefined);
    const error = Object.assign(new Error("boom"), { digest });
    return renderToStaticMarkup(
      <RootError error={error} reset={() => undefined} />,
    );
  }

  it("carries the wordmark, the honest headline, and a retry button", async () => {
    const html = await render();
    expect(html).toContain("Loonext");
    expect(html).toContain("Something broke on our side.");
    expect(html).toContain("Try again");
    expect(html).toContain("<button");
  });

  it("links home and to /contact for persistent failures", async () => {
    const html = await render();
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/contact"');
  });

  it("shows the Next.js digest as a support reference when present", async () => {
    expect(await render("abc123")).toContain("Reference: abc123");
    expect(await render(undefined)).not.toContain("Reference:");
  });

  it("inlines the v4 palette and uses no em-dashes", async () => {
    const html = await render();
    expect(html).toContain("#FBFCFE");
    expect(html).toContain("#10173B");
    expect(html).toContain("#2740DE");
    expect(html).not.toMatch(/—|–/);
  });
});
