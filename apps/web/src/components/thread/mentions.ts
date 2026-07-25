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
  const ids = new Set<string>();
  for (const mention of picked) {
    if (text.includes(`@${mention.name}`)) ids.add(mention.userId);
  }
  return [...ids];
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
