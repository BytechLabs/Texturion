/**
 * #228: a time in a list row speaks the reader's language.
 *
 * `formatRelativeTime` took its translator as an optional third argument that
 * defaulted to English, and thirty callers never passed one. The inbox list,
 * the For You queue and the call log therefore said `now` and `Tue` to a French
 * reader. The locale now rides on the translator, so passing the translator is
 * the whole job.
 */
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/provider";

import { formatRelativeTime, twoClockLabel } from "./time";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("#228 formatRelativeTime follows the translator", () => {
  it("says `now` in the reader's language", () => {
    const iso = new Date(NOW.getTime() - 5_000).toISOString();
    expect(formatRelativeTime(iso, NOW, makeTranslate("en"))).toBe("now");
    expect(formatRelativeTime(iso, NOW, makeTranslate("fr-CA"))).toBe("maintenant");
  });

  it("names the weekday and the month in the reader's language, from the translator alone", () => {
    const threeDays = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    const lastYear = "2025-03-05T12:00:00.000Z";

    const en = makeTranslate("en");
    const fr = makeTranslate("fr-CA");

    // The locale is NOT passed as a fourth argument: carrying it on the
    // translator is what stops a caller from supplying a mismatched pair.
    expect(formatRelativeTime(threeDays, NOW, en)).toMatch(/^Sun$/);
    expect(formatRelativeTime(threeDays, NOW, fr)).not.toBe("Sun");
    expect(formatRelativeTime(threeDays, NOW, fr)).toMatch(/dim/i);

    expect(formatRelativeTime(lastYear, NOW, en)).toBe("Mar 5 2025");
    expect(formatRelativeTime(lastYear, NOW, fr)).toMatch(/mars/i);
  });

  it("keeps the English output unchanged when no translator is given", () => {
    const iso = new Date(NOW.getTime() - 5_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("now");
  });
});

describe("#228 the two-clock label follows the reader's language", () => {
  it("writes the weekday in the locale it is given", () => {
    const iso = "2026-07-14T15:00:00.000Z";
    const en = twoClockLabel(iso, "America/Toronto", "America/Toronto", "en");
    const fr = twoClockLabel(iso, "America/Toronto", "America/Toronto", "fr-CA");
    expect(en).toMatch(/Tue/);
    expect(fr).not.toMatch(/Tue/);
    expect(fr).toMatch(/mar/i);
  });
});
