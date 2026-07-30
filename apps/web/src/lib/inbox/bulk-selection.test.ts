import { describe, expect, it } from "vitest";

import {
  bulkResultMessage,
  canEscalate,
  EMPTY_SELECTION,
  isEmpty,
  isRowSelected,
  selectAllMatching,
  selectionIds,
  selectionLabel,
  selectLoaded,
  toggleRow,
  undoBulkCalls,
} from "./bulk-selection";

/**
 * #275 — the selection semantics.
 *
 * Most of these are one assertion: THE UI MUST NEVER CLAIM A NUMBER IT DOES NOT
 * HAVE. The inbox is virtualized and cursor-paged, so the ids in hand are a page
 * out of a set the server has not counted yet, and a bar reading "340 selected"
 * that acts on 25 is the failure #275 names.
 */

const LOADED = ["a", "b", "c"];

describe("selection modes are not interchangeable", () => {
  it("starts empty, and empty hides the bar", () => {
    expect(isEmpty(EMPTY_SELECTION)).toBe(true);
    expect(isEmpty(selectLoaded(LOADED))).toBe(false);
    expect(isEmpty(selectAllMatching())).toBe(false);
  });

  it("sends explicit ids for a pointed-at selection, and null for filter mode", () => {
    // null is the instruction "you resolve it" — the server then applies the
    // #106 deny list to a set the client never enumerated.
    expect(selectionIds(selectLoaded(["b", "a"]))?.sort()).toEqual(["a", "b"]);
    expect(selectionIds(selectAllMatching())).toBeNull();
  });

  it("checks every row in filter mode, including ones not yet loaded", () => {
    const all = selectAllMatching();
    expect(isRowSelected(all, "a")).toBe(true);
    // A row that scrolls into view later is in the set by definition.
    expect(isRowSelected(all, "not-loaded-yet")).toBe(true);
  });

  it("checks only the named rows in id mode", () => {
    const some = selectLoaded(["a"]);
    expect(isRowSelected(some, "a")).toBe(true);
    expect(isRowSelected(some, "b")).toBe(false);
  });
});

describe("labels never invent a total", () => {
  it("counts exactly, when it knows", () => {
    expect(selectionLabel(selectLoaded(["a"]))).toBe("1 selected");
    expect(selectionLabel(selectLoaded(LOADED))).toBe("3 selected");
  });

  it("says no number at all in filter mode", () => {
    // The honest phrasing. A confident figure here would be the page count
    // masquerading as the total.
    const label = selectionLabel(selectAllMatching());
    expect(label).toBe("All matching this filter");
    expect(label).not.toMatch(/\d/);
  });
});

describe("toggling out of filter mode", () => {
  it("collapses to the loaded rows minus the one unticked", () => {
    // The user has said "not that one" about a set we cannot enumerate. We cannot
    // honour it as an exclusion, and ignoring the untick would leave a visibly
    // unchecked row inside the selection — so filter mode ends here.
    const next = toggleRow(selectAllMatching(), "b", LOADED);
    expect(next.mode).toBe("ids");
    expect(selectionIds(next)?.sort()).toEqual(["a", "c"]);
    expect(isRowSelected(next, "b")).toBe(false);
  });

  it("toggles a row on and off in id mode", () => {
    let sel = toggleRow(EMPTY_SELECTION, "a", LOADED);
    expect(selectionIds(sel)).toEqual(["a"]);
    sel = toggleRow(sel, "a", LOADED);
    expect(selectionIds(sel)).toEqual([]);
    expect(isEmpty(sel)).toBe(true);
  });
});

describe("the escalation is offered only when it means something", () => {
  it("offers it once every loaded row is ticked and more exist", () => {
    expect(canEscalate(selectLoaded(LOADED), LOADED, true)).toBe(true);
  });

  it("does not offer it before the page is fully ticked", () => {
    expect(canEscalate(selectLoaded(["a"]), LOADED, true)).toBe(false);
  });

  it("does not offer it when everything is already loaded", () => {
    // Escalating to the same set, phrased as though it were bigger, teaches the
    // user that the two options differ when they do not.
    expect(canEscalate(selectLoaded(LOADED), LOADED, false)).toBe(false);
  });

  it("does not offer it when already in filter mode, or with nothing loaded", () => {
    expect(canEscalate(selectAllMatching(), LOADED, true)).toBe(false);
    expect(canEscalate(EMPTY_SELECTION, [], true)).toBe(false);
  });
});

describe("the result message describes what the SERVER did", () => {
  it("counts applied, not selected", () => {
    expect(bulkResultMessage("Closed", { applied: [1, 2], matched: 2 })).toBe(
      "Closed 2 conversations",
    );
    expect(bulkResultMessage("Closed", { applied: [1], matched: 1 })).toBe(
      "Closed 1 conversation",
    );
  });

  it("names the remainder when the cap was hit", () => {
    // "It worked" and "it finished" are different answers here, and the user has
    // to be told which one they got.
    const message = bulkResultMessage("Closed", {
      applied: new Array(500).fill(1),
      matched: 640,
      capped: true,
    });
    expect(message).toContain("Closed 500 conversations");
    expect(message).toContain("140 more matched");
    expect(message).toContain("run it again");
  });

  it("names rows it could not reach instead of swallowing them", () => {
    // The #275 acceptance criterion: never a green toast that lies.
    const message = bulkResultMessage("Marked read", {
      applied: [1, 2, 3],
      failed: [{ id: "x", reason: "not_found" }],
      matched: 4,
    });
    expect(message).toContain("Marked read 3 conversations");
    expect(message).toContain("1 couldn't be reached");
    expect(message).toContain("was left alone");
  });

  it("pluralizes the failures too", () => {
    const message = bulkResultMessage("Closed", {
      applied: [1],
      failed: [{ id: "x" }, { id: "y" }],
      matched: 3,
    });
    expect(message).toContain("2 couldn't be reached");
    expect(message).toContain("were left alone");
  });

  it("reports zero honestly rather than claiming success", () => {
    // Everything matched was unreachable: the toast must not read as a win.
    const message = bulkResultMessage("Closed", {
      applied: [],
      failed: [{ id: "x" }],
      matched: 1,
    });
    expect(message).toContain("Closed 0 conversations");
    expect(message).toContain("couldn't be reached");
  });
});

describe("#275 — undoBulkCalls: one undo, grouped, restoring the ACTUAL prior value", () => {
  it("groups a mixed-status close into one call per prior status", () => {
    // Closing 300 threads that were a mix of new/open/waiting must come back as
    // three calls, not three hundred — and each row must land on the status it
    // actually had, not a uniform "open".
    const calls = undoBulkCalls(
      {
        action: "set_status",
        matched: 4,
        capped: false,
        failed: [],
        applied: [
          { id: "a", previous: { status: "open" } },
          { id: "b", previous: { status: "new" } },
          { id: "c", previous: { status: "open" } },
          { id: "d", previous: { status: "waiting" } },
        ],
      },
      { action: "set_status", target_status: "closed" },
    );
    expect(calls).toHaveLength(3);
    const open = calls.find((c) => c.target_status === "open");
    expect(open?.ids?.sort()).toEqual(["a", "c"]);
    expect(calls.find((c) => c.target_status === "new")?.ids).toEqual(["b"]);
    expect(calls.find((c) => c.target_status === "waiting")?.ids).toEqual(["d"]);
  });

  it("restores a null assignee as null, not as nobody-in-particular", () => {
    const calls = undoBulkCalls(
      {
        action: "assign",
        matched: 2,
        capped: false,
        failed: [],
        applied: [
          { id: "a", previous: { assigned_user_id: null } },
          { id: "b", previous: { assigned_user_id: "u1" } },
        ],
      },
      { action: "assign", target_user_id: "u2" },
    );
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.target_user_id === null)?.ids).toEqual(["a"]);
    expect(calls.find((c) => c.target_user_id === "u1")?.ids).toEqual(["b"]);
  });

  it("undoing add_tag removes ONLY the rows that did not already have it", () => {
    // Otherwise the undo strips a tag somebody applied by hand months ago —
    // a bulk action destroying data it never created.
    const calls = undoBulkCalls(
      {
        action: "add_tag",
        matched: 2,
        capped: false,
        failed: [],
        applied: [
          { id: "already", previous: { had_tag: true } },
          { id: "fresh", previous: { had_tag: false } },
        ],
      },
      { action: "add_tag", target_tag_id: "t1" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("remove_tag");
    expect(calls[0].target_tag_id).toBe("t1");
    expect(calls[0].ids).toEqual(["fresh"]);
  });

  it("undoing remove_tag restores ONLY the rows that had it", () => {
    const calls = undoBulkCalls(
      {
        action: "remove_tag",
        matched: 2,
        capped: false,
        failed: [],
        applied: [
          { id: "had", previous: { had_tag: true } },
          { id: "never", previous: { had_tag: false } },
        ],
      },
      { action: "remove_tag", target_tag_id: "t1" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("add_tag");
    expect(calls[0].ids).toEqual(["had"]);
  });

  it("offers no undo for mark_read", () => {
    // "Unread" is the absence of a read receipt, and nobody asks to un-read three
    // hundred threads — so the RPC records no prior state and there is nothing
    // to build a call from.
    expect(
      undoBulkCalls(
        {
          action: "mark_read",
          matched: 3,
          capped: false,
          failed: [],
          applied: [
            { id: "a", previous: {} },
            { id: "b", previous: {} },
          ],
        },
        { action: "mark_read" },
      ),
    ).toEqual([]);
  });

  it("never sends a tag undo without the tag id", () => {
    // The id is not in the response; a call without it would be a 422.
    expect(
      undoBulkCalls(
        {
          action: "add_tag",
          matched: 1,
          capped: false,
          failed: [],
          applied: [{ id: "a", previous: { had_tag: false } }],
        },
        { action: "add_tag" },
      ),
    ).toEqual([]);
  });
});
