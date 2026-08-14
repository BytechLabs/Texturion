/**
 * #577 — what a violation report is allowed to leave behind.
 *
 * The endpoint is open to the internet and its input is composed by a browser
 * that is, by definition, on a page something went wrong on. So the assertions
 * that matter are about what is THROWN AWAY: this product's URLs name a
 * conversation, and #585 is the record of what logging one from a place nobody
 * was watching costs.
 */
import { describe, expect, it } from "vitest";

import { cspReportLine } from "./csp-report";

const legacy = (body: Record<string, unknown>) =>
  JSON.stringify({ "csp-report": body });

describe("what reaches the log", () => {
  it("keeps the directive and the blocked origin", () => {
    // Which rule fired and which host tried to run something is the entire
    // diagnostic value of a report.
    const line = cspReportLine(
      legacy({
        "effective-directive": "script-src",
        "blocked-uri": "https://www.googletagmanager.com/gtm.js?id=GTM-X",
        "document-uri": "https://loonext.com/pricing",
        disposition: "report",
      }),
    );

    expect(line).toBe(
      "csp-violation report directive=script-src " +
        "blocked=https://www.googletagmanager.com route=/pricing",
    );
  });

  it("reduces the page to a route shape, never a customer's URL", () => {
    // `/inbox/<id>` and `/inbox/<other id>` are the same fact about the same
    // route, and only one of them is a person.
    const line = cspReportLine(
      legacy({
        "effective-directive": "script-src",
        "blocked-uri": "inline",
        "document-uri":
          "https://app.loonext.com/inbox/9f3c2e7a-1b4d-4c8e-8a2f-5d6e7f8a9b0c?q=roof%20leak",
      }),
    );

    expect(line).toContain("route=/inbox/:id");
    expect(line).not.toContain("9f3c2e7a");
    // The query is a customer's words. No violation was ever diagnosed from a
    // search term.
    expect(line).not.toContain("roof");
    expect(line).not.toContain("?");
  });

  it("drops the script sample outright", () => {
    // Up to 40 characters of whatever was about to execute — on an inline
    // handler that is the page's own content, and the directive plus the
    // blocked origin already say what to fix.
    const line = cspReportLine(
      legacy({
        "effective-directive": "script-src",
        "blocked-uri": "inline",
        "document-uri": "https://app.loonext.com/for-you",
        "script-sample": "alert('Maria Alvarez, 42 Elm')",
      }),
    );

    expect(line).not.toContain("Maria");
    expect(line).not.toContain("script-sample");
  });

  it("keeps the bare keywords, which are the useful ones", () => {
    // `inline`, `eval` and `data` are not URLs and are the most common — and
    // most informative — answers a browser gives.
    for (const blocked of ["inline", "eval", "data"]) {
      expect(cspReportLine(legacy({ "blocked-uri": blocked }))).toContain(
        `blocked=${blocked}`,
      );
    }
  });

  it("reads the Reporting API shape too, and every report in the batch", () => {
    // The modern envelope is an ARRAY and it batches. Taking [0] would drop the
    // rest silently — the shape of bug that makes a log look quiet.
    const line = cspReportLine(
      JSON.stringify([
        {
          type: "csp-violation",
          body: {
            effectiveDirective: "script-src",
            blockedURL: "https://evil.example/x.js",
            documentURL: "https://loonext.com/",
          },
        },
        {
          type: "csp-violation",
          body: {
            effectiveDirective: "worker-src",
            blockedURL: "https://app.loonext.com/sw.js",
            documentURL: "https://app.loonext.com/for-you",
          },
        },
      ]),
    );

    expect(line?.split("\n")).toHaveLength(2);
    expect(line).toContain("directive=worker-src");
  });

  it("says nothing at all for garbage", () => {
    // An open endpoint's steady state is crawlers and scanners. A log that
    // records every one of them is a log nobody reads on the day a real
    // violation arrives.
    expect(cspReportLine("not json")).toBeNull();
    expect(cspReportLine("{}")).toBeNull();
    expect(cspReportLine("[]")).toBeNull();
    expect(cspReportLine('{"csp-report":"a string"}')).toBeNull();
  });

  it("marks an enforced violation differently from a staged one", () => {
    // Once the flip happens, a report means something was actually blocked.
    // Reading the same line for both would hide the difference between
    // "we would have broken this" and "we did".
    const enforced = cspReportLine(
      legacy({ "blocked-uri": "inline", disposition: "enforce" }),
    );

    expect(enforced).toContain("csp-violation enforce");
  });
});
