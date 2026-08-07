import type { ImportResult } from "@/lib/api/types";

import { csvEscape } from "./csv-import";

/**
 * Shared import-summary formatting for the three import doors (D20 §3.2/§3.3
 * and the CSV wizard). All of them render the API's authoritative
 * { imported, updated, skipped, errors } identically, so the counting/labeling
 * lives here once instead of drifting between dialogs. Pure + DOM-free so
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

/**
 * #248 — what an import could NOT attest, and about whom.
 *
 * Counted apart from `summarizeImport` rather than folded into its headline.
 * These rows imported: putting them in a fourth slot beside new/updated/skipped
 * would read as a fourth kind of failure, and the one thing the reader must not
 * conclude is that those people are missing from their list. They are in it, and
 * blocked, which is a different sentence and gets its own block.
 */
export interface ConsentRefusalSummary {
  /** How many rows the server refused an attestation for. */
  count: number;
  /** The server's explanation, or null when there is nothing to explain. */
  note: string | null;
  /** The per-row reasons to show, capped. */
  visible: { row: number; reason: string }[];
  /** How many were hidden beyond the cap (0 when none). */
  hiddenCount: number;
}

export function summarizeConsentRefusals(
  result: ImportResult,
  cap: number = DEFAULT_ERROR_CAP,
): ConsentRefusalSummary {
  // Defaulted rather than asserted: an API deployed before #248 answers without
  // these fields, and a client that read `.length` off the missing one would
  // throw on a successful import for the length of a rollout.
  const refusals = result.consent_refusals ?? [];
  const visible = refusals.slice(0, Math.max(0, cap));
  // The server's own count, not `refusals.length` — the two agree today, and
  // if they ever stop, the number the audit row recorded is the true one.
  const count = result.consent_refused ?? 0;
  return {
    count,
    note: result.consent_refused_note ?? null,
    visible,
    // Overflow measured against BOTH, because the two halves of the same answer
    // can disagree and the screen must not quietly pick the flattering one. A
    // response saying `consent_refused: 40` with five rows in the list rendered
    // as a headline of 40 above a list of 5 and no overflow line at all — the
    // reader is left to conclude the other 35 are in the five they can see.
    // Whichever number is larger is the one there is more of to hide.
    hiddenCount: Math.max(count, refusals.length) - visible.length,
  };
}

/**
 * The refused rows as a file.
 *
 * The on-screen list is capped, and the workspace's own audit row keeps only
 * the COUNT — so without this, the identities of the people an import refused
 * to attest for exist nowhere but a dialog that dies with the tab. The whole
 * point of an attestation is a record somebody can point at months later; a
 * record with a hole in it and no way to read the hole is the defect this
 * feature was built to close.
 *
 * Built from the response alone, so it works the same on all three doors —
 * the phone-picker and .vcf dialogs have no uploaded rows to join back to.
 */
export function consentRefusalsCsv(
  refusals: readonly { row: number; reason: string }[],
): string {
  const lines = [["row", "reason"].map(csvEscape).join(",")];
  for (const refusal of refusals) {
    lines.push([String(refusal.row), csvEscape(refusal.reason)].join(","));
  }
  return lines.join("\r\n");
}

/** Filename for {@link consentRefusalsCsv}, shared so all three doors agree. */
export const CONSENT_REFUSALS_FILENAME = "already-opted-out.csv";
