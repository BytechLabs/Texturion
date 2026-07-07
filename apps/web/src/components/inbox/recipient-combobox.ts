/**
 * #63 — pure keyboard/ARIA helpers for the /inbox/new recipient picker's
 * combobox pattern (role=combobox + listbox/option + aria-activedescendant).
 * Mirrors the quality bar of the inbox filter bar's tablist helper
 * (`nextSegmentIndex`): a plain reducer over (key, current, count), unit-
 * tested without any DOM.
 */

/**
 * Move the active option for a navigation key. Returns the next index, or
 * `null` when the key is not a listbox-navigation key (callers let those keys
 * fall through to typing / Enter / Escape handling).
 *
 * - ArrowDown from "no active option" (-1) lands on the first option;
 *   ArrowUp lands on the last — then both wrap (WAI-ARIA combobox practice).
 * - Home/End are deliberately NOT handled: in an editable combobox the APG
 *   assigns them to the textbox caret, so they must fall through to native
 *   text editing.
 * - An empty listbox never yields an index.
 */
export function nextRecipientIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 || current >= count - 1 ? 0 : current + 1;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    default:
      return null;
  }
}

/** Stable DOM id for option N — the aria-activedescendant target. */
export function recipientOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * Clamp a remembered active index against the CURRENT option count — results
 * shrink as the query narrows, and a stale index must not point past the end
 * (aria-activedescendant would name a dead node). -1 means "nothing active".
 */
export function clampActiveIndex(index: number, count: number): number {
  return index >= 0 && index < count ? index : -1;
}
