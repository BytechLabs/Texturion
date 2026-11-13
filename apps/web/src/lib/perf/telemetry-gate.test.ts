import { afterEach, describe, expect, it, vi } from "vitest";

const { settle } = vi.hoisted(() => ({
  settle: vi.fn(() => new Promise<void>(() => {})),
}));
vi.mock("./after-lcp-and-load", () => ({ whenPageSettles: settle }));

import { whenTelemetryMayLoad } from "./telemetry-gate";

afterEach(() => {
  vi.unstubAllGlobals();
  settle.mockClear();
});

async function resolvesAtOnce(gate: Promise<void>): Promise<boolean> {
  let done = false;
  void gate.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 0));
  return done;
}

/** A browser on an app page, with the load event and idle callbacks in hand. */
function stubAppPage(
  pathname: string,
  {
    readyState = "loading",
    idle = true,
  }: { readyState?: DocumentReadyState; idle?: boolean } = {},
) {
  const loadListeners: (() => void)[] = [];
  const idleCallbacks: { cb: () => void; timeout?: number }[] = [];
  const timeouts: (() => void)[] = [];
  vi.stubGlobal("document", { readyState });
  vi.stubGlobal("window", {
    location: { pathname },
    addEventListener: (type: string, cb: () => void) => {
      if (type === "load") loadListeners.push(cb);
    },
    requestIdleCallback: idle
      ? (cb: () => void, options?: { timeout?: number }) => {
          idleCallbacks.push({ cb, timeout: options?.timeout });
          return 1;
        }
      : undefined,
    setTimeout: (cb: () => void) => {
      timeouts.push(cb);
      return 1;
    },
  });
  return {
    fireLoad: () => loadListeners.splice(0).forEach((cb) => cb()),
    idleCallbacks,
    timeouts,
  };
}

describe("whenTelemetryMayLoad", () => {
  it("waits for the page to settle on a marketing page (#640)", async () => {
    for (const pathname of ["/", "/pricing", "/fr/tarifs", "/blog/some-post"]) {
      vi.stubGlobal("window", { location: { pathname } });
      expect(await resolvesAtOnce(whenTelemetryMayLoad()), pathname).toBe(false);
    }
    expect(settle).toHaveBeenCalledTimes(4);
  });

  it("on the app, waits for load and then an idle moment of at most 5 s", async () => {
    for (const pathname of ["/inbox", "/for-you", "/settings/billing", "/login", "/onboarding"]) {
      const page = stubAppPage(pathname);
      const gate = whenTelemetryMayLoad();
      expect(await resolvesAtOnce(gate), `${pathname} before load`).toBe(false);

      page.fireLoad();
      expect(page.idleCallbacks).toHaveLength(1);
      expect(page.idleCallbacks[0].timeout).toBe(5_000);
      expect(await resolvesAtOnce(gate), `${pathname} before idle`).toBe(false);

      page.idleCallbacks[0].cb();
      expect(await resolvesAtOnce(gate), `${pathname} after idle`).toBe(true);
    }
    expect(settle).not.toHaveBeenCalled();
  });

  it("asks for the idle moment at once when the page has already loaded", async () => {
    const page = stubAppPage("/inbox", { readyState: "complete" });
    const gate = whenTelemetryMayLoad();
    expect(page.idleCallbacks).toHaveLength(1);
    page.idleCallbacks[0].cb();
    expect(await resolvesAtOnce(gate)).toBe(true);
  });

  it("falls back to a timer where requestIdleCallback does not exist", async () => {
    const page = stubAppPage("/inbox", { idle: false });
    const gate = whenTelemetryMayLoad();
    page.fireLoad();
    expect(page.timeouts).toHaveLength(1);
    expect(await resolvesAtOnce(gate)).toBe(false);
    page.timeouts[0]();
    expect(await resolvesAtOnce(gate)).toBe(true);
  });
});
