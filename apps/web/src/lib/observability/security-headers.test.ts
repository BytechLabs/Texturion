import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS } from "./security-headers";

// Value-locking suite: these exact header values are the D8 hardening surface
// a scanner (or a prospect reading /security) checks. next.config.ts applies
// the list verbatim to source "/(.*)" — a drive-by edit here should have to
// update this file too.
describe("SECURITY_HEADERS (issue #33 response-header hardening)", () => {
  const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("forbids framing via both the CSP directive and the legacy header", () => {
    expect(byKey.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
  });

  /**
   * #577 — the three directives that need no per-request nonce.
   *
   * Pinned individually rather than as one string so a future `script-src`
   * can be added without rewriting this, and so a failure names the directive
   * that went missing rather than diffing a sixty-character line.
   */
  it.each([
    ["base-uri 'self'", "an injected <base href> re-points every relative URL"],
    ["object-src 'none'", "plugin content executes under its own rules"],
    ["form-action 'self'", "an injected form must not POST credentials away"],
  ])("carries %s, because %s", (directive) => {
    expect(byKey.get("Content-Security-Policy")).toContain(directive);
  });

  /**
   * The policy may not permit what it exists to forbid.
   *
   * #577's own argument: a `script-src` made to pass with `unsafe-inline`
   * reads as protection to every audit that greps for the header while
   * enforcing nothing. An honest short policy is better than a dishonest long
   * one, so if `script-src` ever appears here it has to arrive without these.
   */
  it("never buys a directive with unsafe-inline or unsafe-eval", () => {
    const csp = byKey.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  /**
   * Semicolon-separated, which is the only shape a browser parses.
   *
   * A comma joins two POLICIES rather than two directives, and a browser then
   * enforces the INTERSECTION — so a comma here would silently apply
   * `frame-ancestors` and nothing else, which is exactly the state this issue
   * exists to leave behind.
   */
  it("separates directives with semicolons rather than commas", () => {
    const csp = byKey.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain(",");
    expect(csp.split(";").length).toBeGreaterThanOrEqual(4);
  });

  it("forbids MIME sniffing", () => {
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("pins HTTPS for a year including subdomains, preload-eligible (#118)", () => {
    expect(byKey.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("isolates the browsing context group (#118, no scripted popups exist)", () => {
    expect(byKey.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("keeps full referrers same-origin only", () => {
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies powerful features but allows the mic for our own origin (D43 softphone)", () => {
    expect(byKey.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
    );
  });

  it("contains no duplicate keys and nothing beyond the audited set", () => {
    expect(byKey.size).toBe(SECURITY_HEADERS.length);
    expect([...byKey.keys()].sort()).toEqual(
      [
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
  });
});
