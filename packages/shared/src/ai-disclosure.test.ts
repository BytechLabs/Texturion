/**
 * #228 — the AI disclosure table, in the words a customer actually reads.
 *
 * These assertions were in `apps/api/src/ai/disclosure.test.ts` and had to
 * move: the module names catalogue KEYS now, and checking what a sentence says
 * means resolving it, which means reading the web catalogue. `apps/api` does
 * not import `apps/web` source and should not start.
 *
 * The API test keeps everything structural — that every feature in
 * `AI_UNIT_COST_CENTS` is disclosed, that the model ids are the ones the
 * routes really call, that `defaultOn` is derived from the settings the gate
 * reads. Those bind the page to the CODE. This file binds it to the WORDS, in
 * both languages, which is the half a translation can break.
 */
import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import { AI_DISCLOSURES } from "./ai-disclosure";

function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const LANGUAGES = [
  ["English", WEB_EN],
  ["French", WEB_FR],
] as const;

describe("#389 the disclosure says what each feature sends", () => {
  it("says it in words a customer can act on, in both languages", () => {
    for (const row of AI_DISCLOSURES) {
      for (const [language, table] of LANGUAGES) {
        expect(
          look(table, row.label).length,
          `${language} label for ${row.key}`,
        ).toBeGreaterThan(3);
        // "Data may be processed for service improvement" is the sentence this
        // length check exists to make impossible to get away with — and a
        // translation is exactly where that sentence would creep back in.
        expect(
          look(table, row.sends).length,
          `${language} sends for ${row.key}`,
        ).toBeGreaterThan(30);
      }
      expect(
        look(WEB_FR, row.sends),
        `${row.key} is not translated`,
      ).not.toBe(look(WEB_EN, row.sends));
    }
  });

  it("#247 — the catch-up names its window, in both languages", () => {
    // The one disclosure that names a QUANTITY, because the quantity is the
    // disclosure: every other feature sends one message, one field or one
    // recording, and this one sends a conversation. A French page that
    // rounded "up to the 40 most recent messages" to "les messages récents"
    // would disclose something different from the English one — and every
    // English assertion would have stayed green while it did.
    //
    // The number itself is asserted against THREAD_SUMMARY_CONTEXT_MESSAGES in
    // apps/api/src/ai/disclosure.test.ts, which is where the constant the route
    // passes to PostgREST lives. This side checks it SURVIVED the translation.
    const row = AI_DISCLOSURES.find((entry) => entry.key === "thread_summary");
    expect(row, "the catch-up disclosure is missing").toBeTruthy();
    for (const [language, table] of LANGUAGES) {
      expect(look(table, row!.sends), `${language} window`).toContain("40");
    }
  });

  it("#247 — and says what does NOT go, in both languages", () => {
    // Notes are excluded by the route's direction filter. A page that omitted
    // it would leave a crew to assume their private "this guy never pays" went
    // to a model, and that assumption does not become safer in French.
    const row = AI_DISCLOSURES.find((entry) => entry.key === "thread_summary");
    expect(look(WEB_EN, row!.sends)).toContain("notes are never included");
    expect(look(WEB_FR, row!.sends)).toMatch(/notes internes ne sont jamais/i);
  });

  it("keeps the wrap-up's whose-voice distinction in French", () => {
    // D117: a crew member dictating after hanging up is not the call. The
    // English is explicit that we never send the call or the customer's voice,
    // and a translation that dropped the second half would claim we listen to
    // calls — which we do not.
    const row = AI_DISCLOSURES.find((entry) => entry.key === "call_wrapup");
    expect(look(WEB_EN, row!.sends)).toContain("Never the call itself");
    expect(look(WEB_FR, row!.sends)).toMatch(/jamais l'appel lui-même/i);
    expect(look(WEB_FR, row!.sends)).toMatch(/jamais la voix du client/i);
  });

  it("gives every feature its own label", () => {
    // Two rows reading the same thing is a table that discloses less than it
    // appears to, and it would pass every length check above.
    for (const [, table] of LANGUAGES) {
      const labels = AI_DISCLOSURES.map((row) => look(table, row.label));
      expect(new Set(labels).size).toBe(AI_DISCLOSURES.length);
    }
  });
});
