/**
 * #241 — published carrier list prices, so the second-carrier question is a
 * calculation instead of a conversation.
 *
 * D76 accepted single-vendor risk deliberately, and the one acceptance criterion
 * left open was a COSTED comparison. The previous pass left the numbers out
 * because it could not verify them. They are verifiable: every figure below was
 * read off the vendor's own published pricing page on
 * {@link CARRIER_PRICES_VERIFIED_ON}, and each carries the URL it came from.
 *
 * THESE NUMBERS ARE EXTERNAL AND THEY MOVE — the same posture as
 * `packages/shared/src/carrier-throughput.ts`. `CARRIER_PRICES_RECHECK_AFTER`
 * makes staleness something a test fails on rather than a promise in a comment.
 * Do not edit a figure here without replacing its source and the date with it.
 *
 * TWO THINGS THAT ARE NOT LIST PRICE, and the comparison is wrong without them:
 *
 * 1. **Carrier fees are pass-through.** The US carriers set a per-message
 *    surcharge by DESTINATION carrier; every A2P vendor passes it on at cost.
 *    So it is common to all of them and cancels out of a vendor comparison. The
 *    part a vendor actually controls — and the only part worth comparing — is
 *    the BASE rate, which is what `baseOutboundUsd` holds.
 * 2. **List is not negotiated.** Volume rates differ, sometimes a lot. These
 *    figures bound the DIRECTION and rough SIZE of a switch, which is what the
 *    decision needs; they are not a quote.
 *
 * The cross-check this file exists to enable lives in the test beside it: our
 * modeled unit costs (`costs.ts`) must never fall BELOW the incumbent's
 * published floor, because that file's whole posture is never-under-count.
 */

/** When every figure here was last read off the vendor's published page. */
export const CARRIER_PRICES_VERIFIED_ON = "2026-07-29";

/**
 * Re-read the pages by this date. Six months: long enough not to be busywork,
 * short enough that a repricing does not sit undetected through a whole
 * planning cycle. A test fails when this date passes.
 */
export const CARRIER_PRICES_RECHECK_AFTER = "2027-01-29";

export interface CarrierListPrice {
  vendor: string;
  /**
   * Per-message BASE rate, outbound US long code / 10DLC, in USD. Excludes the
   * pass-through carrier surcharge (see the header) — this is the vendor's own
   * take, and the only figure that changes when we change vendors.
   */
  baseOutboundUsd: number;
  /** Per-message base rate, inbound US long code, USD. Null when unpublished. */
  baseInboundUsd: number | null;
  /** Per-minute inbound to a US local number, USD. Null when unpublished. */
  voiceInboundUsdPerMin: number | null;
  /** Per-minute outbound to a US local number, USD. Null when unpublished. */
  voiceOutboundUsdPerMin: number | null;
  /**
   * Monthly rental of one US local number, USD, INCLUDING whatever the vendor
   * charges to make it text-capable. Null when unpublished.
   */
  numberMonthlyUsd: number | null;
  /** Where these figures were read from. */
  source: string;
  /** What the page does not say, so a gap is never mistaken for a zero. */
  unpublished: readonly string[];
}

/**
 * The incumbent and the two alternatives whose rates are actually published.
 *
 * Vonage and Sinch are deliberately absent: as of the verification date their
 * pricing pages are not publicly retrievable (403 / 404 — rates sit behind a
 * "contact us" quote form). Listing them with invented numbers would be the
 * unverified-assertion failure this file exists to avoid; the structural
 * comparison for both stays in docs/CARRIER-PORTABILITY.md §3.
 */
export const CARRIER_LIST_PRICES: readonly CarrierListPrice[] = [
  {
    vendor: "Telnyx (incumbent)",
    baseOutboundUsd: 0.004,
    baseInboundUsd: 0.004,
    // The published SIP page quotes inbound LOCAL globally rather than per
    // country, and breaks out no US outbound rate at all.
    voiceInboundUsdPerMin: 0.0032,
    voiceOutboundUsdPerMin: null,
    // $1.00 number + $0.10 SMS/MMS capability.
    numberMonthlyUsd: 1.1,
    source:
      "telnyx.com/pricing/messaging, /pricing/elastic-sip, /pricing/numbers",
    unpublished: [
      "US outbound voice per-minute (page quotes international only)",
      "10DLC brand and campaign fees",
      "Canada rates broken out separately",
    ],
  },
  {
    vendor: "Bandwidth",
    baseOutboundUsd: 0.004,
    baseInboundUsd: null,
    voiceInboundUsdPerMin: 0.0055,
    voiceOutboundUsdPerMin: 0.01,
    numberMonthlyUsd: null,
    source: "bandwidth.com/pricing",
    unpublished: [
      "inbound SMS",
      "Canada SMS",
      "monthly per-number rental (directs to a custom quote)",
    ],
  },
  {
    vendor: "Twilio",
    baseOutboundUsd: 0.0083,
    baseInboundUsd: 0.0083,
    voiceInboundUsdPerMin: 0.0085,
    voiceOutboundUsdPerMin: 0.014,
    numberMonthlyUsd: 1.15,
    source:
      "twilio.com/en-us/sms/pricing/us, /sms/pricing/ca, /voice/pricing/us",
    unpublished: [],
  },
] as const;

/** The incumbent, by name — what a switch is measured against. */
export const INCUMBENT_VENDOR = "Telnyx (incumbent)";

export function listPrice(vendor: string): CarrierListPrice {
  const found = CARRIER_LIST_PRICES.find((p) => p.vendor === vendor);
  if (!found) throw new Error(`no list price recorded for ${vendor}`);
  return found;
}

/**
 * Extra cost per outbound US segment, in CENTS, of moving messaging to
 * `vendor` — the base-rate delta against the incumbent. Positive means the
 * switch costs us more per message. Carrier surcharges are excluded because
 * they are pass-through and identical (see the header).
 */
export function switchDeltaCentsPerSegment(vendor: string): number {
  const incumbent = listPrice(INCUMBENT_VENDOR).baseOutboundUsd;
  return (listPrice(vendor).baseOutboundUsd - incumbent) * 100;
}

/**
 * What a switch to `vendor` adds to ONE tenant's monthly bill, in cents, if
 * they use every included outbound segment. The honest framing of a carrier
 * move: not a rate card, a number against the $29.
 */
export function switchDeltaCentsPerTenantMonth(
  vendor: string,
  includedSegments: number,
): number {
  return switchDeltaCentsPerSegment(vendor) * includedSegments;
}

/**
 * Per-minute cost of a FORWARDED call at `vendor`, in cents: we pay for the
 * inbound leg AND the outbound leg we dial. This is the phone-bill shape the
 * cost model's `voiceMinute` estimates. Null when either leg is unpublished.
 */
export function forwardedCallCentsPerMinute(vendor: string): number | null {
  const p = listPrice(vendor);
  if (p.voiceInboundUsdPerMin === null || p.voiceOutboundUsdPerMin === null) {
    return null;
  }
  return (p.voiceInboundUsdPerMin + p.voiceOutboundUsdPerMin) * 100;
}
