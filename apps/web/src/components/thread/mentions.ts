/** A teammate the author picked from the mention list, with the text inserted. */
export interface PickedMention {
  userId: string;
  /** The display name as it was written into the draft, without the "@". */
  name: string;
}

/**
 * Which picks survive to the send.
 *
 * The ids come from what the author PICKED, never from parsing the draft for
 * "@name": two teammates can share a display name, and text alone cannot say
 * which one was meant. Parsing would quietly notify both.
 *
 * The text still gets a say in one direction. Deleting the name from the draft
 * withdraws the mention, so backspacing over "@Sam" stops Sam being told.
 */
export function resolveMentions(
  text: string,
  picked: readonly PickedMention[],
): string[] {
  // Each pick must claim its OWN "@Name" in the draft, and a claimed span is
  // consumed so nothing else can match inside it.
  //
  // A plain `text.includes("@" + name)` looks equivalent and is not. Display
  // names are not unique and are not prefix-free: with "Sam" and "Sam Rivera"
  // both picked, deleting "@Sam" left "@Sam Rivera" behind, which still
  // contains "@Sam", so the withdrawn person was notified anyway. Two
  // teammates who share a name had the same problem, and both are the exact
  // failures this function exists to prevent.
  //
  // Longest name first, because "@Sam Rivera" must take that span before
  // "@Sam" can look at it.
  const order = [...picked].sort((a, b) => b.name.length - a.name.length);
  const claimed: Array<[number, number]> = [];
  const ids = new Set<string>();

  for (const mention of order) {
    const token = `@${mention.name}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      const end = at + token.length;
      const overlaps = claimed.some(([start, stop]) => at < stop && end > start);
      if (!overlaps) {
        claimed.push([at, end]);
        ids.add(mention.userId);
        break;
      }
      from = at + 1;
    }
  }
  return [...ids];
}

/**
 * Whether an "@" typed at this position is asking for the picker.
 *
 * Only at the start of the draft or after whitespace. Mid-word it is part of
 * something the author is writing: an email address, a rate like "2 hrs @ $95",
 * a handle. Opening a teammate picker there, and worse swallowing the
 * character, made an ordinary internal note impossible to type.
 */
export function isMentionTrigger(text: string, caret: number): boolean {
  if (caret <= 0 || text[caret - 1] !== "@") return false;
  if (caret === 1) return true;
  return /\s/.test(text[caret - 2] ?? "");
}

/**
 * Insert a mention at the caret, swallowing the "@" that opened the picker.
 *
 * Returns the new text and where the caret belongs, so the composer can put it
 * after the inserted name rather than at the end of a draft the author may
 * have been editing in the middle of.
 */
export function insertMention(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  // The "@" that triggered the picker sits immediately before the caret and is
  // replaced, so the draft never ends up with "@@Sam".
  const trigger = text.slice(0, caret).endsWith("@") ? caret - 1 : caret;
  const before = text.slice(0, trigger);
  const after = text.slice(caret);
  // A trailing space keeps typing natural, but not a second one if the draft
  // already had it.
  const spacer = after.startsWith(" ") ? "" : " ";
  const inserted = `@${name}${spacer}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}
