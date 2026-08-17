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

const WEB = "apps/web/src/components/for-you";

/**
 * Every measure card, on all three clients.
 *
 * This roster said "on both phones" and excluded web, on the grounds that web's
 * heading was "one CSS class" — which was true and was the problem. Web had
 * four hand-copied copies of the same twelve-class `<h2>` and the same bordered
 * frame, so the drift the phones are guarded against was simply unguarded on
 * the client the founder actually looks at. Web now has `MeasureCard`, the same
 * consolidation `MeasureHeader` is on the phones, and it is checked here.
 */
const CARDS: Record<string, string> = {
  "web/ResponseTimeCard": `${WEB}/response-time-card.tsx`,
  "web/SatisfactionCard": `${WEB}/satisfaction-card.tsx`,
  "web/LeadSourcesCard": `${WEB}/lead-sources-card.tsx`,
  "web/PipelineCard": `${WEB}/pipeline-card.tsx`,
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
  it("reads all twelve cards, so a passing run means something", () => {
    // A roster guard that quietly stopped finding its files would pass
    // forever. This repo has shipped one of those.
    for (const [name, path] of Object.entries(CARDS)) {
      expect(source(path).length, name).toBeGreaterThan(500);
    }
    expect(Object.keys(CARDS)).toHaveLength(12);
  });

  it("reaches for the shared shell rather than restating its styling", () => {
    // `MeasureHeader` on the phones, `MeasureCard` on web — the same decision
    // in each platform's idiom. Web's shell owns the frame as well as the
    // heading, because the frame is where its own drift showed up: the card
    // body was height-auto inside a stretched grid item, so two cards in one
    // row ended at different heights.
    const missing = Object.entries(CARDS)
      .filter(([name, path]) => {
        const shell = name.startsWith("web/") ? "MeasureCard" : "MeasureHeader";
        return !source(path).includes(shell);
      })
      .map(([name]) => name);
    expect(
      missing,
      "These measure cards build their own heading instead of using the " +
        "shared one, which is how four cards on one screen become two " +
        "species of panel:\n  " + missing.join("\n  "),
    ).toEqual([]);
  });

  it("does not restate the heading's type ramp anywhere else", () => {
    // The specific numbers the shared shell owns. A card repeating them is a
    // second definition even if it also happens to call the component.
    //
    // Web's are the heading's tracking and the frame's border/paper pair. The
    // frame is included deliberately: a card that calls `MeasureCard` and then
    // draws its own bordered box inside it is back to a height-auto frame in a
    // stretched cell, which is the exact defect the shell exists to remove.
    const restated = Object.entries(CARDS)
      .filter(([, path]) =>
        /kerning\(1\.2\)|letterSpacing = 0\.12\.em|tracking-\[0\.06em\]|rounded-app-card border border-app-line/.test(
          source(path),
        ),
      )
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
