import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { INBOX_FILTER_DIMENSIONS } from "@loonext/shared";

import {
  activeChips,
  applySegment,
  clearAllFilters,
  clearSecondary,
  formatOpenCount,
  hasActiveFilters,
  INBOX_SEARCH_MIN_CHARS,
  isSearchingInbox,
  nextSegmentIndex,
  parseInboxSearchParams,
  segmentOf,
  serializeInboxFilters,
  STATUS_CHIP_LABELS,
  toConversationFilters,
  toInboxFilterState,
  unrepresentedStatus,
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

describe("#293 snoozed chip", () => {
  it("round-trips through the URL like every other hidden population", () => {
    expect(
      parseInboxSearchParams(new URLSearchParams("snoozed=true")),
    ).toEqual({ snoozed: true });
    expect(parseInboxSearchParams(new URLSearchParams("snoozed=1"))).toEqual({
      snoozed: true,
    });
    expect(parseInboxSearchParams(new URLSearchParams("snoozed=false"))).toEqual(
      {},
    );
    expect(serializeInboxFilters({ snoozed: true })).toBe("?snoozed=true");
  });

  it("asks for the deferred ones INSTEAD of the ordinary list", () => {
    // Not a widening: "what did I defer" is a view. If this ever became
    // `snoozed: "all"` the chip would silently stop being a view and start
    // being a no-op that shows everything.
    expect(toConversationFilters({ snoozed: true }, "me-id")).toEqual({
      snoozed: "only",
    });
    // …and absent means absent, so the server's hide-them default applies.
    expect(toConversationFilters({}, "me-id")).toEqual({});
  });

  it("is a removable chip and counts as an active filter", () => {
    expect(activeChips({ snoozed: true })).toEqual([{ key: "snoozed" }]);
    expect(clearSecondary({ snoozed: true, unread: true }, "snoozed")).toEqual({
      unread: true,
    });
    // Otherwise the empty Snoozed view would render the brand-new-company
    // activation screen instead of "Nothing snoozed."
    expect(hasActiveFilters({ snoozed: true })).toBe(true);
  });
});

describe("#508 unanswered chip", () => {
  it("round-trips through the URL, because it is a DESTINATION", () => {
    // The response-time card links here. A filter that only existed as a chip
    // somebody tapped could not be linked to at all, and a pasted URL is the
    // same journey a week later.
    expect(
      parseInboxSearchParams(new URLSearchParams("awaiting=true")),
    ).toEqual({ awaiting: true });
    expect(parseInboxSearchParams(new URLSearchParams("awaiting=1"))).toEqual({
      awaiting: true,
    });
    expect(
      parseInboxSearchParams(new URLSearchParams("awaiting=false")),
    ).toEqual({});
    expect(serializeInboxFilters({ awaiting: true })).toBe("?awaiting=true");
  });

  it("asks the server the narrower question, and only when asked", () => {
    expect(toConversationFilters({ awaiting: true }, "me-id")).toEqual({
      awaiting: "only",
    });
    // Absent means NO filter here, unlike `snoozed` — the ordinary inbox shows
    // answered and unanswered alike.
    expect(toConversationFilters({}, "me-id")).toEqual({});
  });

  it("is a removable chip and counts as an active filter", () => {
    expect(activeChips({ awaiting: true })).toEqual([{ key: "awaiting" }]);
    expect(
      clearSecondary({ awaiting: true, unread: true }, "awaiting"),
    ).toEqual({ unread: true });
    // Otherwise an inbox where everybody has been answered would render the
    // brand-new-company activation screen.
    expect(hasActiveFilters({ awaiting: true })).toBe(true);
  });

  it("survives a segment switch, so the destination is not one-shot", () => {
    // Segments own `status` + the "me" assignee and nothing else. Arriving on
    // Unanswered and then tapping Open must narrow, not clear.
    expect(applySegment({ awaiting: true }, "open")).toEqual({
      awaiting: true,
      status: "open",
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

describe("nextSegmentIndex (#11 tablist keyboard)", () => {
  const COUNT = 4; // open · mine · all · closed

  it("moves forward with ArrowRight/ArrowDown and wraps at the end", () => {
    expect(nextSegmentIndex("ArrowRight", 0, COUNT)).toBe(1);
    expect(nextSegmentIndex("ArrowDown", 1, COUNT)).toBe(2);
    expect(nextSegmentIndex("ArrowRight", 3, COUNT)).toBe(0);
  });

  it("moves back with ArrowLeft/ArrowUp and wraps at the start", () => {
    expect(nextSegmentIndex("ArrowLeft", 2, COUNT)).toBe(1);
    expect(nextSegmentIndex("ArrowUp", 1, COUNT)).toBe(0);
    expect(nextSegmentIndex("ArrowLeft", 0, COUNT)).toBe(3);
  });

  it("jumps to the ends with Home/End", () => {
    expect(nextSegmentIndex("Home", 2, COUNT)).toBe(0);
    expect(nextSegmentIndex("End", 1, COUNT)).toBe(COUNT - 1);
  });

  it("returns the same index for any other key (a no-op the caller ignores)", () => {
    expect(nextSegmentIndex("Enter", 2, COUNT)).toBe(2);
    expect(nextSegmentIndex("a", 0, COUNT)).toBe(0);
    expect(nextSegmentIndex("Tab", 3, COUNT)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// #548 — a status no segment can show, and the way back out
// ---------------------------------------------------------------------------

describe("unrepresentedStatus", () => {
  it("is null for the statuses the segments own", () => {
    expect(unrepresentedStatus({})).toBeNull();
    expect(unrepresentedStatus({ status: "open" })).toBeNull();
    expect(unrepresentedStatus({ status: "closed" })).toBeNull();
  });

  it("names a status the segmented control cannot show", () => {
    // Both are storable in a saved view (packages/shared/src/saved-views.ts),
    // and `segmentOf` answers "all" for each — so the All tab lit up over a
    // list narrowed to one status, with nothing to press to undo it.
    expect(unrepresentedStatus({ status: "waiting" })).toBe("waiting");
    expect(unrepresentedStatus({ status: "new" })).toBe("new");
  });

  it("catches a status the Mine segment swallows", () => {
    // ?status=open&assignee=me lights Mine, which owns no status at all.
    expect(unrepresentedStatus({ status: "open", assignee: "me" })).toBe("open");
  });

  it("has a label for every status it can return", () => {
    // The chip renders STATUS_CHIP_LABELS[value]; a status with no entry there
    // would read "Status: undefined" on screen.
    for (const status of ["new", "open", "waiting", "closed"] as const) {
      expect(STATUS_CHIP_LABELS[status]).toBeTruthy();
    }
  });
});

describe("activeChips with an unrepresented status", () => {
  it("puts the orphan status first and clears it like any chip", () => {
    const filters = { status: "waiting", tag: "t-1" } as const;
    expect(activeChips(filters)).toEqual([
      { key: "status", value: "waiting" },
      { key: "tag", value: "t-1" },
    ]);
    expect(clearSecondary(filters, "status")).toEqual({ tag: "t-1" });
  });

  it("adds no chip for a status a tab already shows", () => {
    expect(activeChips({ status: "closed" })).toEqual([]);
  });
});

describe("isSearchingInbox", () => {
  it("takes the pane over only at the documented length", () => {
    expect(isSearchingInbox({})).toBe(false);
    expect(isSearchingInbox({ q: " " })).toBe(false);
    expect(isSearchingInbox({ q: "a" })).toBe(false);
    expect(isSearchingInbox({ q: " a " })).toBe(false);
    expect(isSearchingInbox({ q: "ab" })).toBe(true);
  });

  it("agrees with the constant the docs quote", () => {
    expect(INBOX_SEARCH_MIN_CHARS).toBe(2);
    expect(isSearchingInbox({ q: "x".repeat(INBOX_SEARCH_MIN_CHARS) })).toBe(
      true,
    );
  });

  it("counts a too-short query as a filter even so", () => {
    // One character does not swap the pane, so the list stays — and its empty
    // state has to say the query is why.
    expect(isSearchingInbox({ q: "a" })).toBe(false);
    expect(hasActiveFilters({ q: "a" })).toBe(true);
  });
});

describe("clearAllFilters", () => {
  it("drops the status, every chip and the query", () => {
    const everything = {
      status: "waiting",
      assignee: "u-2",
      tag: "t-1",
      unread: true,
      spam: true,
      snoozed: true,
      awaiting: true,
      q: "roof",
    } as const;
    expect(hasActiveFilters(everything)).toBe(true);
    expect(clearAllFilters()).toEqual({});
    expect(hasActiveFilters(clearAllFilters())).toBe(false);
    expect(serializeInboxFilters(clearAllFilters())).toBe("");
  });
});

describe("toInboxFilterState", () => {
  it("hands Mine to the segment and drops the named assignee", () => {
    // The request does the same (`assigned_user_id` becomes the viewer), and
    // the chip strip hides the assignee while Mine is lit.
    expect(toInboxFilterState({ assignee: "me", status: "open" })).toEqual({
      segment: "open",
      assignedToMe: true,
      assigneeUserId: null,
      tagId: null,
      unreadOnly: false,
      spamOnly: false,
      snoozedOnly: false,
      awaitingOnly: false,
    });
  });

  it("passes a named assignee through", () => {
    const state = toInboxFilterState({ assignee: "u-9", tag: "t-1" });
    expect(state.assignedToMe).toBe(false);
    expect(state.assigneeUserId).toBe("u-9");
    expect(state.tagId).toBe("t-1");
    expect(state.segment).toBeNull();
  });

  it("is empty for a bare URL, so nothing reads as filtered", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(toInboxFilterState({}).segment).toBeNull();
  });
});

describe("the shared rule this file now defers to", () => {
  /**
   * Web reads `isInboxFiltered` rather than keeping a fourth copy of the rule.
   * That only helps if this file feeds it every dimension it knows about — a
   * `toInboxFilterState` that forgot one would make web wrong again, quietly,
   * and every test above would still pass.
   *
   * So: the shared module's own list of dimensions, against the dimensions this
   * URL can actually turn on.
   */
  it("can turn on every dimension the shared module has", () => {
    const perDimension: Record<string, Parameters<typeof hasActiveFilters>[0]> =
      {
        segment: { status: "closed" },
        assignee: { assignee: "u-2" },
        tag: { tag: "t-1" },
        unread: { unread: true },
        spam: { spam: true },
        snoozed: { snoozed: true },
        awaiting: { awaiting: true },
      };
    expect(Object.keys(perDimension).sort()).toEqual(
      [...INBOX_FILTER_DIMENSIONS].sort(),
    );
    for (const [dimension, filters] of Object.entries(perDimension)) {
      expect(hasActiveFilters(filters), dimension).toBe(true);
    }
  });

  it("is the same source the two phones were ported from", () => {
    // Cheap, but it is the thing that broke: three hand-written copies, two of
    // them missing the status segment. If this module moves, the Kotlin and
    // Swift parity tests go looking for it too.
    const shared = readFileSync(
      join(__dirname, "../../../../../packages/shared/src/inbox-filters.ts"),
      "utf8",
    );
    expect(shared).toContain("export function isInboxFiltered");
    expect(shared).toContain("INBOX_FILTER_DIMENSIONS");
  });
});
