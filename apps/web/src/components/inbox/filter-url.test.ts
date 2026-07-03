import { describe, expect, it } from "vitest";

import {
  activeChips,
  applySegment,
  clearSecondary,
  formatOpenCount,
  hasActiveFilters,
  parseInboxSearchParams,
  segmentOf,
  serializeInboxFilters,
  toConversationFilters,
} from "./filter-url";

describe("parseInboxSearchParams", () => {
  it("parses every supported param", () => {
    const params = new URLSearchParams(
      "status=waiting&assignee=me&tag=t-1&unread=true&spam=true&q=leak",
    );
    expect(parseInboxSearchParams(params)).toEqual({
      status: "waiting",
      assignee: "me",
      tag: "t-1",
      unread: true,
      spam: true,
      q: "leak",
    });
  });

  it("drops unknown/empty values instead of throwing", () => {
    const params = new URLSearchParams(
      "status=bogus&assignee=&unread=nope&spam=false&q=%20%20",
    );
    expect(parseInboxSearchParams(params)).toEqual({});
  });

  it("accepts both true and 1 for unread/spam", () => {
    expect(parseInboxSearchParams(new URLSearchParams("unread=1&spam=1"))).toEqual(
      { unread: true, spam: true },
    );
    expect(
      parseInboxSearchParams(new URLSearchParams("unread=true&spam=true")),
    ).toEqual({ unread: true, spam: true });
  });

  it("round-trips through serialize", () => {
    const filters = {
      status: "open" as const,
      tag: "abc",
      unread: true,
      q: "faucet",
    };
    const serialized = serializeInboxFilters(filters);
    expect(serialized).toBe("?status=open&tag=abc&unread=true&q=faucet");
    expect(
      parseInboxSearchParams(new URLSearchParams(serialized.slice(1))),
    ).toEqual(filters);
  });

  it("serializes the default view as an empty string", () => {
    expect(serializeInboxFilters({})).toBe("");
  });
});

describe("segments", () => {
  it("maps URL state onto the segmented control", () => {
    expect(segmentOf({})).toBe("all");
    expect(segmentOf({ status: "open" })).toBe("open");
    expect(segmentOf({ status: "closed" })).toBe("closed");
    expect(segmentOf({ assignee: "me" })).toBe("mine");
    // Sheet-picked statuses light no segment ("All" stays honest).
    expect(segmentOf({ status: "waiting" })).toBe("all");
  });

  it("applySegment owns status + the me-assignee but keeps sheet filters", () => {
    const base = { tag: "t-1", unread: true as const, q: "roof" };
    expect(applySegment({ ...base, status: "closed" }, "open")).toEqual({
      ...base,
      status: "open",
    });
    expect(applySegment({ ...base, status: "open" }, "mine")).toEqual({
      ...base,
      assignee: "me",
    });
    expect(applySegment({ ...base, assignee: "me" }, "all")).toEqual(base);
    // A specific member picked in the sheet is NOT cleared by segment taps.
    expect(applySegment({ assignee: "user-9" }, "closed")).toEqual({
      assignee: "user-9",
      status: "closed",
    });
  });
});

describe("toConversationFilters", () => {
  it("resolves 'me' to the caller and never forwards q", () => {
    expect(
      toConversationFilters(
        { status: "open", assignee: "me", tag: "t-1", unread: true, q: "x" },
        "user-1",
      ),
    ).toEqual({
      status: "open",
      assigned_user_id: "user-1",
      tag_id: "t-1",
      unread: true,
    });
  });

  it("passes explicit member ids and the spam chip through", () => {
    expect(toConversationFilters({ assignee: "user-7", spam: true }, "me-id")).toEqual({
      assigned_user_id: "user-7",
      is_spam: true,
    });
  });
});

describe("hasActiveFilters", () => {
  it("is false only for the bare All view", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: "  " })).toBe(false);
    expect(hasActiveFilters({ status: "open" })).toBe(true);
    expect(hasActiveFilters({ unread: true })).toBe(true);
    expect(hasActiveFilters({ q: "hi" })).toBe(true);
  });
});

describe("formatOpenCount", () => {
  it("hides zero and caps at 9+ (§2.1)", () => {
    expect(formatOpenCount(0)).toBe("");
    expect(formatOpenCount(-3)).toBe("");
    expect(formatOpenCount(1)).toBe("1");
    expect(formatOpenCount(9)).toBe("9");
    expect(formatOpenCount(10)).toBe("9+");
    expect(formatOpenCount(240)).toBe("9+");
  });
});

describe("activeChips", () => {
  it("lists only removable secondary filters, in a stable order", () => {
    expect(activeChips({})).toEqual([]);
    // The Mine segment owns the `me` assignee — it is never a chip.
    expect(activeChips({ assignee: "me" })).toEqual([]);
    // status is a segment, not a chip; q is search, not a chip.
    expect(activeChips({ status: "open", q: "leak" })).toEqual([]);
    expect(
      activeChips({
        assignee: "user-9",
        tag: "t-1",
        unread: true,
        spam: true,
      }),
    ).toEqual([
      { key: "assignee", value: "user-9" },
      { key: "tag", value: "t-1" },
      { key: "unread" },
      { key: "spam" },
    ]);
  });
});

describe("clearSecondary", () => {
  it("drops one dimension without touching the rest", () => {
    const base = { status: "open" as const, tag: "t-1", unread: true as const };
    expect(clearSecondary(base, "tag")).toEqual({
      status: "open",
      unread: true,
    });
    expect(clearSecondary(base, "unread")).toEqual({
      status: "open",
      tag: "t-1",
    });
    // Untouched dimensions are a no-op; the original is not mutated.
    expect(clearSecondary(base, "spam")).toEqual(base);
    expect(base.tag).toBe("t-1");
  });
});
