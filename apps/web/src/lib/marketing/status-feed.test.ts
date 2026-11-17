import { describe, expect, it } from "vitest";

import {
  CONFIRMED_STALE_DAYS,
  confirmedIsStale,
  EMPTY_STATUS_FEED,
  formatConfirmedDisplay,
  MAX_INCIDENT_CHARS,
  parseConfirmedIso,
  parseIncidentText,
  readStatusFeed,
} from "./status-feed";

/**
 * #242 — the live incident feed.
 *
 * Every test here is really the same test asked six ways: WHICH WAY DOES IT FAIL?
 * A status page has exactly one unacceptable failure direction, and it is not
 * crashing or rendering blank — it is quietly implying that everything is fine.
 * The absence of an incident report reads as an assertion that nothing is wrong,
 * so a bad KV value, an unreachable KV, or a missing binding must never resolve
 * to something reassuring.
 */

const NOW = new Date("2026-07-29T12:00:00Z");

describe("parseIncidentText — a sentence typed under stress", () => {
  it("keeps an ordinary sentence intact", () => {
    expect(parseIncidentText("Texts are not sending right now.")).toBe(
      "Texts are not sending right now.",
    );
  });

  it("treats absent, empty and whitespace-only as no incident", () => {
    // Not an empty banner: a rendered banner with nothing in it looks like a
    // rendering bug and undermines the page exactly when it matters.
    for (const value of [null, undefined, "", "   ", "\n\n", "\t"]) {
      expect(parseIncidentText(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("collapses the newlines a phone keyboard adds", () => {
    expect(parseIncidentText("Texts are down.\n\nWe are on it.")).toBe(
      "Texts are down. We are on it.",
    );
  });

  it("neutralizes control and bidi characters rather than rendering them", () => {
    // A value that can reshape the text around it is a value that can make the
    // page say something nobody typed.
    const withOverride = "Texts are down‮elbaliava si gnihtyrevE";
    const parsed = parseIncidentText(withOverride);
    expect(parsed).not.toContain("‮");
    expect(parsed).toBe("Texts are down elbaliava si gnihtyrevE");
    expect(parseIncidentText("a\u0000b")).toBe("a b");
  });

  it("truncates past the cap with an ellipsis, and keeps a value at the cap", () => {
    const exact = "x".repeat(MAX_INCIDENT_CHARS);
    expect(parseIncidentText(exact)).toBe(exact);
    const over = parseIncidentText("y".repeat(MAX_INCIDENT_CHARS + 50));
    expect(over).toHaveLength(MAX_INCIDENT_CHARS + 1); // + the ellipsis
    expect(over?.endsWith("…")).toBe(true);
  });

  it("ignores a non-string value entirely", () => {
    expect(parseIncidentText(42 as unknown as string)).toBeNull();
  });
});

describe("parseConfirmedIso — strict, because a wrong date is worse than none", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(parseConfirmedIso("2026-07-29")).toBe("2026-07-29");
    expect(parseConfirmedIso("  2026-07-29  ")).toBe("2026-07-29");
  });

  it("rejects every shape Date would have accepted anyway", () => {
    // `new Date("July 29")` yields a real timestamp in the current year, and a
    // status page that renders a confidently wrong date has done real damage.
    for (const value of [
      "July 29, 2026",
      "2026-7-9",
      "29-07-2026",
      "2026-07-29T00:00:00Z",
      "yesterday",
      "",
      null,
      undefined,
    ]) {
      expect(parseConfirmedIso(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("rejects a real-shaped impossible date", () => {
    // "2026-02-31" matches the pattern and Date rolls it forward to March 3 —
    // the round-trip check is what catches it.
    expect(parseConfirmedIso("2026-02-31")).toBeNull();
    expect(parseConfirmedIso("2026-13-01")).toBeNull();
  });
});

describe("confirmedIsStale — the failure direction, stated as a rule", () => {
  it("is fresh inside the window", () => {
    expect(confirmedIsStale("2026-07-29", NOW)).toBe(false);
    expect(confirmedIsStale("2026-07-23", NOW)).toBe(false); // 6 days
  });

  it("is stale past the window", () => {
    // #242's actual complaint: an 18-day-old date offered as if it answered
    // "is anything wrong right now".
    expect(confirmedIsStale("2026-07-11", NOW)).toBe(true);
    expect(confirmedIsStale("2026-07-07", NOW)).toBe(true);
  });

  it("is stale when there is no date at all", () => {
    expect(confirmedIsStale(null, NOW)).toBe(true);
  });

  it("treats a FUTURE date as stale, not as maximum freshness", () => {
    // A typo'd year would otherwise be the most reassuring possible value, which
    // is the one direction this must never fail in.
    expect(confirmedIsStale("2027-01-01", NOW)).toBe(true);
  });

  it("puts the boundary exactly at the documented window", () => {
    // Confirmed dates are midnight-anchored, so the arithmetic is only exact
    // against a midnight `now`. The check is strictly greater-than: a date
    // CONFIRMED_STALE_DAYS old is the oldest one that still counts as fresh.
    const midnight = new Date("2026-07-29T00:00:00Z");
    const atBoundary = new Date(
      midnight.getTime() - CONFIRMED_STALE_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const oneDayPast = new Date(
      midnight.getTime() - (CONFIRMED_STALE_DAYS + 1) * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    expect(confirmedIsStale(atBoundary, midnight)).toBe(false);
    expect(confirmedIsStale(oneDayPast, midnight)).toBe(true);
  });
});

describe("readStatusFeed — every failure resolves to claiming nothing", () => {
  const store = (values: Record<string, string | null>) => ({
    get: async (key: string) => values[key] ?? null,
  });

  it("reads a live incident and a confirmed date", async () => {
    const feed = await readStatusFeed(
      store({ incident: "Texts are delayed.", confirmed: "2026-07-29" }),
      NOW,
    );
    expect(feed).toEqual({
      incident: "Texts are delayed.",
      incidentFr: null,
      confirmedIso: "2026-07-29",
      confirmedIsStale: false,
    });
  });

  it("reads the separately authored French incident without translating", async () => {
    const feed = await readStatusFeed(
      store({
        incident: "Texts are delayed.",
        "incident:fr-CA": "Les textos sont retardés.",
        confirmed: "2026-07-29",
      }),
      NOW,
    );

    expect(feed.incident).toBe("Texts are delayed.");
    expect(feed.incidentFr).toBe("Les textos sont retardés.");
  });

  it("returns the claim-nothing feed when no store is bound", async () => {
    // Local dev, a preview build, or the binding not yet added: the page must
    // render exactly as it did before this existed.
    await expect(readStatusFeed(null, NOW)).resolves.toEqual(EMPTY_STATUS_FEED);
    await expect(readStatusFeed(undefined, NOW)).resolves.toEqual(EMPTY_STATUS_FEED);
  });

  it("survives a KV read that throws", async () => {
    // KV being unreachable during a product outage is precisely when the page
    // still has to render its compiled-in content.
    const feed = await readStatusFeed(
      {
        get: async () => {
          throw new Error("kv unreachable");
        },
      },
      NOW,
    );
    expect(feed).toEqual(EMPTY_STATUS_FEED);
  });

  it("a garbled confirmed date reads as not-confirmed, never as confirmed", async () => {
    const feed = await readStatusFeed(
      store({ incident: null, confirmed: "last tuesday" }),
      NOW,
    );
    expect(feed.confirmedIso).toBeNull();
    expect(feed.confirmedIsStale).toBe(true);
  });

  it("a live incident still shows when the confirmed date is unusable", async () => {
    // The two keys are independent on purpose. Losing the date must not suppress
    // the sentence — the sentence is the urgent half.
    const feed = await readStatusFeed(
      store({ incident: "Calls are failing.", confirmed: "" }),
      NOW,
    );
    expect(feed.incident).toBe("Calls are failing.");
    expect(feed.confirmedIsStale).toBe(true);
  });

  it("EMPTY_STATUS_FEED is itself stale", () => {
    // The invariant every failure path depends on.
    expect(EMPTY_STATUS_FEED.confirmedIsStale).toBe(true);
    expect(EMPTY_STATUS_FEED.incident).toBeNull();
    expect(EMPTY_STATUS_FEED.incidentFr).toBeNull();
  });
});

describe(formatConfirmedDisplay, () => {
  it("matches the page's eyebrow voice, pinned to UTC", () => {
    expect(formatConfirmedDisplay("2026-07-07")).toBe("JULY 7, 2026");
    // Not dependent on where the worker ran: a date near midnight must not
    // render as the previous day in one region and the next in another.
    expect(formatConfirmedDisplay("2026-01-01")).toBe("JANUARY 1, 2026");
  });
});
