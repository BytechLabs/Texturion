import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StatusPage, { metadata } from "./page";

/**
 * /status guards (DESIGN-DIRECTION v4 §6 STATUS + owner amendment 11): until
 * the page is wired to a real monitoring provider it renders NO operational
 * indicators, plainly states where status is published, and keeps the
 * factual not-an-outage explanations. QA gate 6 lives here as a test.
 */

const html = renderToStaticMarkup(<StatusPage />);

describe("/status — the instrument page, unwired posture (amendment 11)", () => {
  it("H1 is Status. and the page plainly states where status is published", () => {
    expect(html).toContain("Status.");
    expect(html).toContain("published on this page");
    expect(html).toContain("texting, the inbox, and notifications");
  });

  it("QA gate 6: no operational indicators while unwired, in any form", () => {
    // No green or Flare dots, no state labels, no fabricated liveness.
    expect(html).not.toContain("var(--fr-green)");
    expect(html).not.toContain("var(--fr-flare)");
    expect(html).not.toMatch(/OPERATIONAL|ALL SYSTEMS|ACTIVE INCIDENT/);
    expect(html).not.toMatch(/live status/i);
  });

  it("carries incident reports that tell the truth: none posted", () => {
    expect(html).toContain("Incident reports");
    expect(html).toContain("No incidents posted.");
  });

  it("timestamps and figures read in mono (fr-eyebrow / fr-mono-data)", () => {
    expect(html).toContain("fr-eyebrow");
    expect(html).toContain("fr-mono-data");
    expect(html).toMatch(/<time[^>]*datetime="20\d\d-\d\d-\d\d"/i);
  });

  it("keeps the not-an-outage facts: the approval wait and carrier dependence", () => {
    expect(html).toContain("3 to 7");
    expect(html).toContain("carrier");
    expect(html).toContain("support@loonext.com");
  });

  it("no invented uptime figures, no roadmap narration, no artifact talk", () => {
    expect(html).not.toMatch(/99\.\d|uptime|being stood up|monitoring provider|fabricated|fake/i);
    expect(html).not.toMatch(/real interface|stock photo|built with next/i);
  });

  it("no em-dash or en-dash on the page or in metadata (Law 6)", () => {
    expect(html).not.toMatch(/—|–/);
    expect(String(metadata.description)).not.toMatch(/—|–/);
    expect(String(metadata.description)).not.toMatch(/green|operational/i);
  });
});

describe("/status — #242: the page says what it is, and does not imply a probe", () => {
  it("dates the last POST, not a last check", () => {
    // "UPDATED <date>" was ambiguous in the one direction that matters: a reader
    // takes it as the last time somebody CHECKED the service, so an 18-day-old
    // date read as 18 days of confirmed health when it meant nobody had touched
    // the page.
    expect(html).toContain("LAST POSTED");
    expect(html).not.toContain("UPDATED ");
  });

  it("says a person writes it, so silence is not read as health", () => {
    // Without this, no incident report reads as an assertion that nothing is
    // wrong — which is the failure mode that makes a stale status page worse
    // than no status page.
    expect(html).toContain("written by a person");
    expect(html).toContain("not by an automatic monitor");
  });

  it("points at a channel that does not share the deploy failure domain", () => {
    // Posting here needs CI and a deploy, so it cannot report an outage caused
    // by CI or the deploy. Email can.
    expect(html).toContain("mailto:");
    expect(html).toContain("whether or not this page has caught up");
  });
});
