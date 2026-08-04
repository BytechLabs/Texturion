/**
 * #286 — saying that a number is missing, rather than letting it be missing.
 *
 * Per-number access (#106) filters the numbers list server-side, and the
 * filter is silent. A tech who knows the shop runs two lines, opens the
 * composer's "text from" picker and finds one, has no way to tell whether
 * that is a permission or a bug — and the person they ask is the owner, who
 * then has to work out that they configured it deliberately months ago.
 *
 * ── WHY A COUNT AND NOT THE NUMBERS ───────────────────────────────────────
 *
 * Naming them would undo the rule this sentence exists to explain. A member
 * does not need to know WHICH line exists to understand that one does, and
 * "the sales line" is exactly the detail an access rule was drawn to keep
 * from them.
 *
 * ── WHY IT NAMES THE OWNER AS THE ROUTE ───────────────────────────────────
 *
 * The member cannot change this and should not be sent looking for a setting.
 * The one useful action is asking the person who set it.
 */
export function hiddenNumbersNotice(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  return hiddenCount === 1
    ? "One more number is on this account that is not shared with you. Ask an owner if you need it."
    : `${hiddenCount} more numbers are on this account that are not shared with you. Ask an owner if you need them.`;
}
