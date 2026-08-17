import { describe, expect, it } from "vitest";

import { buildIcs, icsDate, icsEscape, icsFold } from "./ics";

/**
 * #245 — the three rules that actually break a calendar subscription.
 *
 * None of these produces an error anybody sees. A feed that gets them wrong
 * shows nothing, or shows half the week, in software we do not control and
 * cannot instrument. So they are asserted here rather than discovered by a
 * crew whose Tuesday went missing.
 */

describe("escaping (§3.3.11)", () => {
  it("escapes the characters that are structural in this format", () => {
    // A comma is a value separator. Without this, "Replace heater, check
    // pressure" becomes two values and the calendar shows a truncated title
    // with no hint that anything was cut.
    expect(icsEscape("Replace heater, check pressure")).toBe(
      "Replace heater\\, check pressure",
    );
    expect(icsEscape("Unit 4; rear door")).toBe("Unit 4\\; rear door");
  });

  it("escapes the backslash FIRST, or it escapes its own escapes", () => {
    // The ordering bug: escape the comma first and the backslash pass turns
    // `\,` into `\\,`, which renders as a literal backslash before the comma.
    expect(icsEscape("a\\b,c")).toBe("a\\\\b\\,c");
  });

  it("folds a newline into the literal the format wants", () => {
    // A raw newline ends the property. Every parser then reads the rest of the
    // description as a malformed property name and usually drops the event.
    expect(icsEscape("line one\nline two")).toBe("line one\\nline two");
    expect(icsEscape("crlf\r\nhere")).toBe("crlf\\nhere");
  });
});

describe("line folding (§3.1)", () => {
  it("leaves a short line alone", () => {
    expect(icsFold("SUMMARY:Fix the sink")).toBe("SUMMARY:Fix the sink");
  });

  it("folds a long line with a leading space on the continuation", () => {
    const folded = icsFold(`SUMMARY:${"x".repeat(200)}`);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("measures OCTETS, not characters, and never splits a character", () => {
    // THE ONE THAT BITES IN THIS PRODUCT. A job in Montréal or a customer
    // named Müller is multi-byte, so a fold counted in characters runs past 75
    // octets — and a fold that lands mid-codepoint produces bytes no parser
    // can decode.
    const folded = icsFold(`LOCATION:${"é".repeat(80)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Reassembled — strip the CRLF and the one continuation space — it is the
    // same string it started as. A split character would not survive this.
    expect(folded.split("\r\n ").join("")).toBe(`LOCATION:${"é".repeat(80)}`);
  });
});

describe("timestamps", () => {
  it("writes UTC basic format with no punctuation", () => {
    expect(icsDate(new Date("2026-08-17T09:05:00.000Z"))).toBe("20260817T090500Z");
  });

  it("pads every field", () => {
    expect(icsDate(new Date("2026-01-02T03:04:05.000Z"))).toBe("20260102T030405Z");
  });
});

describe("the document", () => {
  const event = {
    uid: "task-1@loonext",
    start: new Date("2026-08-18T14:00:00.000Z"),
    end: new Date("2026-08-18T15:00:00.000Z"),
    stamp: new Date("2026-08-17T09:00:00.000Z"),
    summary: "Replace the water heater",
  };

  it("ends every line with CRLF, including the last", () => {
    // A bare \n is the commonest defect in a hand-rolled feed, and the clients
    // that reject it do so silently.
    const ics = buildIcs({ name: "My schedule", events: [event] });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(
      true,
    );
  });

  it("carries a name, because the alternative is called Untitled", () => {
    const ics = buildIcs({ name: "My schedule", events: [event] });
    expect(ics).toContain("X-WR-CALNAME:My schedule");
  });

  it("publishes rather than requests", () => {
    // REQUEST asks the recipient to RSVP to work they are already assigned.
    const ics = buildIcs({ name: "My schedule", events: [event] });
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("is still a valid empty calendar with nothing scheduled", () => {
    // The common case for a new member, and a document that omitted the
    // wrapper here would make their first subscription look broken.
    const ics = buildIcs({ name: "My schedule", events: [] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("omits optional properties rather than emitting them empty", () => {
    // `LOCATION:` with nothing after it is not the same as no location: some
    // clients render an empty line in the event detail, which reads as a bug.
    const ics = buildIcs({ name: "My schedule", events: [event] });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });
});
