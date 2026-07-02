/**
 * Overage-cap control logic for /settings/usage (G8, SPEC §2): presets
 * 2×/3×/5×/No cap, owner-only, every change confirmed with a plain sentence
 * describing what will happen. Pure logic — the component renders it.
 */

/** The G8 preset multipliers; null = no cap (SPEC §2). */
export const CAP_PRESETS: readonly (number | null)[] = [2, 3, 5, null];

/**
 * `companies.overage_cap_multiplier` arrives as a Postgres numeric — the API
 * passes it through as a number OR a string ("3.00"). Normalize to a plain
 * number (or null = no cap) before comparing against presets.
 */
export function normalizeMultiplier(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "2×", "2.5×", or "No cap". Trailing zeros dropped ("3.00" → "3×"). */
export function capLabel(multiplier: number | null): string {
  if (multiplier === null) return "No cap";
  return `${String(multiplier)}×`;
}

/**
 * Total segments allowed per period under a cap — mirrors GET /v1/usage:
 * `Math.round(included × multiplier)`; null = no cap.
 */
export function capSegments(
  includedSegments: number,
  multiplier: number | null,
): number | null {
  return multiplier === null
    ? null
    : Math.round(includedSegments * multiplier);
}

export type CapChangeKind = "same" | "raise" | "lower" | "remove" | "add";

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
 */
export function describeCapChange(
  current: number | null,
  next: number | null,
  includedSegments: number,
): CapChange {
  if (current === next) {
    return { kind: "same", requiresConfirmation: false, summary: "" };
  }

  if (next === null) {
    return {
      kind: "remove",
      requiresConfirmation: true,
      summary:
        "Sending never pauses. Every message over your " +
        `${includedSegments.toLocaleString()} included is billed at the overage rate, with no limit.`,
    };
  }

  const nextTotal = capSegments(includedSegments, next) as number;
  if (current === null) {
    return {
      kind: "add",
      requiresConfirmation: true,
      summary: `Sending pauses at ${nextTotal.toLocaleString()} messages this period (${includedSegments.toLocaleString()} included plus overage).`,
    };
  }

  if (next > current) {
    return {
      kind: "raise",
      requiresConfirmation: true,
      summary: `Sending pauses at ${nextTotal.toLocaleString()} messages this period instead of ${(
        capSegments(includedSegments, current) as number
      ).toLocaleString()}.`,
    };
  }

  return {
    kind: "lower",
    requiresConfirmation: true,
    summary: `Sending pauses at ${nextTotal.toLocaleString()} messages this period. If you're already past that, sends pause right away.`,
  };
}
