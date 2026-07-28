/**
 * #351 — the carrier ceiling nobody was told about.
 *
 * Every tenant is registered on a 10DLC use case, and the use case carries a
 * throughput ceiling the CARRIERS enforce — not us. It was a bare string
 * literal at one call site, recorded nowhere, disclosed nowhere, and monitored
 * nowhere. The first signal a growing customer would get is sends failing on
 * their busiest day, with nothing to distinguish a registration-tier ceiling
 * from a bug, an outage, or something they did.
 *
 * That is the one place this product does not apply its own honest-failure
 * rule. The composer banners name the exact gate everywhere else; here there
 * was no name to give.
 *
 * THESE NUMBERS ARE EXTERNAL AND THEY MOVE. They are dated and sourced on
 * purpose, and `TEN_DLC_CEILINGS_RECHECK_AFTER` makes the staleness a thing a
 * test can fail on rather than a promise in a comment. Do not edit a figure
 * here without replacing the source and the date with it.
 */

export type TenDlcUseCase = "LOW_VOLUME" | "SOLE_PROPRIETOR";

export interface CarrierCeiling {
  carrier: string;
  /** Messages per day, or null when the carrier limits by rate instead. */
  perDay: number | null;
  /** Segments per minute, or null when the carrier limits by daily volume. */
  perMinute: number | null;
  note: string;
}

export interface TierCeiling {
  useCase: TenDlcUseCase;
  /** What a customer would call this tier. */
  label: string;
  carriers: readonly CarrierCeiling[];
  /**
   * The daily figure that actually bites first, across carriers.
   *
   * T-Mobile publishes a per-BRAND daily cap and is the binding one for both
   * tiers we use. AT&T limits by rate rather than by day, so it constrains a
   * burst rather than a total.
   */
  bindingDailyMessages: number;
  /** Whether vetting can raise it, which decides whether there is a path up. */
  vettingCanRaise: boolean;
}

/** When these figures were last checked against the carriers' published rules. */
export const TEN_DLC_CEILINGS_VERIFIED_ON = "2026-07-28";

/**
 * Re-check by this date. #326's revisit trigger, as a value rather than a
 * promise — a test fails when it passes, which is the only kind of reminder
 * that survives a busy quarter.
 */
export const TEN_DLC_CEILINGS_RECHECK_AFTER = "2027-01-28";

export const TEN_DLC_CEILINGS: Record<TenDlcUseCase, TierCeiling> = {
  LOW_VOLUME: {
    useCase: "LOW_VOLUME",
    label: "Low Volume Standard",
    carriers: [
      {
        carrier: "T-Mobile",
        perDay: 2_000,
        perMinute: null,
        note: "Per BRAND per day, not per number and not per campaign. Counts only messages to T-Mobile subscribers.",
      },
      {
        carrier: "AT&T",
        perDay: null,
        perMinute: 75,
        note: "Segments per minute. Constrains a burst rather than a daily total.",
      },
    ],
    bindingDailyMessages: 2_000,
    // The trade-off that makes this tier the right default for D12's ICP: no
    // secondary vetting to get in, and no vetting to get out either. A customer
    // who outgrows it re-registers rather than appealing.
    vettingCanRaise: false,
  },
  SOLE_PROPRIETOR: {
    useCase: "SOLE_PROPRIETOR",
    label: "Sole Proprietor",
    carriers: [
      {
        carrier: "T-Mobile",
        perDay: 1_000,
        perMinute: null,
        note: "Segments per day for a sole-proprietor brand. Half the Low Volume Standard allowance.",
      },
    ],
    bindingDailyMessages: 1_000,
    vettingCanRaise: false,
  },
};

/** The daily ceiling a tenant on `useCase` will actually hit first. */
export function dailyCeiling(useCase: TenDlcUseCase): number {
  return TEN_DLC_CEILINGS[useCase].bindingDailyMessages;
}

/**
 * Warn at 80% of the ceiling, the same fraction the segment, storage and voice
 * arms already use. Consistency matters more than tuning here: a customer who
 * has learned what an 80% warning feels like should not have to learn a second
 * shape for this one.
 */
export const CARRIER_CEILING_WARN_FRACTION = 0.8;

/** Has this tenant sent enough today that the ceiling is worth mentioning? */
export function approachingCarrierCeiling(
  sentToday: number,
  useCase: TenDlcUseCase,
): boolean {
  return sentToday >= dailyCeiling(useCase) * CARRIER_CEILING_WARN_FRACTION;
}
