import { describe, expect, it } from "vitest";

import { normalizeNanpPhone, normalizeWebsite } from "./normalize";
import { draftIsExpired, parseDraft } from "./local-draft";

describe("normalizeWebsite", () => {
  it("prepends https:// when the scheme is missing", () => {
    expect(normalizeWebsite("mikesplumbing.com")).toBe(
      "https://mikesplumbing.com",
    );
  });
  it("keeps explicit schemes and trims whitespace", () => {
    expect(normalizeWebsite("  http://mikes.ca ")).toBe("http://mikes.ca");
    expect(normalizeWebsite("https://mikes.ca")).toBe("https://mikes.ca");
  });
  it("leaves empty input empty (website is optional for sole props)", () => {
    expect(normalizeWebsite("   ")).toBe("");
  });
});

describe("normalizeNanpPhone", () => {
  it("normalizes human formats to E.164", () => {
    expect(normalizeNanpPhone("(416) 555-0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("416-555-0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("1 416 555 0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("+14165550182")).toBe("+14165550182");
  });
  it("rejects short numbers and non-US/CA destinations", () => {
    expect(normalizeNanpPhone("555-0182")).toBeNull();
    // 809 is Dominican Republic — in the NANP but not a US/CA destination.
    expect(normalizeNanpPhone("(809) 555-0100")).toBeNull();
    // 800 toll-free is not a geographic US/CA code either.
    expect(normalizeNanpPhone("800 555 0100")).toBeNull();
  });
});

describe("parseDraft", () => {
  it("parses a valid draft and drops junk fields", () => {
    expect(
      parseDraft(
        JSON.stringify({
          name: "Mike's",
          country: "CA",
          areaCode: "416",
          usTexting: false,
          extra: "ignored",
        }),
      ),
    ).toEqual({ name: "Mike's", country: "CA", areaCode: "416", usTexting: false });
  });
  it("drops malformed values instead of throwing", () => {
    expect(parseDraft("not json")).toEqual({});
    expect(parseDraft(JSON.stringify({ country: "MX", areaCode: "41" }))).toEqual(
      {},
    );
    expect(parseDraft(null)).toEqual({});
  });
  it("carries the #370 crew size, and only a real bucket", () => {
    expect(parseDraft(JSON.stringify({ crewSize: "4_10" }))).toEqual({
      crewSize: "4_10",
    });
    // A hand-edited or stale draft must not turn into a bucket the API's enum
    // does not have: that would 422 the company create, and refusing a signup
    // over a segmentation field is the one outcome this question is not worth.
    expect(parseDraft(JSON.stringify({ crewSize: "12" }))).toEqual({});
    expect(parseDraft(JSON.stringify({ crewSize: "SOLO" }))).toEqual({});
  });
});


describe("draftIsExpired (#381: identity data does not live in localStorage forever)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 6, 28);

  it("keeps a draft somebody is still working through", () => {
    // The clock runs from last activity, so an active signup is never expired
    // out from under itself.
    expect(draftIsExpired(JSON.stringify({ savedAt: now - DAY }), now)).toBe(false);
    expect(draftIsExpired(JSON.stringify({ savedAt: now - 6 * DAY }), now)).toBe(false);
  });

  it("expires one abandoned for over a week", () => {
    // The port sub-wizard collects the last 4 of an SSN/SIN, an account number
    // and a PIN. A signup abandoned in March should not leave those on a shared
    // office machine in December.
    expect(draftIsExpired(JSON.stringify({ savedAt: now - 8 * DAY }), now)).toBe(true);
  });

  it("treats a draft with NO timestamp as expired", () => {
    // Those are the ones written before this shipped — the data that has been
    // sitting around longest. Reading them as fresh would exempt exactly the
    // rows the rule was written for.
    expect(draftIsExpired(JSON.stringify({ name: "Mike's Plumbing" }), now)).toBe(true);
  });

  it("does not choke on unparseable storage", () => {
    // parseDraft already returns {} for this, so there is nothing to expire and
    // throwing here would break the wizard for anyone with a corrupt key.
    expect(draftIsExpired("not json at all", now)).toBe(false);
  });
});
