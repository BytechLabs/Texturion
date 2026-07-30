/**
 * #367 — what the caller said, rendered.
 *
 * The rules worth pinning are the two a redesign would break without anyone
 * noticing: a field the caller never gave leaves NO row behind, and the block
 * names where it came from. The first is a correctness claim (a blank "Address"
 * reads as "we looked and there was none"); the second is PORTAL-UX §3.1.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoicemailIntakeSummary } from "./voicemail-intake-summary";

const empty = { problem: null, address: null, callback: null, name: null };

describe("VoicemailIntakeSummary", () => {
  it("renders nothing at all when there is nothing to say", () => {
    expect(renderToStaticMarkup(<VoicemailIntakeSummary intake={null} />)).toBe("");
    expect(renderToStaticMarkup(<VoicemailIntakeSummary intake={empty} />)).toBe("");
  });

  it("draws only the fields the caller actually gave", () => {
    const html = renderToStaticMarkup(
      <VoicemailIntakeSummary
        intake={{ ...empty, problem: "water heater leaking", address: "12 Mill Road" }}
      />,
    );
    expect(html).toContain("water heater leaking");
    expect(html).toContain("12 Mill Road");
    // The two the caller did not give leave no trace — not a label, not a rule,
    // not a gap.
    expect(html).not.toContain("Call back");
    expect(html).not.toContain("Name");
  });

  it("names the signal it came from", () => {
    const html = renderToStaticMarkup(
      <VoicemailIntakeSummary intake={{ ...empty, problem: "no heat" }} />,
    );
    expect(html).toContain("From the voicemail");
  });

  it("keeps the order stable regardless of the object's", () => {
    const html = renderToStaticMarkup(
      <VoicemailIntakeSummary
        intake={{ name: "Dave", callback: "555-0142", address: "9 Oak St", problem: "no heat" }}
      />,
    );
    expect(html.indexOf("no heat")).toBeLessThan(html.indexOf("9 Oak St"));
    expect(html.indexOf("9 Oak St")).toBeLessThan(html.indexOf("555-0142"));
    expect(html.indexOf("555-0142")).toBeLessThan(html.indexOf("Dave"));
  });

  it("escapes what a stranger said", () => {
    // Every value here is words a member of the public spoke into a phone and a
    // model repeated back. It is rendered as text, and this asserts React is
    // actually being allowed to do that.
    const html = renderToStaticMarkup(
      <VoicemailIntakeSummary
        intake={{ ...empty, problem: "<img src=x onerror=alert(1)>" }}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
