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
import { VOICEMAIL_INTAKE_MODEL } from "../calls/voicemail-intake";
import { VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL, VOICEMAIL_TRANSCRIPT_MODEL } from "../calls/voicemail-transcript";
import { DEFAULT_AI_SETTINGS } from "./settings";
import { AI_USAGE_FEATURES } from "./usage";
import { SUGGEST_REPLY_MODEL } from "../messaging/reply-suggestions";
import {
  THREAD_SUMMARY_CONTEXT_MESSAGES,
  THREAD_SUMMARY_MODEL,
} from "../messaging/thread-summary";
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
    expect(models.get("voicemail_intake")).toEqual([VOICEMAIL_INTAKE_MODEL]);
    expect(models.get("thread_summary")).toEqual([THREAD_SUMMARY_MODEL]);
  });

  it("#247 — the catch-up's disclosure states the window it actually sends", () => {
    // The one disclosure in this list that names a QUANTITY, because the
    // quantity is the disclosure: every other AI feature sends one message, one
    // field or one recording, and this one sends a conversation. A customer
    // reading "the recent messages" under suggested replies would not conclude
    // that a different feature sends forty of them.
    //
    // Asserted against the constant the route actually passes to PostgREST, so
    // the sentence cannot go on claiming a window somebody has since widened.
    // That is the same failure #389 was: a fact about the data, kept in step
    // with the data by memory.
    const row = AI_DISCLOSURES.find((entry) => entry.key === "thread_summary");
    expect(row?.sends).toContain(String(THREAD_SUMMARY_CONTEXT_MESSAGES));
    // And it must say what does NOT leave. Notes are excluded by the route's
    // direction filter; a page that omitted it would leave a crew to assume
    // their private "this guy never pays" went to a model.
    expect(row?.sends).toContain("notes are never included");
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
    // Corrected with the disclosure itself (#367): `suggest_replies` has
    // defaulted to true since 20260724090000, and this line asserted the
    // opposite — the hand-written half of this file agreeing with the
    // hand-written page, which is how #389 went unnoticed the first time.
    expect(byKey.get("suggest_reply")?.defaultOn).toBe(true);
    // #367/D89: the only one that is off until a business asks for it, because
    // it is the only one that changes what a stranger hears.
    expect(byKey.get("voicemail_intake")?.defaultOn).toBe(false);
  });

  it("derives default-on from the settings the gate actually reads", () => {
    // The assertions above name each feature by hand, which is how the #389
    // drift happened in the first place. This one cannot drift: it asks each
    // spec's own `enabled` predicate what DEFAULT_AI_SETTINGS answers, so a
    // default flipped in the code makes the public page's claim fail here
    // rather than quietly become untrue.
    const byKey = new Map(AI_DISCLOSURES.map((row) => [row.key, row]));
    for (const spec of AI_USAGE_FEATURES) {
      expect(byKey.get(spec.key)?.defaultOn, `${spec.key} defaultOn`).toBe(
        spec.enabled(DEFAULT_AI_SETTINGS),
      );
    }
  });
});
