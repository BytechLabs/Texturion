import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_PARAMS,
  ATTRIBUTION_PATH_MAX,
  ATTRIBUTION_VALUE_MAX,
  attributionParams,
  isMeaningfulTouch,
  referrerHost,
  sanitizeAttributionValue,
  sanitizeLandingPath,
} from "./attribution";

/**
 * #296 — attribution, tested from the direction that costs something.
 *
 * These values are attacker-controlled: they arrive as query parameters on a
 * public marketing page and end up in telemetry and on the company row. The
 * scrubber cuts every other query string precisely because a query string can
 * carry a contact name or a message body, so this allow-list is the one hole
 * in that rule — and a hole that accepts arbitrary strings would reopen the
 * whole problem.
 */
describe("#296 the allow-list is closed, not open", () => {
  it("keeps only the campaign keys, and drops everything else", () => {
    const params = attributionParams(
      "utm_source=google&utm_medium=cpc&q=Jane+Doe&email=jane%40example.com&ref=ABCD1234",
    );
    expect(params).toEqual({ utm_source: "google", utm_medium: "cpc" });
    // The two that would have been a privacy incident.
    expect(Object.keys(params)).not.toContain("q");
    expect(Object.keys(params)).not.toContain("email");
  });

  it("names every allowed key explicitly, so widening it is a deliberate edit", () => {
    expect([...ATTRIBUTION_PARAMS]).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gclid",
      "fbclid",
    ]);
  });
});

describe("#296 values are bounded and shaped", () => {
  it("accepts what ad tooling actually emits", () => {
    for (const good of ["google", "cpc", "spring-2026", "brand_terms", "a.b~c%20d", "Cj0KCQ+x"]) {
      expect(sanitizeAttributionValue(good), good).toBe(good);
    }
  });

  it("refuses anything that is not a campaign token", () => {
    // A name, an address, a script, and a length nobody names a campaign.
    for (const bad of [
      "Jane Doe",
      "jane@example.com",
      "<script>alert(1)</script>",
      "a".repeat(ATTRIBUTION_VALUE_MAX + 1),
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(sanitizeAttributionValue(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("trims, because a trailing space is a different campaign otherwise", () => {
    expect(sanitizeAttributionValue("  google  ")).toBe("google");
  });
});

describe("#296 the landing path never smuggles a query", () => {
  it("keeps a marketing route", () => {
    expect(sanitizeLandingPath("/compare/heymarket")).toBe("/compare/heymarket");
    expect(sanitizeLandingPath("/for/plumbers")).toBe("/for/plumbers");
    expect(sanitizeLandingPath("/")).toBe("/");
  });

  it("cuts a query or fragment rather than refusing the path", () => {
    // The path is the useful part; the query is the dangerous part.
    expect(sanitizeLandingPath("/compare?q=Jane+Doe")).toBe("/compare");
    expect(sanitizeLandingPath("/pricing#plans")).toBe("/pricing");
  });

  it("refuses a full URL, a protocol-relative path, and anything unbounded", () => {
    // A full URL would carry the origin's own query string past the cut above.
    for (const bad of [
      "https://evil.example.com/x",
      "//evil.example.com",
      "compare",
      "",
      "/" + "a".repeat(ATTRIBUTION_PATH_MAX),
      null,
    ]) {
      expect(sanitizeLandingPath(bad as string | null), String(bad)).toBeNull();
    }
  });
});

describe("#296 the referrer is a host, never a URL", () => {
  it("keeps the host and discards the rest", () => {
    // The whole point: google's referrer carries the search the person typed.
    expect(referrerHost("https://www.google.com/search?q=plumber+texting+app")).toBe(
      "www.google.com",
    );
    expect(referrerHost("https://Reddit.COM/r/plumbing")).toBe("reddit.com");
  });

  it("returns null on anything unparseable or absent", () => {
    for (const bad of ["", "   ", "not a url", null, undefined]) {
      expect(referrerHost(bad as string | null), String(bad)).toBeNull();
    }
  });
});

describe("#296 a touch that says nothing is not recorded", () => {
  const base = { landing_path: "/", referrer_host: null, params: {}, at: "2026-08-02T10:00:00Z" };

  it("ignores a bare direct landing on the homepage", () => {
    // Otherwise "direct" becomes the best-performing page we have, which is
    // both true and useless.
    expect(isMeaningfulTouch(base)).toBe(false);
  });

  it("records a landing that carries any signal at all", () => {
    expect(isMeaningfulTouch({ ...base, landing_path: "/for/plumbers" })).toBe(true);
    expect(isMeaningfulTouch({ ...base, referrer_host: "www.google.com" })).toBe(true);
    expect(isMeaningfulTouch({ ...base, params: { utm_source: "google" } })).toBe(true);
  });
});
