import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_TEXT_BOUNDS,
  AUTOMATIC_TEXT_DEFAULTS,
  resolveAutomaticTextSettings,
} from "./automatic-text-settings";
import { RATING_ASK_DELAY_HOURS, RATING_ASK_HORIZON_HOURS } from "./job-ratings";

describe("automatic text settings", () => {
  it("defaults to the behaviour workspaces had before these were settings", () => {
    expect(AUTOMATIC_TEXT_DEFAULTS.rating_ask_delay_hours).toBe(RATING_ASK_DELAY_HOURS);
    expect(AUTOMATIC_TEXT_DEFAULTS.rating_ask_expiry_hours).toBe(RATING_ASK_HORIZON_HOURS);
    expect(AUTOMATIC_TEXT_DEFAULTS.hold_scheduled_on_reply).toBe(true);
    expect(AUTOMATIC_TEXT_DEFAULTS.hold_reminders_on_reply).toBe(true);
    expect(AUTOMATIC_TEXT_DEFAULTS.hold_rating_ask_on_reply).toBe(true);
    expect(AUTOMATIC_TEXT_DEFAULTS.hold_reminders_unverified_calendar).toBe(true);
    expect(AUTOMATIC_TEXT_DEFAULTS.rating_ask_enabled).toBe(true);
  });

  it("keeps every default inside its own bounds", () => {
    for (const [key, bound] of Object.entries(AUTOMATIC_TEXT_BOUNDS)) {
      const value = AUTOMATIC_TEXT_DEFAULTS[key as keyof typeof AUTOMATIC_TEXT_BOUNDS];
      expect(value).toBeGreaterThanOrEqual(bound.min);
      expect(value).toBeLessThanOrEqual(bound.max);
    }
  });

  it("reads a missing row or a missing column as the default, never as off", () => {
    expect(resolveAutomaticTextSettings(null)).toEqual(AUTOMATIC_TEXT_DEFAULTS);
    expect(resolveAutomaticTextSettings({})).toEqual(AUTOMATIC_TEXT_DEFAULTS);
    expect(
      resolveAutomaticTextSettings({ hold_scheduled_on_reply: undefined, rating_ask_delay_hours: "4" }),
    ).toEqual(AUTOMATIC_TEXT_DEFAULTS);
  });

  it("keeps a value the workspace chose", () => {
    const row = { hold_scheduled_on_reply: false, rating_ask_delay_hours: 12 };
    expect(resolveAutomaticTextSettings(row)).toMatchObject(row);
  });
});
