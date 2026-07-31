/**
 * #461 — "Audits show change of entire sections even if a single field is
 * modified... this needs to be architected better."
 *
 * It did. Two things were wrong with every settings row we wrote:
 *
 * 1. **The whole section went in.** The AI-settings route recorded all five
 *    switches on every save, so flipping one produced a row that named five —
 *    and a reader could not tell which one moved. The company route recorded
 *    the requested patch, which is closer but still logs a field that was
 *    "changed" to the value it already had.
 * 2. **`before` was always empty.** The table has the column; nothing filled
 *    it. So even a correctly-scoped row said "this is now false" without
 *    saying what it was, which is the half of the question anybody asking has.
 *
 * This computes the real diff: the keys whose value actually MOVED, with both
 * sides. A save that changed nothing returns null, and the caller writes no
 * row at all — an audit log that records non-events trains people to skim it.
 *
 * The redaction rule from the write path is preserved and made harder to get
 * wrong: customer-facing text (an away message, a voicemail greeting) never
 * enters the log, but the FACT that it changed does. See {@link redactText}.
 */

/** The shape a caller hands us: a flat settings row. */
export type AuditFields = Record<string, unknown>;

export interface AuditDelta {
  before: AuditFields;
  after: AuditFields;
}

/**
 * The redactor for authored, customer-facing text.
 *
 * Reports presence, never content, and distinguishes the three transitions a
 * reader cares about:
 *
 *   null → text   "set"
 *   text → null   "cleared"
 *   text → text'  "edited"
 *
 * "edited" matters: without it a reworded away message logs as `set → set`,
 * which reads like a no-op row and invites the next person to assume the log
 * is noisy. It says a change happened and still says nothing about the words.
 */
export function redactText(
  before: unknown,
  after: unknown,
): { before: string; after: string } {
  const had = typeof before === "string" && before.trim() !== "";
  const has = typeof after === "string" && after.trim() !== "";
  if (had && has) return { before: "edited", after: "edited" };
  return {
    before: had ? "set" : "cleared",
    after: has ? "set" : "cleared",
  };
}

/** Values compare by identity for primitives and by JSON for the rest. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and undefined both mean "no value" to a settings reader; treating
  // them as different would log a change every time a column was added.
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface AuditDiffOptions {
  /**
   * Keys whose VALUE must never reach the log (authored customer-facing text).
   * They still appear in the diff when they change — as set/cleared/edited.
   */
  textKeys?: readonly string[];
  /**
   * Restrict the comparison to these keys. Without it every key present in
   * either object is compared, which is what a full row wants; with it, a
   * caller holding a wide row can audit only the part it owns.
   */
  only?: readonly string[];
}

/**
 * The keys that actually moved, with both sides — or null when nothing did.
 *
 * A key present in `before` and absent from `after` is NOT a change: settings
 * PATCHes are partial, and the absent keys are the ones the caller did not
 * touch. Only keys present in `after` are considered.
 */
export function auditDiff(
  before: AuditFields,
  after: AuditFields,
  options: AuditDiffOptions = {},
): AuditDelta | null {
  const textKeys = new Set(options.textKeys ?? []);
  const only = options.only ? new Set(options.only) : null;
  const beforeOut: AuditFields = {};
  const afterOut: AuditFields = {};
  let changed = false;

  for (const key of Object.keys(after)) {
    if (only && !only.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (same(a, b)) continue;
    changed = true;
    if (textKeys.has(key)) {
      const redacted = redactText(a, b);
      beforeOut[key] = redacted.before;
      afterOut[key] = redacted.after;
    } else {
      beforeOut[key] = a ?? null;
      afterOut[key] = b ?? null;
    }
  }

  return changed ? { before: beforeOut, after: afterOut } : null;
}
