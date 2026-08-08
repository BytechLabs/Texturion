import { describe, expect, it } from "vitest";

import {
  AGED_MILLIS,
  DASHBOARD_TILE_LABELS,
  dashboardTiles,
  type DashboardTileInput,
} from "./dashboard-tiles";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Nothing behind on anything — the caught-up morning. */
const EMPTY: DashboardTileInput = {
  unassignedAgesMillis: [],
  waiting: [],
  tasks: [],
  unreadAgesMillis: [],
};

const ids = (input: DashboardTileInput) => dashboardTiles(input).map((t) => t.id);

describe("#540 the strip is ordered by what to do first", () => {
  it("leads with the tile that has something overdue", () => {
    // The complaint this fixes: the order never changed, so the most urgent
    // thing sat wherever its category happened to be. An overdue task is the
    // strongest signal there is, so it goes first even though "My tasks" is
    // third in the reading order below.
    expect(
      ids({
        ...EMPTY,
        unreadAgesMillis: [5 * MINUTE],
        tasks: [{ ageMillis: 2 * HOUR, overdue: true }],
      })[0],
    ).toBe("tasks");
  });

  it("puts an aged tile ahead of a busier fresh one", () => {
    // Twelve unread from five minutes ago is an ordinary morning. One thread
    // waiting since yesterday is a customer wondering if anybody read it. Count
    // is not urgency, which is the whole reason a bare number was not enough.
    const order = ids({
      ...EMPTY,
      unreadAgesMillis: Array.from({ length: 12 }, () => 5 * MINUTE),
      waiting: [{ ageMillis: 26 * HOUR, overdue: false }],
    });
    expect(order[0]).toBe("waiting");
  });

  it("keeps empty tiles, at the end, rather than removing them", () => {
    // A strip whose tiles come and go is one nobody can build a habit around —
    // and "nothing unassigned" is worth seeing. They keep their place; they just
    // stop competing for the front.
    const order = ids({ ...EMPTY, unreadAgesMillis: [10 * MINUTE] });
    expect(order).toHaveLength(4);
    expect(order[0]).toBe("unread");
    expect(order.slice(1).sort()).toEqual(["tasks", "unassigned", "waiting"]);
  });

  it("does not reshuffle over a few minutes' difference", () => {
    // The rank is coarse on purpose. If two tiles swapped every time one aged a
    // minute past the other, the strip would have moved every time somebody
    // looked at it, and an owner could never learn where anything is.
    const a = ids({
      ...EMPTY,
      waiting: [{ ageMillis: 30 * MINUTE, overdue: false }],
      unreadAgesMillis: [31 * MINUTE],
    });
    const b = ids({
      ...EMPTY,
      waiting: [{ ageMillis: 32 * MINUTE, overdue: false }],
      unreadAgesMillis: [31 * MINUTE],
    });
    // Both are "present but not aged", so both keep the page's reading order.
    expect(a.slice(0, 2)).toEqual(["waiting", "unread"]);
    expect(b.slice(0, 2)).toEqual(["waiting", "unread"]);
  });

  it("falls back to the order of the sections under it", () => {
    // With nothing to separate them the strip must agree with the page below,
    // because a strip that disagrees with what it sits on is worse than one that
    // never moves.
    expect(
      ids({
        unassignedAgesMillis: [MINUTE],
        waiting: [{ ageMillis: MINUTE, overdue: false }],
        tasks: [{ ageMillis: MINUTE, overdue: false }],
        unreadAgesMillis: [MINUTE],
      }),
    ).toEqual(["unassigned", "waiting", "tasks", "unread"]);
  });

  it("is stable when nothing at all is happening", () => {
    expect(ids(EMPTY)).toEqual(["unassigned", "waiting", "tasks", "unread"]);
  });
});

describe("#540 each tile carries a reason, not just a number", () => {
  it("reports how many are overdue when any are", () => {
    const tiles = dashboardTiles({
      ...EMPTY,
      tasks: [
        { ageMillis: 3 * HOUR, overdue: true },
        { ageMillis: 2 * HOUR, overdue: true },
        { ageMillis: MINUTE, overdue: false },
      ],
    });
    const tasks = tiles.find((t) => t.id === "tasks");
    expect(tasks?.count).toBe(3);
    expect(tasks?.signal).toEqual({ kind: "overdue", count: 2 });
  });

  it("reports the OLDEST age when nothing is overdue", () => {
    // The oldest, not the newest and not an average: the question a person is
    // asking is "how long has somebody been waiting on me", and the answer is
    // the worst case, not the typical one.
    const tiles = dashboardTiles({
      ...EMPTY,
      unreadAgesMillis: [10 * MINUTE, 3 * HOUR, MINUTE],
    });
    expect(tiles.find((t) => t.id === "unread")?.signal).toEqual({
      kind: "oldest",
      ageMillis: 3 * HOUR,
    });
  });

  it("says nothing for an empty tile rather than inventing a zero", () => {
    expect(dashboardTiles(EMPTY).every((t) => t.signal === null)).toBe(true);
  });

  it("never calls unassigned work overdue", () => {
    // Nobody owns it, so it cannot be late to a person. Age is the whole signal
    // — unclaimed work going stale is the failure, and calling it "overdue" would
    // imply somebody had already been asked.
    const tiles = dashboardTiles({
      ...EMPTY,
      unassignedAgesMillis: [40 * HOUR],
    });
    expect(tiles.find((t) => t.id === "unassigned")?.signal).toEqual({
      kind: "oldest",
      ageMillis: 40 * HOUR,
    });
  });

  it("ignores a task with no due date when counting overdue", () => {
    // A task nobody dated cannot be late. Counting it would put a red number on
    // a strip for something no one promised.
    const tiles = dashboardTiles({
      ...EMPTY,
      tasks: [
        { ageMillis: null, overdue: false },
        { ageMillis: 2 * HOUR, overdue: false },
      ],
    });
    const tasks = tiles.find((t) => t.id === "tasks");
    expect(tasks?.count).toBe(2);
    expect(tasks?.signal).toEqual({ kind: "oldest", ageMillis: 2 * HOUR });
  });

  it("treats four hours as the line between ordinary and too long", () => {
    // Stated as a test so the threshold is a decision rather than a magic number
    // somebody later tunes without knowing what it was for: this is the morning
    // triage question, not #388's five-minute reply window.
    expect(AGED_MILLIS).toBe(4 * HOUR);
    const justUnder = ids({
      ...EMPTY,
      waiting: [{ ageMillis: AGED_MILLIS - MINUTE, overdue: false }],
      unassignedAgesMillis: [MINUTE],
    });
    // Not aged yet, so the page's reading order holds.
    expect(justUnder[0]).toBe("unassigned");
    const justOver = ids({
      ...EMPTY,
      waiting: [{ ageMillis: AGED_MILLIS + MINUTE, overdue: false }],
      unassignedAgesMillis: [MINUTE],
    });
    expect(justOver[0]).toBe("waiting");
  });
});

describe("#540 every tile can be named", () => {
  it("has a label for each id the ordering can return", () => {
    for (const tile of dashboardTiles(EMPTY)) {
      expect(DASHBOARD_TILE_LABELS[tile.id]).toBeTruthy();
    }
  });
});
