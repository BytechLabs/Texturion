/**
 * @vitest-environment happy-dom
 *
 * #296 — which marketing page actually produces customers.
 *
 * Three properties carry the feature. The FIRST touch must win, or /pricing
 * (which every signup walks through) wins every comparison and the trade pages
 * look worthless whatever they do. The window must EXPIRE, or a page read last
 * spring gets credit for an unrelated signup. And hostile query parameters must
 * never reach storage, because these arrive on a public marketing page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureFirstTouch,
  clearFirstTouch,
  firstTouchForCreate,
} from "./first-touch";

const KEY = "loonext:first-touch";

describe("first-touch capture (#296)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records the landing page a visitor arrived on", () => {
    captureFirstTouch("/for/plumbers", "", "https://www.google.com/search?q=x");

    expect(firstTouchForCreate()).toEqual({
      first_touch: {
        landing_path: "/for/plumbers",
        referrer_host: "www.google.com",
        params: {},
      },
    });
  });

  // The point of the whole feature. Under last-touch every signup would be
  // credited to /pricing, because every signup walks through /pricing.
  it("keeps the FIRST landing when the visitor comes back through another page", () => {
    captureFirstTouch("/compare/heymarket", "", "https://www.google.com/");
    captureFirstTouch("/pricing", "", "https://loonext.com/");

    expect(firstTouchForCreate().first_touch?.landing_path).toBe(
      "/compare/heymarket",
    );
  });

  it("forgets a touch older than the 30-day window", () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    captureFirstTouch("/for/electricians", "", "https://www.google.com/");

    vi.setSystemTime(new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000));
    expect(firstTouchForCreate()).toEqual({});

    // ...and the stale row is gone, not merely ignored.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("re-opens attribution once the old touch has expired", () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    captureFirstTouch("/for/electricians", "", "https://www.google.com/");

    vi.setSystemTime(new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000));
    captureFirstTouch("/for/hvac", "", "https://www.bing.com/");

    expect(firstTouchForCreate().first_touch?.landing_path).toBe("/for/hvac");
  });

  it("keeps allow-listed campaign parameters and drops everything else", () => {
    captureFirstTouch(
      "/",
      "?utm_source=google&utm_campaign=spring&phone=%2B14165551234&email=a@b.ca",
      "",
    );

    expect(firstTouchForCreate().first_touch?.params).toEqual({
      utm_source: "google",
      utm_campaign: "spring",
    });
  });

  it("does not record a bare direct landing on the homepage", () => {
    captureFirstTouch("/", "", "");

    expect(firstTouchForCreate()).toEqual({});
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("records a bare homepage landing that came from somewhere", () => {
    captureFirstTouch("/", "", "https://news.ycombinator.com/item?id=1");

    expect(firstTouchForCreate().first_touch).toEqual({
      landing_path: "/",
      referrer_host: "news.ycombinator.com",
      params: {},
    });
  });

  it("omits referrer_host entirely rather than sending null", () => {
    captureFirstTouch("/for/roofers", "", "");

    const body = firstTouchForCreate().first_touch;
    expect(body).toEqual({ landing_path: "/for/roofers", params: {} });
    expect("referrer_host" in (body ?? {})).toBe(false);
  });

  it("survives a value somebody else wrote under our key", () => {
    window.localStorage.setItem(KEY, "not json");

    expect(() => firstTouchForCreate()).not.toThrow();
    expect(firstTouchForCreate()).toEqual({});

    // ...and a garbage value does not block a real capture.
    captureFirstTouch("/for/plumbers", "", "");
    expect(firstTouchForCreate().first_touch?.landing_path).toBe(
      "/for/plumbers",
    );
  });

  // A browser with storage blocked throws on ACCESS, not on the call — which
  // is why every use is wrapped rather than every method guarded. An
  // unattributed signup is fine; a signup that throws is not.
  it("never breaks a signup when storage is unavailable", () => {
    const real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });

    try {
      expect(() => captureFirstTouch("/for/plumbers", "", "")).not.toThrow();
      expect(() => firstTouchForCreate()).not.toThrow();
      expect(firstTouchForCreate()).toEqual({});
      expect(() => clearFirstTouch()).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: real,
      });
    }
  });

  it("clears the touch so a second workspace is not miscredited", () => {
    captureFirstTouch("/for/plumbers", "", "");
    clearFirstTouch();

    expect(firstTouchForCreate()).toEqual({});
  });
});
