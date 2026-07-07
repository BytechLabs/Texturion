import { describe, expect, it } from "vitest";

import {
  clampActiveIndex,
  nextRecipientIndex,
  recipientOptionId,
} from "./recipient-combobox";

// ---------------------------------------------------------------------------
// nextRecipientIndex (#63) — the combobox keyboard reducer
// ---------------------------------------------------------------------------

describe("nextRecipientIndex", () => {
  it("ArrowDown from no-active lands on the first option", () => {
    expect(nextRecipientIndex("ArrowDown", -1, 3)).toBe(0);
  });

  it("ArrowDown steps forward and wraps past the end", () => {
    expect(nextRecipientIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextRecipientIndex("ArrowDown", 1, 3)).toBe(2);
    expect(nextRecipientIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("ArrowUp from no-active (or the first option) lands on the last", () => {
    expect(nextRecipientIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextRecipientIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("ArrowUp steps backward", () => {
    expect(nextRecipientIndex("ArrowUp", 2, 3)).toBe(1);
  });

  it("leaves Home/End to the textbox caret (editable combobox, APG)", () => {
    expect(nextRecipientIndex("Home", 2, 3)).toBeNull();
    expect(nextRecipientIndex("End", 0, 3)).toBeNull();
  });

  it("returns null for non-navigation keys so typing falls through", () => {
    expect(nextRecipientIndex("a", 1, 3)).toBeNull();
    expect(nextRecipientIndex("Enter", 1, 3)).toBeNull();
    expect(nextRecipientIndex("Escape", 1, 3)).toBeNull();
    expect(nextRecipientIndex("Tab", 1, 3)).toBeNull();
  });

  it("never yields an index over an empty listbox", () => {
    expect(nextRecipientIndex("ArrowDown", -1, 0)).toBeNull();
    expect(nextRecipientIndex("ArrowUp", -1, 0)).toBeNull();
  });

  it("a single option is reachable and wraps onto itself", () => {
    expect(nextRecipientIndex("ArrowDown", -1, 1)).toBe(0);
    expect(nextRecipientIndex("ArrowDown", 0, 1)).toBe(0);
    expect(nextRecipientIndex("ArrowUp", 0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clampActiveIndex — stale indexes must not outlive a shrinking result set
// ---------------------------------------------------------------------------

describe("clampActiveIndex", () => {
  it("keeps a valid index", () => {
    expect(clampActiveIndex(2, 5)).toBe(2);
    expect(clampActiveIndex(0, 1)).toBe(0);
  });

  it("resets an index past the end (results narrowed) to none", () => {
    expect(clampActiveIndex(4, 3)).toBe(-1);
    expect(clampActiveIndex(0, 0)).toBe(-1);
  });

  it("passes -1 (nothing active) through", () => {
    expect(clampActiveIndex(-1, 3)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// recipientOptionId — the aria-activedescendant target
// ---------------------------------------------------------------------------

describe("recipientOptionId", () => {
  it("derives a stable per-index DOM id under the listbox id", () => {
    expect(recipientOptionId("compose-to-results", 0)).toBe(
      "compose-to-results-option-0",
    );
    expect(recipientOptionId("compose-to-results", 4)).toBe(
      "compose-to-results-option-4",
    );
  });
});
