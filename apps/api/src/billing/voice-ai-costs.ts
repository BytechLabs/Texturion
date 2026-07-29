/**
 * #397 / #367 — what an AI receptionist would actually cost us per minute.
 *
 * #397 argues the category (priced $199–$499/mo) is buying our customers' phone
 * numbers, and that we hold the number and the voice stack already. Its asks 3
 * and 4 are a pricing decision and a sequencing decision, and both rested on one
 * asserted figure: "$16–$30/mo in raw model cost" for a 200-minute contractor.
 * Its own final comment says that figure "deserves the same treatment as the
 * $189k, which is to say it should be measured before it is planned against."
 *
 * This measures it, from the vendor we are already on, on 2026-07-29.
 *
 * WHAT THE MEASUREMENT CHANGED. The conclusion survives and one premise does
 * not. A 200-minute month costs **$13.60**, not $16–$30 — so #397's stronger
 * claim, that the cost "equals or exceeds our entire $29 plan revenue", is
 * false: it is 47% of it. The conclusion it supported is unaffected and now
 * measured rather than assumed — 47% of ARPU cannot be given away inside a $29
 * plan, so this is necessarily a metered paid module (#12), exactly as #397 says.
 *
 * WHY TELNYX RATHER THAN A PIPELINE WE ASSEMBLE. Cloudflare Workers AI can do
 * the pieces cheaply (Whisper $0.0005/audio-min, melotts $0.0002/audio-min), and
 * that is the arithmetic that makes a build look tempting. It is not the honest
 * comparison: a receptionist is a REALTIME conversation — turn-taking, barge-in,
 * interruption handling — and those parts are the product, not the transcription.
 * Telnyx sells that layer for $0.05/min against our existing account, and D76
 * already established the calls runtime is Telnyx-shaped and would be a rewrite
 * elsewhere. So the priced path is the one we could actually ship.
 *
 * THESE ARE EXTERNAL FIGURES AND THEY MOVE — same posture as
 * `carrier-list-prices.ts`: sourced, dated, and with a recheck a test fails on.
 */

/** When these figures were read off the vendors' published pages. */
export const VOICE_AI_PRICES_VERIFIED_ON = "2026-07-29";

/** Re-read by this date; a test fails once it passes. */
export const VOICE_AI_PRICES_RECHECK_AFTER = "2027-01-29";

/**
 * Per-minute cost components in CENTS, each at the top of its published range —
 * the never-under-count rule this file's neighbour states.
 *
 * Source: telnyx.com/pricing/conversational-ai (2026-07-29).
 */
export const VOICE_AI_COST_CENTS_PER_MINUTE = {
  /**
   * The voice engine: orchestration (turn-taking, interruption handling, tools,
   * knowledge retrieval) PLUS speech-to-text and text-to-speech, in one rate.
   * $0.05/min.
   */
  engine: 5.0,
  /**
   * LLM tokens on Telnyx-owned GPUs, published as $0.003–$0.006/min. The TOP of
   * the range is carried. A managed frontier model (Anthropic/OpenAI) is
   * pass-through and would cost materially more — that is a per-deployment
   * choice, not a platform rate, so it is deliberately not modelled here.
   */
  llm: 0.6,
  /**
   * The call leg itself. Telnyx quotes inbound SIP from $0.0032/min, but we
   * already carry voice at {@link UNIT_COST_CENTS.voiceMinute} = 1.2¢/min — a
   * measured, both-legs figure — and using their floor here while the rest of
   * the product uses ours would make this line optimistic against our own model.
   */
  telephony: 1.2,
} as const;

/** All-in cost of one receptionist minute, in cents. 6.8¢ as of the date above. */
export const VOICE_AI_TOTAL_CENTS_PER_MINUTE =
  VOICE_AI_COST_CENTS_PER_MINUTE.engine +
  VOICE_AI_COST_CENTS_PER_MINUTE.llm +
  VOICE_AI_COST_CENTS_PER_MINUTE.telephony;

/**
 * #397's own reference contractor: 100 calls/month averaging two minutes.
 * Kept as a named constant because every figure below is quoted against it, and
 * a scenario that drifts silently makes the comparisons meaningless.
 */
export const REFERENCE_MINUTES_PER_MONTH = 200;

/** What one reference contractor costs us per month, in cents. */
export function referenceMonthlyCostCents(): number {
  return VOICE_AI_TOTAL_CENTS_PER_MINUTE * REFERENCE_MINUTES_PER_MONTH;
}

/**
 * Minutes at which a tenant's receptionist usage consumes ALL of a given
 * monthly revenue — the point past which the module loses money on that tenant.
 *
 * This is the number the cost-protection mandate needs: a metered module without
 * a computed cap is a cost centre with no ceiling, and voice is the most
 * expensive per-unit thing this product touches. Floored, because a partial
 * minute past break-even is still past it.
 */
export function breakEvenMinutes(monthlyRevenueCents: number): number {
  if (monthlyRevenueCents <= 0) return 0;
  return Math.floor(monthlyRevenueCents / VOICE_AI_TOTAL_CENTS_PER_MINUTE);
}

/**
 * Gross margin on the module at a given price and usage, as a fraction of
 * revenue. Negative once usage passes {@link breakEvenMinutes}.
 */
export function grossMarginFraction(
  monthlyRevenueCents: number,
  minutesUsed: number,
): number {
  if (monthlyRevenueCents <= 0) return 0;
  const cost = VOICE_AI_TOTAL_CENTS_PER_MINUTE * minutesUsed;
  return (monthlyRevenueCents - cost) / monthlyRevenueCents;
}

/**
 * The category's published price band for a solo practice, for the comparison
 * #397 ask 3 turns on: price against the category, not against our own plan.
 *
 * Sources are listed on #397 (plura.ai, agentzap.ai, 2026-07-26).
 */
export const CATEGORY_PRICE_CENTS_PER_MONTH = { low: 19_900, high: 49_900 } as const;

/**
 * The module price band #397 ask 3 proposes ($49–$79/mo), carried here so the
 * margin and break-even numbers have a subject.
 *
 * NOT a decision — the price is the founder's call, and this file exists to make
 * that call against measured numbers instead of an asserted range.
 */
export const PROPOSED_MODULE_PRICE_CENTS = { low: 4_900, high: 7_900 } as const;
