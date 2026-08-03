/**
 * #280 — the contract four things depend on: the route that stores a view, the
 * route that replays it, and three clients that build one.
 *
 * The failure worth designing against is not a crash. It is a view that saves
 * cleanly and then opens something else, because the whole promise of the
 * feature is that what you saved is what you get back.
 */
import { describe, expect, it } from "vitest";

import {
  SAVED_VIEW_COUNT_CEILING,
  SAVED_VIEW_SURFACES,
  filtersToQuery,
  formatViewCount,
  isEmptyView,
  isSavedViewSurface,
  isValidViewName,
  resolveAssignee,
  sanitizeFilters,
  savedViewFilterKeys,
  viewNamesCollide,
} from "./saved-views";

const ID = "11111111-2222-4333-8444-555555555555";

describe("#280 sanitizeFilters", () => {
  it("keeps the filters a surface understands", () => {
    expect(
      sanitizeFilters("conversations", {
        status: "open",
        assigned_user_id: ID,
        unread: true,
      }),
    ).toEqual({ status: "open", assigned_user_id: ID, unread: true });
  });

  it("DROPS an unknown key rather than failing the read", () => {
    // A row written before a filter was renamed must still open. A view that
    // 422s is dead on a screen the person cannot fix; a view missing one
    // filter still shows them their work.
    expect(
      sanitizeFilters("conversations", { status: "open", colour: "red" }),
    ).toEqual({ status: "open" });
  });

  it("drops a known key holding a value the endpoint would reject", () => {
    expect(sanitizeFilters("conversations", { status: "archived" })).toEqual({});
    expect(sanitizeFilters("conversations", { assigned_user_id: "me" })).toEqual(
      {},
    );
    expect(sanitizeFilters("conversations", { unread: "true" })).toEqual({});
  });

  it("#508: holds the unanswered filter, with no 'all'", () => {
    // Unset already means no filter here, unlike `snoozed`, whose default hides
    // a population — so an 'all' would be a third way of saying "unset".
    expect(sanitizeFilters("conversations", { awaiting: "only" })).toEqual({
      awaiting: "only",
    });
    expect(sanitizeFilters("conversations", { awaiting: "exclude" })).toEqual({
      awaiting: "exclude",
    });
    expect(sanitizeFilters("conversations", { awaiting: "all" })).toEqual({});
  });

  it("refuses cursors and search text on both surfaces", () => {
    // A cursor is a position in one result set. Search text is a question asked
    // once, and saving it would turn a shared "my open threads" into "my open
    // threads mentioning boiler" for everyone who opened it.
    for (const surface of SAVED_VIEW_SURFACES) {
      expect(sanitizeFilters(surface, { cursor: "abc", q: "boiler" })).toEqual({});
    }
  });

  it("never throws on hostile or malformed input", () => {
    for (const raw of [null, undefined, "string", 42, [], { a: { b: 1 } }]) {
      expect(() => sanitizeFilters("tasks", raw)).not.toThrow();
      expect(sanitizeFilters("tasks", raw)).toEqual({});
    }
  });

  it("keeps the two surfaces apart", () => {
    // `overdue` is a task filter; the conversation list has no such parameter
    // and would ignore it, so storing it would be storing a lie.
    expect(sanitizeFilters("conversations", { overdue: true })).toEqual({});
    expect(sanitizeFilters("tasks", { overdue: true })).toEqual({
      overdue: true,
    });
    expect(sanitizeFilters("tasks", { is_spam: true })).toEqual({});
  });
});

describe("#280 filtersToQuery", () => {
  it("renders booleans the way the list endpoints parse them", () => {
    expect(filtersToQuery({ unread: true })).toEqual([["unread", "true"]]);
  });

  it("omits a false boolean rather than sending it", () => {
    // Every boolean filter means "restrict to this", so absence already says
    // false. Sending it is harmless today and becomes a silent behaviour change
    // the first time one gains a third state.
    expect(filtersToQuery({ unread: false, status: "open" })).toEqual([
      ["status", "open"],
    ]);
  });

  it("is stable, so two clients build the same request", () => {
    expect(filtersToQuery({ tag_id: ID, status: "open" })).toEqual(
      filtersToQuery({ status: "open", tag_id: ID }),
    );
  });
});

describe("#280 counts are bounded", () => {
  it("says 99+ rather than counting further", () => {
    expect(formatViewCount(0)).toBe("0");
    expect(formatViewCount(SAVED_VIEW_COUNT_CEILING)).toBe("99");
    expect(formatViewCount(SAVED_VIEW_COUNT_CEILING + 1)).toBe("99+");
    expect(formatViewCount(50_000)).toBe("99+");
  });
});

describe("#280 names", () => {
  it("accepts what a crew would actually type", () => {
    expect(isValidViewName("Mike's Monday")).toBe(true);
    expect(isValidViewName("  Quote sent  ")).toBe(true);
  });

  it("refuses empty and over-long", () => {
    expect(isValidViewName("")).toBe(false);
    expect(isValidViewName("   ")).toBe(false);
    expect(isValidViewName("x".repeat(61))).toBe(false);
  });

  it("treats case and padding as a collision, matching the unique index", () => {
    // #298 is the tag version of this arriving somewhere worse: a view is a
    // thing one person tells another to open, and "Today"/"today" side by side
    // means the instruction no longer names a screen.
    expect(viewNamesCollide("Today", " today ")).toBe(true);
    expect(viewNamesCollide("Today", "Tomorrow")).toBe(false);
  });
});

describe("#280 surfaces", () => {
  it("recognises only the two", () => {
    expect(isSavedViewSurface("conversations")).toBe(true);
    expect(isSavedViewSurface("tasks")).toBe(true);
    expect(isSavedViewSurface("contacts")).toBe(false);
  });

  it("publishes each surface's keys, so a client is not guessing", () => {
    expect(savedViewFilterKeys("conversations")).toContain("status");
    expect(savedViewFilterKeys("tasks")).toContain("overdue");
  });
});

describe("#280 isEmptyView", () => {
  it("recognises the unfiltered list under a name, which is legal", () => {
    // "Everything" is a reasonable view to save and land on.
    expect(isEmptyView({})).toBe(true);
    expect(isEmptyView({ status: "open" })).toBe(false);
  });
});

describe("#280 resolveAssignee — 'Mine' means whoever is looking", () => {
  const ME = "aaaaaaaa-1111-4222-8333-444444444444";

  it("resolves the relative filter to the viewer", () => {
    // The reason this exists: an owner defining the crew's morning queue means
    // each person's own work. A stored user id would make "Mine" one specific
    // human on everybody else's screen, which is both wrong and a way to watch
    // a colleague's inbox.
    expect(resolveAssignee({ assigned_to_me: true }, ME)).toBe(ME);
  });

  it("passes a named assignee through untouched", () => {
    expect(resolveAssignee({ assigned_user_id: ID }, ME)).toBe(ID);
  });

  it("returns nothing when the view says nothing about assignment", () => {
    expect(resolveAssignee({ status: "open" }, ME)).toBeUndefined();
  });

  it("never stores both, because the winner would differ per client", () => {
    // Silent if wrong: whichever key the request serialiser read last would
    // win, and the two clients could disagree. The deliberate one takes it.
    expect(
      sanitizeFilters("conversations", {
        assigned_to_me: true,
        assigned_user_id: ID,
      }),
    ).toEqual({ assigned_to_me: true });
  });

  it("drops a false assigned_to_me rather than storing a no-op", () => {
    expect(
      sanitizeFilters("conversations", {
        assigned_to_me: false,
        assigned_user_id: ID,
      }),
    ).toEqual({ assigned_user_id: ID });
  });
});
