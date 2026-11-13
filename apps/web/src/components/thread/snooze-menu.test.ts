/**
 * The snooze return label draws its time, weekday and date from the shared
 * formatter cache; the words must be exactly what the browser's own
 * toLocale*String calls say.
 */
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { deferralReturnLabel } from "./snooze-menu";

/** Local wall clocks, the clock `snoozeReturnShape` counts days on. */
const NOW = new Date(2026, 10, 10, 9, 0);
const TODAY = new Date(2026, 10, 10, 15, 30);
const TOMORROW = new Date(2026, 10, 11, 8, 0);
const THURSDAY = new Date(2026, 10, 12, 8, 0);
const LATER = new Date(2026, 10, 24, 8, 0);

const time = (date: Date, locale: string) =>
  date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

describe("deferralReturnLabel", () => {
  it.each(["en", "fr-CA"] as const)("says what the browser said, in %s", (locale) => {
    const t = makeTranslate(locale);
    expect(deferralReturnLabel(TODAY.toISOString(), "back", t, NOW)).toBe(
      t("thread.snoozeLeadBack", {
        when: t("thread.snoozeWhenAt", { time: time(TODAY, locale) }),
      }),
    );
    expect(deferralReturnLabel(TOMORROW.toISOString(), "chase", t, NOW)).toBe(
      t("thread.snoozeLeadChase", {
        when: t("thread.snoozeWhenTomorrow", { time: time(TOMORROW, locale) }),
      }),
    );
    expect(deferralReturnLabel(THURSDAY.toISOString(), "back", t, NOW)).toBe(
      t("thread.snoozeLeadBack", {
        when: t("thread.snoozeWhenWeekday", {
          weekday: THURSDAY.toLocaleDateString(locale, { weekday: "long" }),
          time: time(THURSDAY, locale),
        }),
      }),
    );
    expect(deferralReturnLabel(LATER.toISOString(), "snoozedToast", t, NOW)).toBe(
      t("thread.snoozeLeadSnoozedToast", {
        when: t("thread.snoozeWhenDate", {
          date: LATER.toLocaleDateString(locale, { day: "numeric", month: "short" }),
        }),
      }),
    );
  });

  it("pins the English words", () => {
    const en = makeTranslate("en");
    expect(deferralReturnLabel(THURSDAY.toISOString(), "back", en, NOW)).toBe(
      "Back Thursday, 8:00 AM",
    );
  });

  it("never draws a blank chip for an unreadable time (#293)", () => {
    expect(deferralReturnLabel("not a date")).toBe("Snoozed");
  });
});
