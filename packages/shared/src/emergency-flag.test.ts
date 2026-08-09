import { describe, expect, it } from "vitest";

import {
  isFlaggedUrgent,
  URGENT_BADGE_LABEL,
  type EmergencyFlagFields,
} from "./emergency-flag";

const thread = (
  fields: Partial<EmergencyFlagFields> = {},
): EmergencyFlagFields => ({
  emergency_at: null,
  closed_at: null,
  ...fields,
});

const WHEN = "2026-08-08T23:04:00.000Z";

describe("isFlaggedUrgent (#414 / #565)", () => {
  it("is false for an ordinary open thread", () => {
    expect(isFlaggedUrgent(thread())).toBe(false);
  });

  it("is true while an urgent thread is still open", () => {
    expect(isFlaggedUrgent(thread({ emergency_at: WHEN }))).toBe(true);
  });

  it("clears when the crew closes the thread", () => {
    // Closing is the product's existing word for "handled". A badge that never
    // cleared would be decoration, and a timer deciding an emergency stopped
    // mattering would be a guess made while somebody was still driving to it.
    expect(
      isFlaggedUrgent(thread({ emergency_at: WHEN, closed_at: WHEN })),
    ).toBe(false);
  });

  it("does not fire on a closed thread that was never urgent", () => {
    expect(isFlaggedUrgent(thread({ closed_at: WHEN }))).toBe(false);
  });

  it("reads presence, not an ordering — and does not need to", () => {
    /**
     * An urgent reply arriving after a close looks like it should matter, and it
     * cannot happen. The inbound that sets `emergency_at` goes through
     * `messages_automated`, which REOPENS a thread closed within 30 days
     * (`set status = 'new', closed_at = null`) and otherwise starts a fresh row.
     * So a row never carries an `emergency_at` later than its own `closed_at`.
     *
     * Asserted anyway, and asserted as PRESENCE, because comparing the two
     * timestamps would be a second rule — one guarding a state the database
     * cannot produce, drifting quietly if that reopen window ever changes.
     */
    expect(
      isFlaggedUrgent(
        thread({
          emergency_at: "2026-08-08T23:04:00.000Z",
          closed_at: "2026-08-01T09:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("says Urgent, so a screen reader does not spell it", () => {
    // The clients upper-case it in their own styling. If this constant were
    // already upper-case, VoiceOver would read it letter by letter.
    expect(URGENT_BADGE_LABEL).toBe("Urgent");
    expect(URGENT_BADGE_LABEL).not.toBe(URGENT_BADGE_LABEL.toUpperCase());
  });
});
