import type { ImportResult } from "@/lib/api/types";

/**
 * Shared import-summary formatting for the vCard and phone-picker dialogs
 * (D20 §3.2/§3.3). Both surfaces render the API's authoritative
 * { imported, updated, skipped, errors } identically, so the counting/labeling
 * lives here once instead of drifting between two dialogs. Pure + DOM-free so
 * the summary is unit-testable.
 */

export interface ImportSummary {
  /** "3 new, 1 updated, 2 skipped." — the one-line headline. */
  headline: string;
  /** True when at least one row was skipped (drives the error list render). */
  hasErrors: boolean;
  /** The per-row reasons to show, capped, with the overflow count. */
  visibleErrors: { row: number; reason: string }[];
  /** How many errors were hidden beyond the cap (0 when none). */
  hiddenErrorCount: number;
}

/** Default cap on how many skip reasons a summary lists inline. */
export const DEFAULT_ERROR_CAP = 50;

export function summarizeImport(
  result: ImportResult,
  cap: number = DEFAULT_ERROR_CAP,
): ImportSummary {
  const visibleErrors = result.errors.slice(0, Math.max(0, cap));
  return {
    headline:
      `${result.imported.toLocaleString()} new, ` +
      `${result.updated.toLocaleString()} updated, ` +
      `${result.skipped.toLocaleString()} skipped.`,
    hasErrors: result.errors.length > 0,
    visibleErrors,
    hiddenErrorCount: result.errors.length - visibleErrors.length,
  };
}
