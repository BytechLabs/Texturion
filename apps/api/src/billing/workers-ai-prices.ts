/**
 * The published Workers AI rates, as DATA rather than as prose.
 *
 * `AI_UNIT_COST_CENTS` prices one request of each AI cost centre from the bounds
 * that feature enforces multiplied by the provider's per-token rate. Until this
 * file existed the bounds were shipped constants a guard could execute and the
 * RATES were sentences in a comment, so the arithmetic could be re-derived and
 * the multiplier could not. A verifier made the point exactly: lower the output
 * rate the thread catch-up prices against from $0.384 to $0.045 and 104 of 104
 * tests stay green, because every guard downstream re-derived from the number
 * that had just been changed.
 *
 * WHAT PINS A FIGURE HERE, since a test cannot phone Cloudflare:
 *
 *   1. ONE HOME. Each rate is written once and looked up by model id, so a
 *      feature cannot carry a private copy that drifts. `reply-suggestions.ts`
 *      is what that costs: it has cited $0.287 per million output tokens since
 *      it was written, which is a real published rate for a NEIGHBOURING model
 *      and has never been the one it bills against.
 *   2. THE AUDIT. `docs/PRICING-AUDIT.md` §4.2 is what `costs.ts` names as its
 *      cost basis, and the guard beside this file asserts every figure here
 *      appears in that table. Changing a rate in code without re-auditing it
 *      fails; so does changing the audit alone.
 *   3. THE DERIVATION, two-sided. A carried unit cost must be its derivation
 *      rounded UP to the next hundredth of a cent — not merely at or above it.
 *      That is what makes a cheaper rate fail: it drags the derivation down a
 *      whole step and the carried figure stops being a rounding of anything.
 *   4. STALENESS. `WORKERS_AI_PRICES_RECHECK_AFTER` is a date a test fails on,
 *      the same posture as `carrier-list-prices.ts` and
 *      `packages/shared/src/carrier-throughput.ts`.
 *
 * WHAT NONE OF THAT BUYS IS A CORRECT RATE. These are transcribed numbers, and
 * the four rules above make transcription auditable, dated and single-sourced —
 * they do not make it true. `publishedAs` is where that honesty is kept: see
 * the 8B entry, whose figures the pricing table carries under a neighbouring
 * model id rather than under the id this product actually calls.
 */

/** When every figure here was last read against the published table. */
export const WORKERS_AI_PRICES_VERIFIED_ON = "2026-07-28";

/**
 * Re-read the page by this date. Six months, matching `carrier-list-prices.ts`:
 * long enough not to be busywork, short enough that a repricing does not sit
 * undetected through a whole planning cycle. A test fails when it passes.
 */
export const WORKERS_AI_PRICES_RECHECK_AFTER = "2027-01-28";

/** The vendor page every figure here was read from. */
export const WORKERS_AI_PRICES_SOURCE =
  "developers.cloudflare.com/workers-ai/platform/pricing";

/** This repo's own audited copy of the same table, which a guard reads. */
export const WORKERS_AI_PRICES_AUDIT = "docs/PRICING-AUDIT.md";

export interface WorkersAiTokenPrice {
  /** USD per million INPUT tokens. */
  usdPerMillionInput: number;
  /** USD per million OUTPUT tokens. On every model here, the expensive half. */
  usdPerMillionOutput: number;
  /**
   * The exact model id the published table carries these figures under.
   *
   * Equal to the key on a model we can price directly. DIFFERENT from the key
   * when the id we call is absent from the table, which is a gap being admitted
   * rather than a rate being invented — the same posture as
   * `CarrierListPrice.unpublished`.
   */
  publishedAs: string;
  /** Why `publishedAs` differs from the key, or "" when it does not. */
  gap: string;
}

/**
 * Per-token rates, keyed by the model id this product actually passes to
 * `env.AI.run`.
 *
 * Keyed on OUR id and not on the vendor's, because the question a cost model
 * asks is "what does the call we make cost", and a table keyed on the vendor's
 * naming would answer a different one silently.
 */
export const WORKERS_AI_TOKEN_PRICES: Readonly<
  Record<string, WorkersAiTokenPrice>
> = {
  /**
   * Reply drafting, voicemail intake and the thread catch-up all run here.
   *
   * THE FIGURES ARE PUBLISHED UNDER A DIFFERENT ID. The pricing table has rows
   * for `@cf/meta/llama-3.1-8b-instruct`, `-instruct-fp8`, `-instruct-awq` and
   * `-instruct-fp8-fast`; $0.045 / $0.384 is the last of those. There is no row
   * for `-instruct-fast`, and that model's own page states no price, so the
   * figure this product bills against is read across from its nearest
   * neighbour. It is recorded rather than smoothed over because the other
   * published 8B rows are 3.4x and 6.3x these on input — if the id we call is
   * priced like one of THOSE instead, `AI_UNIT_COST_CENTS` under-counts three
   * cost centres, against the never-under-count rule `costs.ts` opens with.
   * Settling it needs a rate a Cloudflare invoice confirms, which is the only
   * evidence stronger than a docs page.
   */
  "@cf/meta/llama-3.1-8b-instruct-fast": {
    usdPerMillionInput: 0.045,
    usdPerMillionOutput: 0.384,
    publishedAs: "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
    gap:
      "the pricing table has no row for -instruct-fast and the model page " +
      "states no price; these are the -instruct-fp8-fast figures read across",
  },
  /** Task enrichment. Published under the id we call. */
  "@cf/meta/llama-3.2-1b-instruct": {
    usdPerMillionInput: 0.027,
    usdPerMillionOutput: 0.201,
    publishedAs: "@cf/meta/llama-3.2-1b-instruct",
    gap: "",
  },
};

/**
 * Per-audio-minute rates, for the models billed by duration rather than tokens.
 */
export const WORKERS_AI_AUDIO_PRICES: Readonly<Record<string, number>> = {
  /** Voicemail transcripts and crew wrap-up dictation. */
  "@cf/openai/whisper-large-v3-turbo": 0.0005,
};

/**
 * Models this product can call that nothing here prices, with the reason.
 *
 * An admitted gap, never a zero — a zero is a claim that a call is free. The
 * guard beside this file asserts every shipped model constant is either priced
 * above or listed here, so a NEW model cannot arrive unpriced and unremarked.
 */
export const WORKERS_AI_UNPRICED: Readonly<Record<string, string>> = {
  "@cf/openai/whisper":
    "the fallback voicemail-transcript model, reached only when the turbo " +
    "model errors. Unpriced in docs/PRICING-AUDIT.md §4.2, so pricing it here " +
    "would be inventing a figure. It rides inside voicemail_transcript's own " +
    "0.25c, which is already sized for a 5-minute recording against a typical " +
    "sub-minute one.",
};

/** The per-token rate for `model`, or a throw. Never a guess, never a zero. */
export function workersAiTokenPrice(model: string): WorkersAiTokenPrice {
  const found = WORKERS_AI_TOKEN_PRICES[model];
  if (!found) {
    throw new Error(
      `no Workers AI token price recorded for ${model} — add it to ` +
        `workers-ai-prices.ts with its source, or a cost centre is unpriced`,
    );
  }
  return found;
}

/** The per-audio-minute rate for `model`, or a throw. */
export function workersAiAudioPrice(model: string): number {
  const found = WORKERS_AI_AUDIO_PRICES[model];
  if (found === undefined) {
    throw new Error(
      `no Workers AI audio price recorded for ${model} — add it to ` +
        `workers-ai-prices.ts with its source, or a cost centre is unpriced`,
    );
  }
  return found;
}
