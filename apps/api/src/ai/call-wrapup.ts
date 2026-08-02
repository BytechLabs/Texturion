import { AI_UNIT_COST_CENTS } from "../billing/costs";
import type { AiFeatureSpec } from "./run";

/**
 * #507 Phase 1 — the wrap-up a crew member speaks after hanging up.
 *
 * D112 identified the real want correctly: the recurring, expensive dispute in
 * the trades is "what did I quote him?", and nobody wants to re-listen to a
 * nineteen-minute call to answer it. They want the answer, written down and
 * searchable.
 *
 * # Why it is the CREW member's voice and not the call
 *
 * D117 is the reason. Producing a summary of a live two-party call means
 * acquiring the other party's voice, and every interception statute attaches to
 * that acquisition rather than to how long the file is kept — Canada's Criminal
 * Code s.183 goes further and defines "intercept" to include acquiring "the
 * substance, meaning or purport", which is what a transcript IS. So the live
 * version needs a whole consent architecture (#509) and cannot ship on the
 * reasoning D112 gave for it.
 *
 * This delivers the same answer without any of that. One person, speaking
 * knowingly, into their own handset, about a call that has ended. The
 * customer's voice is never acquired, so none of the above is engaged.
 *
 * # Why the words are VERBATIM and no model rewrites them
 *
 * The obvious next step is to have Lou restructure the dictation into "quote,
 * commitment, next step", which is what #507 originally proposed. It is the
 * wrong call here, and the reason is the feature's own purpose: this note
 * exists to settle a dispute about what was said. A tech who says "two thousand
 * four hundred" and reads back $2,400 has a record. A model that paraphrases
 * and lands on $2,000 has destroyed the only thing the note was for — and it
 * would fail silently, months before anyone looks.
 *
 * The human already spoke the summary. Whisper writes it down. Structure can be
 * layered on top of verbatim text later without losing anything; a paraphrase
 * cannot be un-paraphrased.
 *
 * # Posture (cost-protection mandate)
 *
 * - Bounded by a person deliberately holding a button, and capped anyway under
 *   its OWN feature key so a runaway here cannot starve reply drafting or
 *   voicemail.
 * - BEST EFFORT. Every failure leaves the member exactly where they were: the
 *   note composer, with a keyboard. Dictation is a shortcut, never a
 *   precondition.
 * - The audio is never stored. It is read from the request, transcribed, and
 *   dropped — it never reaches R2 and there is no id that could fetch it back.
 * - The transcript is DATA, never an instruction. It is returned for a human to
 *   read, edit and post; nothing downstream acts on it.
 */

/** The per-feature key in the shared monthly AI ledger (`ai_usage_reserve`). */
export const CALL_WRAPUP_FEATURE = "call_wrapup";

/**
 * Hard per-company monthly cap.
 *
 * A wrap-up costs a person pressing a button and talking, so volume is bounded
 * by human effort long before this bites. It exists to bound a compromised key
 * or a client stuck in a retry loop, not to ration the feature.
 *
 * 1,500 is sized against the biggest workspace the plans allow: 15 Pro seats
 * dictating four or five wrap-ups a day over 22 working days. Not every call
 * earns one — a wrap-up is for the calls with a quote or a commitment in them,
 * which is why this is not seats x calls.
 *
 * The number is deliberately not larger. It costs 150c/month at the cap, which
 * takes the most AI one tenant can spend from $2.05 to $3.55, and that ceiling
 * is a figure `billing/costs.test.ts` pins on purpose so a new cost centre
 * cannot raise it quietly. Doubling the ceiling for a convenience feature would
 * not have been a fair trade against the cost-protection mandate.
 *
 * Hitting it degrades rather than breaks: `stops` says so, and the composer
 * still takes a typed note.
 */
export const CALL_WRAPUP_MONTHLY_CAP = 1500;

/** Fire the one-shot ops alert at 80% of the cap (alert BEFORE the cap). */
export const CALL_WRAPUP_ALERT_THRESHOLD = Math.floor(
  CALL_WRAPUP_MONTHLY_CAP * 0.8,
);

/**
 * Longest dictation we will transcribe, in seconds.
 *
 * Deliberately far shorter than voicemail's 300. A wrap-up is a sentence or
 * three — "quoted him $2,400 for the tank, parts Thursday, he's confirming with
 * his wife". Anything past two minutes is a phone in a pocket, and paying per
 * audio minute for that is the runaway this bounds. The client enforces it too;
 * this is the one that counts.
 */
export const CALL_WRAPUP_MAX_SECONDS = 120;

/**
 * Largest upload we will read, in bytes.
 *
 * A second gate on the same runaway, because seconds are the CLIENT's claim
 * about the audio and bytes are a fact about the request. At a typical phone
 * codec, two minutes is a few hundred KB; 8 MB is generous for every encoding
 * and still far under the Worker's memory.
 */
export const CALL_WRAPUP_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Longest transcript we hand back. A note has to be readable, and a degenerate
 * model output repeating a syllable for pages helps nobody.
 */
export const CALL_WRAPUP_MAX_CHARS = 2000;

/** Never leave somebody staring at a spinner after a call: race the model. */
export const CALL_WRAPUP_TIMEOUT_MS = 20_000;

/**
 * Everything this cost center is allowed to do, declared once.
 */
export const CALL_WRAPUP_FEATURE_SPEC: AiFeatureSpec = {
  key: CALL_WRAPUP_FEATURE,
  label: "call wrap-up dictation",
  cap: CALL_WRAPUP_MONTHLY_CAP,
  unitCostCents: AI_UNIT_COST_CENTS.call_wrapup,
  alertThreshold: CALL_WRAPUP_ALERT_THRESHOLD,
  stops:
    "wrap-ups can still be typed into the note composer, just not dictated.",
  timeoutMs: CALL_WRAPUP_TIMEOUT_MS,
  enabled: (settings) => settings.call_wrapup,
  outcomes: {
    // All three are genuinely observable here, which is unusual — the member
    // is handed text and then visibly does one of three things with it. That
    // is the whole reason this returns the transcript instead of posting the
    // note itself: a suggestion somebody reads can be measured, and a note
    // written straight to the thread cannot.
    used: "posted as written",
    edited: "corrected before posting",
    discarded: "thrown away",
  },
};

/**
 * Is this dictation worth transcribing at all?
 *
 * Both gates are free and run before the reservation, per the cost posture: a
 * recording of nothing, or one that ran away, must not spend.
 */
export function shouldTranscribeWrapUp(args: {
  seconds: number;
  bytes: number;
}): boolean {
  if (args.bytes <= 0 || args.bytes > CALL_WRAPUP_MAX_BYTES) return false;
  return args.seconds > 0 && args.seconds <= CALL_WRAPUP_MAX_SECONDS;
}

/**
 * The transcript, cleaned up, or null when there is nothing usable.
 *
 * Whitespace only — no rewriting, no truncation of meaning, no sentence
 * casing. See the verbatim argument above: the value of this text is that it is
 * what the person said.
 */
export function sanitizeWrapUp(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  // Collapse the runs Whisper leaves around pauses, and normalise the line
  // endings so a note does not arrive with a mix of both.
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.length > CALL_WRAPUP_MAX_CHARS
    ? cleaned.slice(0, CALL_WRAPUP_MAX_CHARS).trimEnd()
    : cleaned;
}
