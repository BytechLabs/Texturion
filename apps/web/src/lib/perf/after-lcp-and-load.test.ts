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
