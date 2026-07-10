import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS } from "./security-headers";

// Value-locking suite: these exact header values are the D8 hardening surface
// a scanner (or a prospect reading /security) checks. next.config.ts applies
// the list verbatim to source "/(.*)" — a drive-by edit here should have to
// update this file too.
describe("SECURITY_HEADERS (issue #33 response-header hardening)", () => {
  const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("forbids framing via both the CSP directive and the legacy header", () => {
    expect(byKey.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
  });

  it("forbids MIME sniffing", () => {
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("pins HTTPS for a year including subdomains, preload-eligible (#118)", () => {
    expect(byKey.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
  });

  it("isolates the browsing context group (#118, no scripted popups exist)", () => {
    expect(byKey.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("keeps full referrers same-origin only", () => {
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies the powerful browser features the product never uses", () => {
    expect(byKey.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
