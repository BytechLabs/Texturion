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
    expect(html).toContain("No incidents to report.");
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
