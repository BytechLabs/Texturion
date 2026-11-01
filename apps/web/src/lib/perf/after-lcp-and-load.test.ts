// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterLcpAndLoad } from "./after-lcp-and-load";

/**
 * A PerformanceObserver that behaves like the spec: `observe()` with an entry
 * type the browser does not know warns and returns, it does not throw.
 */
function fakeObserver(supported: string[]) {
  const live: { cb: () => void; type?: string; disconnected: boolean }[] = [];
  class FakeObserver {
    static supportedEntryTypes = supported;
    private readonly record: (typeof live)[number];
    constructor(cb: () => void) {
      this.record = { cb, disconnected: false };
      live.push(this.record);
    }
    observe(opts: { type: string }) {
      if (!supported.includes(opts.type)) return;
      this.record.type = opts.type;
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  return {
    paintLcp() {
      for (const r of live) {
        if (r.type === "largest-contentful-paint" && !r.disconnected) r.cb();
      }
    },
  };
}

let readyState: DocumentReadyState;

beforeEach(() => {
  vi.useFakeTimers();
  readyState = "interactive";
  vi.spyOn(document, "readyState", "get").mockImplementation(() => readyState);
});

afterEach(() => {
  vi.useRealTimers();
});

function load() {
  readyState = "complete";
  window.dispatchEvent(new Event("load"));
}

describe("afterLcpAndLoad", () => {
  it("waits for both the LCP entry and the load event", () => {
    const po = fakeObserver(["largest-contentful-paint", "navigation"]);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    po.paintLcp();
    expect(cb).not.toHaveBeenCalled();
    load();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not boot on load alone while an LCP entry can still land", () => {
    const po = fakeObserver(["largest-contentful-paint"]);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    load();
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    po.paintLcp();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("boots 1.5 s after load when no LCP entry lands (bfcache restore)", () => {
    fakeObserver(["largest-contentful-paint"]);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    load();
    vi.advanceTimersByTime(1499);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("boots on load alone where the browser does not report LCP", () => {
    fakeObserver(["navigation", "paint"]);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    expect(cb).not.toHaveBeenCalled();
    load();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("boots on load alone where there is no PerformanceObserver", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    load();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("boots at once on a page that has already loaded, once LCP is in", () => {
    readyState = "complete";
    const po = fakeObserver(["largest-contentful-paint"]);
    const cb = vi.fn();
    afterLcpAndLoad(cb);

    expect(cb).not.toHaveBeenCalled();
    po.paintLcp();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("never boots after it is cancelled", () => {
    const po = fakeObserver(["largest-contentful-paint"]);
    const cb = vi.fn();
    const cancel = afterLcpAndLoad(cb);

    cancel();
    load();
    po.paintLcp();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("whenPageSettles", () => {
  type Idle = (cb: () => void, opts?: { timeout: number }) => number;
  const w = window as unknown as { requestIdleCallback?: Idle };
  const original = w.requestIdleCallback;

  beforeEach(() => {
    // Milliseconds since navigation start, as in a page that just booted.
    vi.spyOn(performance, "now").mockReturnValue(300);
  });

  afterEach(() => {
    w.requestIdleCallback = original;
  });

  /** A fresh module, so the shared promise starts unresolved. */
  async function freshSettle() {
    vi.resetModules();
    return (await import("./after-lcp-and-load")).whenPageSettles;
  }

  it("resolves after LCP, load and an idle moment, with one promise for every caller", async () => {
    const po = fakeObserver(["largest-contentful-paint"]);
    let idleCb: (() => void) | undefined;
    const idle = vi.fn<Idle>((cb) => {
      idleCb = cb;
      return 1;
    });
    w.requestIdleCallback = idle;
    const settle = await freshSettle();
    let done = 0;
    void settle().then(() => done++);
    void settle().then(() => done++);
    expect(settle()).toBe(settle());

    load();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle).not.toHaveBeenCalled();
    po.paintLcp();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 2000 });
    expect(done).toBe(0);

    idleCb?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(2);
  });

  it("falls back to a timeout where there is no requestIdleCallback", async () => {
    const po = fakeObserver(["largest-contentful-paint"]);
    w.requestIdleCallback = undefined;
    const settle = await freshSettle();
    let done = false;
    void settle().then(() => (done = true));

    po.paintLcp();
    load();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("resolves at the visitor's first tap or key press, before load", async () => {
    // The browser stops recording LCP at the first input, and a tap on a
    // link is about to change the URL analytics reads.
    for (const type of ["pointerdown", "keydown"]) {
      fakeObserver(["largest-contentful-paint"]);
      const settle = await freshSettle();
      let done = false;
      void settle().then(() => (done = true));

      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      window.dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(0);
      expect(done, type).toBe(true);
    }
  });

  it("resolves 10 s after navigation start when load never fires", async () => {
    fakeObserver(["largest-contentful-paint"]);
    const settle = await freshSettle();
    let done = false;
    void settle().then(() => (done = true));

    await vi.advanceTimersByTimeAsync(9_699);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
