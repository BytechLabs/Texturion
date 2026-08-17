import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { quotesEn, quotesFr } from "@/i18n/sections/quotes";

/**
 * #287 — the quote strip says the same thing on web and Android.
 *
 * Web shipped first and the phones had nothing at all: a crew member could
 * quote a job from a laptop and not from the van, which is the wrong way round
 * for this product. Android has the strip now, and this is what stops the two
 * from drifting while iOS is still to come.
 *
 * ## Why the STATUS words are pinned hardest
 *
 * They are the six answers to "where is this quote". "Waiting" and "Opened, no
 * answer" are deliberately different sentences — one means the customer has not
 * looked, the other means they looked and said nothing, and those are different
 * mornings for whoever is chasing. A client that collapsed them, or reworded
 * one, would quietly lose that distinction on one platform only.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ANDROID = readFileSync(
  join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ThreadStrings.kt",
  ),
  "utf8",
);

/** Every key the Android strip renders. iOS joins this list when it lands. */
const SHARED_KEYS = [
  "statusDraft",
  "statusSent",
  "statusViewed",
  "statusAccepted",
  "statusDeclined",
  "statusExpired",
  "newQuote",
  "sendFor",
  "sending",
  "saveDraft",
  "saving",
  "amountLabel",
  "descriptionLabel",
  "expiresInDays",
  "needAmount",
  "needDescription",
] as const;

describe("#287 the quote strip reads the same on web and Android", () => {
  it("reads the Android catalogue, so a passing run means something", () => {
    expect(ANDROID.length).toBeGreaterThan(1000);
    expect(SHARED_KEYS).toHaveLength(16);
  });

  it("carries every sentence in English", () => {
    const missing = SHARED_KEYS.filter(
      (key) => !ANDROID.includes(quotesEn[key]),
    );
    expect(
      missing,
      "Android is missing or has reworded these #287 sentences:\n  " +
        missing.map((key) => `${key}: ${quotesEn[key]}`).join("\n  "),
    ).toEqual([]);
  });

  it("carries every sentence in French", () => {
    const missing = SHARED_KEYS.filter(
      (key) => !ANDROID.includes(quotesFr[key]),
    );
    expect(
      missing,
      "Android is missing or has reworded these #287 French sentences:\n  " +
        missing.map((key) => `${key}: ${quotesFr[key]}`).join("\n  "),
    ).toEqual([]);
  });

  it("keeps the slots, which are what make two of these sentences work", () => {
    // `sendFor` carries the amount because SEND is the act that binds a price
    // — you should not be able to press it without the figure in your eye. A
    // translation that dropped the slot would render "Send for {amount}".
    expect(quotesEn.sendFor).toContain("{amount}");
    expect(quotesFr.sendFor).toContain("{amount}");
    expect(quotesEn.expiresInDays).toContain("{days}");
    expect(quotesFr.expiresInDays).toContain("{days}");
  });

  it("keeps 'waiting' and 'opened, no answer' as different sentences", () => {
    // The distinction the whole strip exists to show. Collapsing them loses
    // the difference between a customer who has not looked and one who looked
    // and said nothing.
    expect(quotesEn.statusSent).not.toBe(quotesEn.statusViewed);
    expect(quotesFr.statusSent).not.toBe(quotesFr.statusViewed);
  });
});
