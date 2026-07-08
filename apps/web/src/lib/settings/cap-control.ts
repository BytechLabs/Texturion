/**
 * Overage-cap control logic for /settings/usage (G8, SPEC §2): presets
 * 2×/3×/5×/Maximum (10×), owner-only, every change confirmed with a plain
 * sentence describing what will happen. Pure logic — the component renders it.
 *
 * #42 honesty: there is no "no cap" any more. The API clamps a null cap to 10
 * (PATCH /v1/company) and the DB rejects anything outside (0, 10]
 * (companies_overage_cap_range CHECK, 20260704110000_hard_overage_ceiling.sql),
 * so the largest preset is the hard 10× ceiling and is labelled as such —
 * sending ALWAYS pauses at 10× included, and the UI must never promise
 * otherwise.
 */

/** The un-defeatable ceiling — mirrors the API clamp + DB CHECK ((0, 10]). */
export const MAX_CAP_MULTIPLIER = 10;

/** The G8 preset multipliers; the last one is the hard ceiling (SPEC §2). */
export const CAP_PRESETS: readonly number[] = [2, 3, 5, MAX_CAP_MULTIPLIER];

/**
 * `companies.overage_cap_multiplier` arrives as a Postgres numeric — the API
 * passes it through as a number OR a string ("3.00"). Normalize to a plain
 * number. The column is NOT NULL with CHECK (0, 10], so null/garbage can only
 * mean pre-migration data or a malformed payload — resolve it to the 10× hard
 * ceiling, exactly like the API resolves a null write.
 */
export function normalizeMultiplier(
  value: number | string | null | undefined,
): number {
  if (value === null || value === undefined) return MAX_CAP_MULTIPLIER;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.min(n, MAX_CAP_MULTIPLIER)
    : MAX_CAP_MULTIPLIER;
}

/**
 * "2×", "2.5×", or "Maximum (10×)" for the ceiling. Trailing zeros dropped
 * ("3.00" → "3×"). `null` is accepted for backward compatibility with callers
 * that haven't normalized yet — it means the ceiling, same as the API.
 */
export function capLabel(multiplier: number | null): string {
  if (multiplier === null || multiplier >= MAX_CAP_MULTIPLIER) {
    return `Maximum (${MAX_CAP_MULTIPLIER}×)`;
  }
  return `${String(multiplier)}×`;
}

/**
 * Total segments allowed per period under a cap — mirrors GET /v1/usage:
 * `Math.round(included × multiplier)`. `null` resolves to the 10× ceiling
 * (there is no uncapped state; the API clamps null to 10).
 */
export function capSegments(
  includedSegments: number,
  multiplier: number | null,
): number {
  return Math.round(
    includedSegments * (multiplier ?? MAX_CAP_MULTIPLIER),
  );
}

export type CapChangeKind = "same" | "raise" | "lower";

export interface CapChange {
  kind: CapChangeKind;
  /** True whenever the value actually changes — every change is confirmed. */
  requiresConfirmation: boolean;
  /** One G10 sentence for the confirmation dialog ("" when nothing changes). */
  summary: string;
}

/**
 * Describe a cap change for the confirmation dialog. Selecting the current
 * value is a no-op (no dialog); everything else needs an explicit confirm.
 * `null` on either side resolves to the 10× ceiling (see normalizeMultiplier),
 * so a legacy "no cap" value and the Maximum preset compare as the same thing.
 */
export function describeCapChange(
  current: number | null,
  next: number | null,
  includedSegments: number,
): CapChange {
  const currentValue = current ?? MAX_CAP_MULTIPLIER;
  const nextValue = next ?? MAX_CAP_MULTIPLIER;

  if (currentValue === nextValue) {
    return { kind: "same", requiresConfirmation: false, summary: "" };
  }

  const nextTotal = capSegments(includedSegments, nextValue);
  const currentTotal = capSegments(includedSegments, currentValue);

  if (nextValue > currentValue) {
    const atCeiling = nextValue >= MAX_CAP_MULTIPLIER;
    return {
      kind: "raise",
      requiresConfirmation: true,
      summary: atCeiling
        ? `Sending pauses at ${nextTotal.toLocaleString()} messages this period instead of ${currentTotal.toLocaleString()}. That's the highest the cap goes. Every message over your ${includedSegments.toLocaleString()} included is billed at the overage rate until sending pauses.`
        : `Sending pauses at ${nextTotal.toLocaleString()} messages this period instead of ${currentTotal.toLocaleString()}.`,
    };
  }

  return {
    kind: "lower",
    requiresConfirmation: true,
    summary: `Sending pauses at ${nextTotal.toLocaleString()} messages this period. If you're already past that, sends pause right away.`,
  };
}
