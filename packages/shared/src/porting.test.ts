import { describe, expect, it } from "vitest";

import {
  PORT_PRE_CUTOVER_CHECKLIST,
  PORT_PRE_CUTOVER_STATUSES,
  isBeforePortCutover,
} from "./porting";

describe("#319/#248 what a customer is told while their number is transferring", () => {
  it("warns while the transfer is in flight and not before or after", () => {
    for (const status of PORT_PRE_CUTOVER_STATUSES) {
      expect(isBeforePortCutover(status)).toBe(true);
    }
    // `draft` — nothing in flight. `exception` — the rejection notice owns that
    // screen. `ported` onwards — too late to export, moot once switched.
    for (const status of [
      "draft",
      "exception",
      "ported",
      "cancel-pending",
      "cancelled",
    ]) {
      expect(isBeforePortCutover(status)).toBe(false);
    }
  });

  it("treats an unknown status as nothing to warn about", () => {
    // An allowlist, so a status added to the carrier vocabulary later starts
    // silent and gets considered, rather than inheriting a warning about a
    // deadline it may not have.
    expect(isBeforePortCutover("some-new-carrier-state")).toBe(false);
    expect(isBeforePortCutover("")).toBe(false);
  });

  it("leads with the item that can lose the number", () => {
    // ORDER IS THE CONTRACT, not decoration. A reader skims the bold leads and
    // stops; the one that costs them the number on their trucks has to be the
    // one they cannot miss. Every other item here is an inconvenience.
    const first = PORT_PRE_CUTOVER_CHECKLIST.items[0]!;
    expect(first.lead).toBe("Keep your old service active.");
    expect(first.detail).toContain("release the number back to the carrier");
  });

  it("says something under every lead, on every row", () => {
    // A lead with no reason under it is an instruction a business owner has to
    // take on trust while looking at a bill they want to cancel.
    expect(PORT_PRE_CUTOVER_CHECKLIST.items.length).toBeGreaterThanOrEqual(4);
    for (const item of PORT_PRE_CUTOVER_CHECKLIST.items) {
      expect(item.lead.trim()).not.toBe("");
      expect(item.detail.trim()).not.toBe("");
    }
  });
});
