/**
 * #389 — the public disclosure and the code cannot drift apart again.
 *
 * `docs/DATA-INVENTORY.md` was updated when AI shipped and the customer-facing
 * sub-processors page was not, so that page went on saying "no message content
 * stored" while the product sent whole message threads and voicemail audio for
 * inference. Two documents, kept in step by memory, and memory lost.
 *
 * This is the binding. `AI_DISCLOSURES` is what the marketing page renders;
 * `AI_UNIT_COST_CENTS` is the typed registry every AI call must already be
 * declared in (#380). Asserting one covers the other means a new AI feature
 * cannot ship without a public disclosure — the same structural move as the
 * cost cap being required at the point the feature is declared.
 *
 * The model strings are asserted against the constants the code actually
 * calls, not eyeballed: a disclosure that names last quarter's model is a
 * disclosure that is wrong, and wrong on a legal page is worse than absent.
 */
import { describe, expect, it } from "vitest";

import { AI_DISCLOSURES } from "@loonext/shared";

import { AI_UNIT_COST_CENTS } from "../billing/costs";
import { VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL, VOICEMAIL_TRANSCRIPT_MODEL } from "../calls/voicemail-transcript";
import { SUGGEST_REPLY_MODEL } from "../messaging/reply-suggestions";
import { ENRICHMENT_MODEL } from "../tasks/enrichment";

describe("every AI feature is publicly disclosed", () => {
  it("discloses exactly the features the cost registry knows about", () => {
    // Both directions. A feature with no disclosure is the #389 bug happening
    // again; a disclosure with no feature tells customers we process something
    // we do not, which is its own kind of untrue.
    expect(AI_DISCLOSURES.map((row) => row.key).sort()).toEqual(
      Object.keys(AI_UNIT_COST_CENTS).sort(),
    );
  });

  it("names the models the code actually calls", () => {
    const models = new Map(AI_DISCLOSURES.map((row) => [row.key, row.models]));

    expect(models.get("suggest_reply")).toEqual([SUGGEST_REPLY_MODEL]);
    expect(models.get("enrich")).toEqual([ENRICHMENT_MODEL]);
    // The fallback is named too. It is a real model that real audio reaches,
    // and a disclosure listing only the happy path has a hole in it exactly
    // when something has gone wrong.
    expect(models.get("voicemail_transcript")).toEqual([
      VOICEMAIL_TRANSCRIPT_MODEL,
      VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL,
    ]);
  });

  it("says what each feature sends, in words a customer can act on", () => {
    for (const row of AI_DISCLOSURES) {
      expect(row.label.length, `${row.key} label`).toBeGreaterThan(3);
      // "Data may be processed for service improvement" is the sentence this
      // length check exists to make impossible to get away with.
      expect(row.sends.length, `${row.key} sends`).toBeGreaterThan(30);
      expect(row.models.length, `${row.key} models`).toBeGreaterThan(0);
      for (const model of row.models) {
        // Workers AI identifiers. A bare product name ("Whisper") would hide
        // which model and whose it is, and provenance is the point.
        expect(model, `${row.key} model id`).toMatch(/^@cf\//);
      }
    }
  });

  it("marks default-on features as default-on", () => {
    // D46 made enrichment and transcription default-on. A disclosure that
    // implies a customer opted in when they did not is the one error here that
    // would actively mislead rather than merely omit.
    const byKey = new Map(AI_DISCLOSURES.map((row) => [row.key, row]));
    expect(byKey.get("enrich")?.defaultOn).toBe(true);
    expect(byKey.get("voicemail_transcript")?.defaultOn).toBe(true);
    expect(byKey.get("suggest_reply")?.defaultOn).toBe(false);
  });
});
