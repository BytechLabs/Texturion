/**
 * #582 — the two letters in an avatar, decided once.
 *
 * They were computed five separate times and the five disagreed. Two of them
 * disagreed ON THE SAME SCREEN: a conversation's avatar said `AM` for "Ana Maria
 * Rojas" while the assignee chip beside it said `AR`, so one contact was two people
 * at a glance. The phones showed `(5` for every unnamed contact — the badge is handed
 * the formatted number, and `(415) 555-0134` starts with a bracket — on the busiest
 * list in the app.
 *
 * ## The rule
 *
 *   - first letter of the first word + first letter of the LAST word
 *   - one word → its first two letters
 *   - letters nowhere in the name → `#`
 *   - nothing at all → `?`
 *   - words with no letter or digit are skipped, and a leading digit is kept
 *
 * ## Why last and not second
 *
 * A middle name is ordinary in a contact list and first-plus-last is how a person
 * reads one. It is also what both phones already shipped, so it is the smallest
 * correction to make five things agree.
 *
 * The cost, recorded rather than discovered later: "4th Street Deli" becomes `4D`
 * rather than `4S`. Nothing can tell a business name from a person's name, three-word
 * business names are far rarer than middle names, and the person's reading wins.
 *
 * ## Code points, not code units — and not grapheme clusters either
 *
 * Indexing a string by code unit is what produced half a character from an emoji or a
 * composed accent, in three of the five. Iterating code points fixes that and is the
 * same operation in TypeScript, Kotlin and Swift, which is what lets the parity tests
 * hold all three to this file.
 *
 * It is deliberately NOT grapheme clusters. Swift would give them for free, TypeScript
 * and Kotlin need two different APIs built on two different Unicode versions, and
 * three implementations that are each "correct" against a different table is how this
 * drifts apart again. A decomposed "É" therefore yields `E`: slightly less pretty on
 * one client, identical on all three, which is the property this issue is about.
 */

/** A character worth showing: a letter or a digit, never punctuation. */
function isGlyph(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

/** The first letter-or-digit in a word, or "" if it has none. */
function firstGlyph(word: string): string {
  return [...word].find(isGlyph) ?? "";
}

/**
 * Up to two letters for an avatar badge.
 *
 * Always returns something printable: an avatar with nothing in it reads as a broken
 * image rather than as a person with no name.
 */
export function avatarInitials(name: string): string {
  if (name.trim() === "") return "?";
  // No letters anywhere means this is not a name — an unnamed contact shows as its
  // formatted number, and `(5` is not initials.
  if (!/\p{L}/u.test(name)) return "#";

  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => [...word].some(isGlyph));
  if (words.length === 0) return "?";
  if (words.length === 1) {
    return [...words[0]].filter(isGlyph).slice(0, 2).join("").toUpperCase();
  }
  return (
    firstGlyph(words[0]) + firstGlyph(words[words.length - 1])
  ).toUpperCase();
}
