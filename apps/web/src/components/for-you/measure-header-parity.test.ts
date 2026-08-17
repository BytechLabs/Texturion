import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inboxEn } from "@/i18n/sections/inbox";

/**
 * #540 — the four measures share ONE heading, on every client.
 *
 * The founder's word for this screen was "amateur", and this was a concrete
 * piece of why: two of the four cards used `MeasureHeader` and two inlined a
 * copy of its styling. Same intent, separately maintained, on one screen — so
 * the two species only had to drift by a couple of pixels for the list to look
 * wrong in a way nobody can point at. `Measures.kt`'s own comment records that
 * exact drift happening on web: "card tops thirty pixels apart in a row".
 *
 * ## What this asserts, and why it is the source rather than a render
 *
 * That every measure card REACHES FOR the shared component. A screenshot test
 * would catch the drift only after somebody changed one copy, which is a
 * regression test for a bug we have already had twice; this catches the shape
 * that makes it possible.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ANDROID = "apps/android/app/src/main/kotlin/com/loonext/android/features/foryou";
const IOS = "apps/ios/Loonext/Features/ForYou";

/** Every measure card, on both phones. Web's heading is one CSS class. */
const CARDS: Record<string, string> = {
  "android/ResponseTimeCard": `${ANDROID}/ResponseTimeCard.kt`,
  "android/SatisfactionCard": `${ANDROID}/SatisfactionCard.kt`,
  "android/LeadSourcesCard": `${ANDROID}/LeadSourcesCard.kt`,
  "android/PipelineCard": `${ANDROID}/PipelineCard.kt`,
  "ios/ResponseTimeCard": `${IOS}/ResponseTimeCard.swift`,
  "ios/SatisfactionCard": `${IOS}/SatisfactionCard.swift`,
  "ios/LeadSourcesCard": `${IOS}/LeadSourcesCard.swift`,
  "ios/PipelineCard": `${IOS}/PipelineCard.swift`,
};

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("#540 every measure card uses the shared heading", () => {
  it("reads all eight cards, so a passing run means something", () => {
    // A roster guard that quietly stopped finding its files would pass
    // forever. This repo has shipped one of those.
    for (const [name, path] of Object.entries(CARDS)) {
      expect(source(path).length, name).toBeGreaterThan(500);
    }
    expect(Object.keys(CARDS)).toHaveLength(8);
  });

  it("reaches for MeasureHeader rather than restating its styling", () => {
    const missing = Object.entries(CARDS)
      .filter(([, path]) => !source(path).includes("MeasureHeader"))
      .map(([name]) => name);
    expect(
      missing,
      "These measure cards build their own heading instead of using the " +
        "shared one, which is how four cards on one screen become two " +
        "species of panel:\n  " + missing.join("\n  "),
    ).toEqual([]);
  });

  it("does not restate the heading's type ramp anywhere else", () => {
    // The specific numbers MeasureHeader owns. A card repeating them is a
    // second definition even if it also happens to call the component.
    const restated = Object.entries(CARDS)
      .filter(([, path]) => /kerning\(1\.2\)|letterSpacing = 0\.12\.em/.test(source(path)))
      .map(([name]) => name);
    expect(
      restated,
      "These cards spell out the heading's kerning themselves:\n  " +
        restated.join("\n  "),
    ).toEqual([]);
  });

  it("stores the heading as a sentence, because the component shouts it", () => {
    // MeasureHeader uppercases. A catalogue holding "RESPONSE TIME" is storing
    // a styling decision as data — it survived only because uppercasing twice
    // looks the same, and it hands a translator a style instead of a sentence.
    for (const title of [inboxEn.responseTimeTitle, inboxEn.satisfactionTitle]) {
      expect(title, `${title} is stored shouted`).not.toBe(title.toUpperCase());
    }
  });
});
