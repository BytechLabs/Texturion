/**
 * #577 step 2 — the policy that carries a nonce.
 *
 * The static half is pinned next door in `security-headers.test.ts`. What is
 * different about this one is that it is generated per response, so the things
 * worth asserting are the ones a generator can silently get wrong: a nonce that
 * repeats, a directive bought with `unsafe-inline`, a comma where a semicolon
 * belongs, and the one omission that would break a shipped feature.
 */
import { describe, expect, it } from "vitest";

import {
  CSP_HEADER,
  CSP_REPORT_PATH,
  createNonce,
  cspStagingEnabled,
  nonceContentSecurityPolicy,
  reportingEndpointsHeader,
} from "./csp";

describe("the staging switch", () => {
  it("is off unless a window is deliberately opened", () => {
    // Not a feature flag hedging a risk — the policy is report-only and blocks
    // nothing. It is a COST control: this app ships 93 prerendered HTML files
    // whose inline scripts can carry no nonce, so leaving it on would have
    // every visitor POST a violation report about a fault already measured on
    // the build, at our own open endpoint.
    expect(cspStagingEnabled({})).toBe(false);
    expect(cspStagingEnabled({ CSP_STAGING: "" })).toBe(false);
    expect(cspStagingEnabled({ CSP_STAGING: "true" })).toBe(false);
    expect(cspStagingEnabled({ CSP_STAGING: "on" })).toBe(false);
    expect(cspStagingEnabled({ CSP_STAGING: "report-only" })).toBe(true);
  });
});

describe("the nonce", () => {
  it("is different every time", () => {
    // A nonce an attacker can predict is not a nonce — they can write a
    // `<script nonce=…>` the policy welcomes. 200 draws is not a randomness
    // test; it is a guard against the plausible mistake of computing it once
    // at module scope, which would produce one nonce per isolate and hand it
    // to every visitor that isolate serves.
    const drawn = new Set(Array.from({ length: 200 }, () => createNonce()));

    expect(drawn.size).toBe(200);
  });

  it("is base64 and long enough to be worth generating", () => {
    // 16 bytes → 24 base64 characters. The CSP grammar wants base64, and a
    // shorter value is a guessable one.
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(createNonce().length).toBeGreaterThanOrEqual(20);
  });
});

describe("the policy", () => {
  const policy = nonceContentSecurityPolicy("TESTNONCE");

  it("admits this render's inline scripts and nothing else's", () => {
    expect(policy).toContain("script-src 'self' 'nonce-TESTNONCE' 'strict-dynamic'");
  });

  it("never buys a directive with unsafe-inline or unsafe-eval", () => {
    // #577's own argument, and the same guard the static policy carries: a
    // script-src made to pass with `unsafe-inline` permits exactly what it
    // exists to forbid, while reading as protection to every audit that greps
    // for the header.
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    // And no `https:` fallback, which is the other way the recipe is commonly
    // watered down — it re-admits every host on the internet for any browser
    // that does not understand strict-dynamic.
    expect(policy).not.toContain(" https:");
  });

  it("names worker-src, because the service worker is how push arrives", () => {
    // Workers fall back to `script-src` when `worker-src` is absent, and under
    // a nonce-only script-src that refuses to register the service worker —
    // silently taking web push with it. The one omission here that would break
    // a feature rather than a page.
    expect(policy).toContain("worker-src 'self'");
  });

  it("joins with semicolons, never commas", () => {
    // A comma declares two separate POLICIES inside one header, and a browser
    // enforces their intersection — so the header looks longer while enforcing
    // less. The static policy has this test for the same reason; it is the
    // failure this whole issue is about.
    expect(policy).not.toContain(",");
    expect(policy.split("; ").length).toBeGreaterThan(3);
  });

  it("sends reports to our own origin, in both spellings", () => {
    // `report-uri` is deprecated and is what Safari and older Chrome actually
    // use; `report-to` is the replacement. Sending one collects from half the
    // browsers and looks like a quiet policy.
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain("report-to csp");
    expect(reportingEndpointsHeader()).toBe(`csp="${CSP_REPORT_PATH}"`);
    // Relative, so it is same-origin on the app host, the marketing host, the
    // blog host and localhost without any of them knowing about the others.
    expect(CSP_REPORT_PATH.startsWith("/")).toBe(true);
  });

  it("is staged report-only, so a mistake here cannot break a page", () => {
    // The flip to enforcement is one word in this constant, made on evidence
    // from the reports rather than on confidence. Report-only blocks nothing,
    // which is what makes shipping it without a flag reasonable.
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
    // And Next reads the nonce out of EITHER header, so its own inline scripts
    // are marked while staging — without that the reports would be full of
    // violations caused by the staging itself.
  });
});
