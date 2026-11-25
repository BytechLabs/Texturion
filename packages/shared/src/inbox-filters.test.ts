import { describe, expect, it } from "vitest";

import { activeInboxFilters, hasSecondaryInboxFilters, isInboxFiltered } from './inbox-filters';
import type { InboxFilterState } from './inbox-filters';

/** Nothing selected: the home view on every client. */
function home(overrides: Partial<InboxFilterState> = {}): InboxFilterState {
  return {
    segment: null,
    assignedToMe: false,
    assigneeUserId: null,
    unassignedOnly: false,
    lineId: null,
    tagId: null,
    unreadOnly: false,
    spamOnly: false,
    snoozedOnly: false,
    awaitingOnly: false,
    ...overrides,
  };
}

describe("#548 isInboxFiltered", () => {
  it("says nothing is filtered on the home view", () => {
    expect(isInboxFiltered(home())).toBe(false);
    expect(activeInboxFilters(home())).toEqual([]);
  });

  it("COUNTS THE STATUS SEGMENT, which is the whole bug", () => {
    // The phones' Reset asked the old predicate, which excluded this, so the one
    // filter sitting closest to the Reset control was the one it could not see:
    // select Closed, press Reset, get a haptic and nothing else.
    expect(isInboxFiltered(home({ segment: "closed" }))).toBe(true);
    expect(activeInboxFilters(home({ segment: "closed" }))).toEqual(["segment"]);
  });

  it("counts assignedToMe under assignee rather than segment", () => {
    const mine = home({ assignedToMe: true });
    expect(isInboxFiltered(mine)).toBe(true);
    expect(activeInboxFilters(mine)).toEqual(["assignee"]);
  });

  it("reports assignee once when assignedToMe and a named assignee are both set", () => {
    const both = home({ assignedToMe: true, assigneeUserId: "u-2" });
    expect(activeInboxFilters(both)).toEqual(["assignee"]);
  });

  it("counts a named assignee on its own", () => {
    expect(activeInboxFilters(home({ assigneeUserId: "u-2" }))).toEqual([
      "assignee",
    ]);
  });

  it("counts each chip on its own", () => {
    for (const [key, dimension] of [
      ["tagId", "tag"],
      ["unreadOnly", "unread"],
      ["spamOnly", "spam"],
      ["snoozedOnly", "snoozed"],
      ["awaitingOnly", "awaiting"],
    ] as const) {
      const value = key === "tagId" ? "t-1" : true;
      const state = home({ [key]: value });
      expect(activeInboxFilters(state), key).toEqual([dimension]);
      expect(isInboxFiltered(state), key).toBe(true);
    }
  });

  it("reports every dimension at once, in the declared order", () => {
    const everything = home({
      segment: "all",
      assigneeUserId: "u-2",
      lineId: "line-1",
      tagId: "t-1",
      unreadOnly: true,
      spamOnly: true,
      snoozedOnly: true,
      awaitingOnly: true,
    });
    expect(activeInboxFilters(everything)).toEqual([
      "segment",
      "assignee",
      "line",
      "tag",
      "unread",
      "spam",
      "snoozed",
      "awaiting",
    ]);
  });

  it("keeps Unassigned and assignedToMe inside the assignee dimension alongside line", () => {
    const state = home({ unassignedOnly: true, lineId: "line-1" });
    expect(activeInboxFilters(state)).toEqual(["assignee", "line"]);
    expect(activeInboxFilters({ ...state, assignedToMe: true })).toEqual(["assignee", "line"]);
  });
});

describe("#548 hasSecondaryInboxFilters", () => {
  it("is false when only the segment moved", () => {
    expect(hasSecondaryInboxFilters(home({ segment: "closed" }))).toBe(false);
  });

  it("is true as soon as anything beyond the segment is on", () => {
    expect(hasSecondaryInboxFilters(home({ assignedToMe: true }))).toBe(true);
    expect(hasSecondaryInboxFilters(home({ unreadOnly: true }))).toBe(true);
    expect(
      hasSecondaryInboxFilters(home({ segment: "closed", tagId: "t-1" })),
    ).toBe(true);
  });

  it("never disagrees with isInboxFiltered about the same state", () => {
    // The property that makes one list better than two predicates: secondary
    // filters existing implies something is filtered, always.
    const states = [
      home(),
      home({ segment: "closed" }),
      home({ unreadOnly: true }),
      home({ assignedToMe: true, assigneeUserId: "u-2" }),
      home({ segment: "all", tagId: "t-1", spamOnly: true }),
    ];
    for (const state of states.filter(hasSecondaryInboxFilters)) {
      expect(isInboxFiltered(state)).toBe(true);
    }
  });
});
