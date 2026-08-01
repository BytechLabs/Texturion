import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EMPTY_STATUS_FEED, type StatusFeed } from "@/lib/marketing/status-feed";

import { StatusContent } from "@/components/marketing/status-content";

import { metadata } from "./page";

/**
 * /status guards (DESIGN-DIRECTION v4 §6 STATUS + owner amendment 11): until
 * the page is wired to a real monitoring provider it renders NO operational
 * indicators, plainly states where status is published, and keeps the
 * factual not-an-outage explanations. QA gate 6 lives here as a test.
 */

/**
 * #242: the page is now a function of the live feed, so the gates are asserted
 * against each state it can be in. `html` stays the DEFAULT state — no live
 * incident, nothing confirmed — because that is what a customer sees on an
 * ordinary day AND what every failure path (no binding, KV unreachable, garbled
 * value) degrades to, so it is the state that has to be right twice over.
 */
const render = (feed: StatusFeed = EMPTY_STATUS_FEED) =>
  renderToStaticMarkup(<StatusContent feed={feed} />);

const html = render();

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

describe("/status — #242: the live feed, and which way it fails", () => {
  const live: StatusFeed = {
    incident: "Texts are not sending right now. Incoming texts still arrive.",
    confirmedIso: "2026-07-29",
    confirmedIsStale: false,
  };

  it("shows the live line above the historical card when one is posted", () => {
    const out = render(live);
    expect(out).toContain("Happening now");
    expect(out).toContain("Texts are not sending right now.");
    // Ordering is the requirement, not decoration: during an incident the live
    // line is the only thing anybody opened the page for.
    expect(out.indexOf("Happening now")).toBeLessThan(
      out.indexOf("Incident reports"),
    );
  });

  it("shows no live line at all when there is nothing live", () => {
    // Never an empty banner — that reads as a broken page precisely when trust
    // matters most.
    expect(html).not.toContain("Happening now");
  });

  it("STILL renders no operational indicator with a live incident", () => {
    // The gate that a live data source is most likely to erode: now that the
    // page has real input, colour-coding it would be the obvious next step, and
    // no probe backs it. QA gate 6 applies to every feed state.
    const out = render(live);
    expect(out).not.toContain("var(--fr-green)");
    expect(out).not.toContain("var(--fr-flare)");
    expect(out).not.toMatch(/OPERATIONAL|ALL SYSTEMS|ACTIVE INCIDENT/);
    expect(out).not.toMatch(/live status/i);
  });

  it("states when a person last CONFIRMED the service, when that is recent", () => {
    // #242 acceptance: last confirmed is a different fact from last posted, and
    // the page owes the reader the first one.
    const out = render(live);
    expect(out).toContain("A person last checked");
    expect(out).toContain("JULY 29, 2026");
    expect(out).toMatch(/<time[^>]*datetime="2026-07-29"/i);
  });

  it("says nobody has checked, rather than showing a stale date as comfort", () => {
    // The default and every failure path land here. This is the sentence that
    // replaces "Last updated 18 days ago" — the complaint that opened #242.
    expect(html).toContain("Nobody has checked recently enough");
    expect(html).not.toContain("A person last checked");
  });

  it("suppresses the confirmed date the moment it goes stale", () => {
    // A real date that is too old must not be rendered as though it answered
    // "is anything wrong right now".
    const out = render({
      incident: null,
      confirmedIso: "2026-07-01",
      confirmedIsStale: true,
    });
    expect(out).not.toContain("JULY 1, 2026");
    expect(out).toContain("Nobody has checked recently enough");
  });

  it("keeps Law 6 (no em/en dash) in every feed state", () => {
    for (const out of [html, render(live)]) {
      expect(out).not.toMatch(/—|–/);
    }
  });

  it("escapes a live value rather than letting it become markup", () => {
    // The value is typed into a dashboard by hand and read straight onto a public
    // page. React escapes it; this asserts nobody later reaches for
    // dangerouslySetInnerHTML to get formatting.
    const out = render({
      ...live,
      incident: '<script>alert(1)</script> and <b>bold</b>',
    });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>bold</b>");
    expect(out).toContain("&lt;script&gt;");
  });
});

/**
 * #477 — the subscribe card, and the rule that decides whether it exists.
 *
 * A form that accepts an address the worker can never mail is the same lie as a
 * green dot with no probe behind it, so the card is gated on the worker
 * actually being able to send. That gate defaults to off, which means every
 * environment that has not been configured — local dev, a preview build,
 * production before the secrets are set — shows no form rather than a broken
 * one.
 */
describe("/status — #477: subscribe renders only when it is backed", () => {
  const withCard = renderToStaticMarkup(
    <StatusContent feed={EMPTY_STATUS_FEED} canSubscribe />,
  );

  it("shows nothing about email by default", () => {
    expect(html).not.toContain("Get told instead of checking");
    expect(html).not.toContain("status-subscribe-email");
  });

  it("offers one field and one action when the worker can send", () => {
    expect(withCard).toContain("Get told instead of checking");
    expect(withCard).toContain('id="status-subscribe-email"');
    expect(withCard).toContain("Email me");
  });

  it("promises only incidents, and says unsubscribe is one click", () => {
    // The copy is the contract. Anything vaguer here is how a status list turns
    // into a marketing list.
    expect(withCard).toContain("no newsletter");
    expect(withCard).toMatch(/one-click\s+unsubscribe/);
  });

  it("still renders no operational indicator with the card up", () => {
    expect(withCard).not.toContain("var(--fr-green)");
    expect(withCard).not.toContain("var(--fr-flare)");
    expect(withCard).not.toMatch(/OPERATIONAL|ALL SYSTEMS/);
  });

  it("keeps Law 6 (no em/en dash) in the card", () => {
    expect(withCard).not.toMatch(/—|–/);
  });
});
