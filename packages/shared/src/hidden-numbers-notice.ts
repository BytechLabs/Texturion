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
/** Every catalogue key this module names. */
export type HiddenNumbersKey =
  | "domain.hiddenNumbersOne"
  | "domain.hiddenNumbersMany";

/** The reader's resolver. */
export type SayHiddenNumbers = (key: HiddenNumbersKey) => string;

export function hiddenNumbersNotice(
  hiddenCount: number,
  say: SayHiddenNumbers,
): string | null {
  if (hiddenCount <= 0) return null;
  // One and many are separate keys. French agrees the verb and the article
  // with the count — "Un autre numéro se trouve" against "{count} autres
  // numéros se trouvent" — so a single template could not carry both.
  return hiddenCount === 1
    ? say("domain.hiddenNumbersOne")
    : say("domain.hiddenNumbersMany").replace("{count}", String(hiddenCount));
}
