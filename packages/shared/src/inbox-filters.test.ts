import { describe, expect, it } from "vitest";

import {
  activeInboxFilters,
  hasSecondaryInboxFilters,
  isInboxFiltered,
  type InboxFilterState,
} from "./inbox-filters";

/** Nothing selected: the home view on every client. */
function home(overrides: Partial<InboxFilterState> = {}): InboxFilterState {
  return {
    segment: null,
    assignedToMe: false,
    assigneeUserId: null,
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

  it("counts Mine as the segment moving, with no separate assignee", () => {
    const mine = home({ assignedToMe: true });
    expect(isInboxFiltered(mine)).toBe(true);
    expect(activeInboxFilters(mine)).toEqual(["segment"]);
  });

  it("lets Mine subsume a named assignee rather than counting both", () => {
    // Every client sends the viewer's own id and drops the named one, and every
    // client hides the assignee control while Mine is lit. Counting it is how an
    // empty Mine tab blamed a filter with nothing to un-set.
    const both = home({ assignedToMe: true, assigneeUserId: "u-2" });
    expect(activeInboxFilters(both)).toEqual(["segment"]);
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
      const state = home({ [key]: value } as Partial<InboxFilterState>);
      expect(activeInboxFilters(state), key).toEqual([dimension]);
      expect(isInboxFiltered(state), key).toBe(true);
    }
  });

  it("reports every dimension at once, in the declared order", () => {
    const everything = home({
      segment: "all",
      assigneeUserId: "u-2",
      tagId: "t-1",
      unreadOnly: true,
      spamOnly: true,
      snoozedOnly: true,
      awaitingOnly: true,
    });
    expect(activeInboxFilters(everything)).toEqual([
      "segment",
      "assignee",
      "tag",
      "unread",
      "spam",
      "snoozed",
      "awaiting",
    ]);
  });
});

describe("#548 hasSecondaryInboxFilters", () => {
  it("is false when only the segment moved", () => {
    // So the empty state can use its better per-tab sentence — "No closed
    // conversations" beats "Nothing matches these filters" for somebody who has
    // selected one tab and nothing else.
    expect(hasSecondaryInboxFilters(home({ segment: "closed" }))).toBe(false);
    expect(hasSecondaryInboxFilters(home({ assignedToMe: true }))).toBe(false);
  });

  it("is true as soon as anything else is on", () => {
    expect(hasSecondaryInboxFilters(home({ unreadOnly: true }))).toBe(true);
    expect(
      hasSecondaryInboxFilters(home({ segment: "closed", tagId: "t-1" })),
    ).toBe(true);
  });

  it("is false for a named assignee that Mine has subsumed", () => {
    // The iOS empty state's exact defect: it blamed an assignee the chip strip
    // was not showing, because Mine had already absorbed it.
    expect(
      hasSecondaryInboxFilters(
        home({ assignedToMe: true, assigneeUserId: "u-2" }),
      ),
    ).toBe(false);
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
    for (const state of states) {
      if (hasSecondaryInboxFilters(state)) {
        expect(isInboxFiltered(state)).toBe(true);
      }
    }
  });
});
