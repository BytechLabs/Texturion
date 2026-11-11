import { describe, expect, it } from "vitest";

import { doneToggleAction, taskAllowedActions } from "./task-actions";

describe("task actions (#722)", () => {
  it("offers complete and trash on an open task, reopen and trash on a done one", () => {
    expect(taskAllowedActions(false, "member")).toEqual(["complete"]);
    expect(taskAllowedActions(true, "member")).toEqual(["reopen"]);
    expect(taskAllowedActions(false, "owner")).toEqual(["complete", "trash"]);
    expect(taskAllowedActions(true, "owner")).toEqual(["reopen", "trash"]);
    expect(taskAllowedActions(false, "read_only")).toEqual([]);
  });

  it("names the action a done toggle is, and none for a no-op", () => {
    expect(doneToggleAction(false, true)).toBe("complete");
    expect(doneToggleAction(true, false)).toBe("reopen");
    expect(doneToggleAction(true, true)).toBeNull();
    expect(doneToggleAction(false, false)).toBeNull();
  });
});
