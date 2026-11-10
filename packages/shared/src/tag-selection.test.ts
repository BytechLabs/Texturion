import { describe, expect, it } from "vitest";

import { tagSelectionState, tagToggleAction } from "./tag-selection";

describe("tagSelectionState", () => {
  it("reads every, some or none of the selection", () => {
    expect(tagSelectionState([["a"], ["a", "b"]], "a")).toBe("all");
    expect(tagSelectionState([["a"], ["b"]], "a")).toBe("some");
    expect(tagSelectionState([["b"], []], "a")).toBe("none");
  });

  it("is unknown for a filter selection whose rows are not loaded", () => {
    expect(tagSelectionState(null, "a")).toBe("unknown");
    expect(tagSelectionState([], "a")).toBe("unknown");
  });
});

describe("tagToggleAction", () => {
  it("removes only what every item already has", () => {
    expect(tagToggleAction("all")).toBe("remove");
    for (const state of ["some", "none", "unknown"] as const) {
      expect(tagToggleAction(state)).toBe("add");
    }
  });
});
