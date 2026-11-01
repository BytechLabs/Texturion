import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sourceFiles, sourceText } from "@/test/source-tree";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";
const DSN = "https://abc123def456@o4506000000000.ingest.us.sentry.io/4506000000001";

// The SDK is loaded via dynamic import inside initSentryClient — mock it so
// the tests can prove exactly when (and with what) init fires.
const { initSpy, captureSpy, settle } = vi.hoisted(() => {
  const settle = { release: () => {}, gate: Promise.resolve() };
  return { initSpy: vi.fn(), captureSpy: vi.fn(), settle };
});
vi.mock("@sentry/browser", () => ({ init: initSpy, captureException: captureSpy }));
// The page-settled gate, held shut until a test opens it.
vi.mock("@/lib/perf/after-lcp-and-load", () => ({ whenPageSettles: () => settle.gate }));

// sentry.ts reads the DSN at module load, so each test stubs the required
// NEXT_PUBLIC_* set first and imports a fresh copy. The scrub module
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
  captureSpy.mockClear();
  settle.gate = Promise.resolve();
});

/** Shut the gate; the returned function opens it. */
function holdPage(): () => Promise<void> {
  settle.gate = new Promise((resolve) => (settle.release = resolve));
  return async () => {
    settle.release();
    await new Promise((r) => setTimeout(r, 0));
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentryClientOptions (D8/§10 posture, mirroring the API Worker)", () => {
  it("wires the DSN with PII off, tracing off, and the scrubbers installed", async () => {
    const { sentryClientOptions, scrubBreadcrumb } = await importSentry(DSN);
    const options = sentryClientOptions(DSN);
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(typeof options.beforeSend).toBe("function");
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("beforeSend DROPS bare network fetch failures (device connectivity, not our bug)", async () => {
    const { sentryClientOptions } = await importSentry(DSN);
    const beforeSend = sentryClientOptions(DSN).beforeSend!;
    for (const value of ["Failed to fetch", "Load failed", "NetworkError"]) {
      const event = { exception: { values: [{ type: "TypeError", value }] } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(beforeSend(event as any, {} as any)).toBeNull();
    }
  });

  it("beforeSend KEEPS (and scrubs) a genuine app error", async () => {
    const { sentryClientOptions } = await importSentry(DSN);
    const beforeSend = sentryClientOptions(DSN).beforeSend!;
    const event = {
      exception: { values: [{ type: "Error", value: "boom" }] },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = beforeSend(event as any, {} as any);
    expect(out).not.toBeNull();
  });
});

describe("initSentryClient (NEXT_PUBLIC_SENTRY_DSN optional — absent = off)", () => {
  it("is a silent no-op when the DSN is not configured", async () => {
    const { initSentryClient } = await importSentry(undefined);
    await initSentryClient();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("initializes the browser SDK with the scrubbed options when the DSN is set", async () => {
    const { initSentryClient } = await importSentry(DSN);
    await initSentryClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
    const options = initSpy.mock.calls[0][0];
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(typeof options.beforeSend).toBe("function");
  });

  it("initializes at most once", async () => {
    const { initSentryClient } = await importSentry(DSN);
    await Promise.all([initSentryClient(), initSentryClient()]);
    await initSentryClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the SDK waits for the page to settle (#640)", () => {
  it("downloads and starts only once the page has settled", async () => {
    const open = holdPage();
    const { initSentryClient } = await importSentry(DSN);
    const ready = initSentryClient();
    await new Promise((r) => setTimeout(r, 0));
    expect(initSpy).not.toHaveBeenCalled();
    await open();
    expect(await ready).not.toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("reports an error handled before then once the SDK is up", async () => {
    const open = holdPage();
    const { reportClientError } = await importSentry(DSN);
    const error = new Error("api 503");
    reportClientError(error, { surface: "inbox" });
    await new Promise((r) => setTimeout(r, 0));
    expect(captureSpy).not.toHaveBeenCalled();
    await open();
    expect(captureSpy).toHaveBeenCalledWith(error, { tags: { surface: "inbox" } });
  });

  it("does nothing when the DSN is not configured", async () => {
    const { reportClientError } = await importSentry(undefined);
    reportClientError(new Error("x"));
    await new Promise((r) => setTimeout(r, 0));
    expect(initSpy).not.toHaveBeenCalled();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  /** A window on `pathname` whose error listeners the test can fire. */
  function stubWindow(pathname: string) {
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", {
      location: { pathname },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    return listeners;
  }

  it("holds uncaught errors and rejections from before init, then reports them as unhandled", async () => {
    const listeners = stubWindow("/");
    const open = holdPage();
    const { initSentryClient } = await importSentry(DSN);
    const ready = initSentryClient();
    const thrown = new Error("hydration");
    listeners.get("error")?.({ error: thrown, message: "hydration" });
    listeners.get("unhandledrejection")?.({ reason: "rejected" });
    listeners.get("error")?.({
      error: null,
      message: "Script error.",
      filename: "https://cdn.example/x.js",
      lineno: 3,
      colno: 14,
    });
    expect(captureSpy).not.toHaveBeenCalled();
    await open();
    await ready;
    // The mechanisms Sentry's own global handlers report with, so a boot
    // crash still counts as unhandled in issue filters and crash-free rates.
    expect(captureSpy.mock.calls).toEqual([
      [
        thrown,
        {
          originalException: thrown,
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
        },
      ],
      [
        "rejected",
        {
          originalException: "rejected",
          mechanism: { type: "auto.browser.global_handlers.onunhandledrejection", handled: false },
        },
      ],
      [
        "Script error.",
        {
          originalException: null,
          mechanism: {
            type: "auto.browser.global_handlers.onerror",
            handled: false,
            data: { filename: "https://cdn.example/x.js", lineno: "3", colno: "14" },
          },
        },
      ],
    ]);
    // The SDK's own handlers take over from here.
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("starts at once on the app, where no page is scored", async () => {
    stubWindow("/inbox");
    holdPage();
    const { initSentryClient } = await importSentry(DSN);
    expect(await initSentryClient()).not.toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("@sentry/browser is reached only through sentry-sdk.ts", () => {
  /** Any import or re-export of the package's values, static or dynamic. */
  const importsSdkValues = (text: string) =>
    /\bimport\(\s*["']@sentry\/browser["']\s*\)/.test(text) ||
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']@sentry\/browser["']/m.test(text);

  it("has no other import of the package that keeps every export", () => {
    const files = sourceFiles(join(process.cwd(), "src"), [".ts", ".tsx"]);
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("sentry-sdk.ts"))).toBe(true);
    const offenders = files
      .filter((file) => !/\.test\.tsx?$/.test(file) && !file.endsWith("sentry-sdk.ts"))
      .filter((file) => importsSdkValues(sourceText(file)));
    expect(
      offenders,
      "Only lib/observability/sentry-sdk.ts imports values from " +
        "@sentry/browser. Export what you need from there; a type import is " +
        "fine anywhere.",
    ).toEqual([]);
  });

  it("tells a type import from one that brings in the SDK", () => {
    for (const code of [
      'const S = await import("@sentry/browser");',
      "const S = await import('@sentry/browser');",
      'import * as Sentry from "@sentry/browser";',
      'import { init } from "@sentry/browser";',
      "import { init } from '@sentry/browser';",
      'import {\n  init,\n  captureException,\n} from "@sentry/browser";',
      'export * from "@sentry/browser";',
      "export { init } from '@sentry/browser';",
    ]) {
      expect(importsSdkValues(code), code).toBe(true);
    }
    for (const code of [
      'import type { ErrorEvent } from "@sentry/browser";',
      "export type { BrowserOptions } from '@sentry/browser';",
      'import { init } from "./sentry-sdk";',
    ]) {
      expect(importsSdkValues(code), code).toBe(false);
    }
  });
});
