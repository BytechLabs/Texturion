/**
 * #690: the words that point at a task, a contact or a conversation.
 *
 *   #T-142            task number 142 in this workspace
 *   #contact-1a2b3c4d a contact (the first eight hex digits of its id)
 *   #conv-1a2b3c4d    a conversation (the same)
 *
 * They are plain text in a note, a task description or a task comment, so a
 * client that knows nothing about references shows them as typed. The server
 * reads them out of the SAVED text (`api_sync_references`); the clients read
 * them to draw chips. Both use the same rule: the token starts the text or
 * follows a character that is not a letter, a digit or `#`, and it is not
 * followed by a letter or a digit. `a#T-1` and `#T-1x` are not references.
 *
 * Customer-facing texts are never read for references, and a `#` typed into a
 * text to a customer stays a `#`.
 *
 * The ports in Kotlin and Swift do the same scan by hand (no look-behind, no
 * word-boundary escape), against `packages/shared/vectors/task-references.json`.
 */

export type ReferenceKind = "task" | "contact" | "conversation";

export interface ReferenceToken {
  kind: ReferenceKind;
  /** The task number, or the lower-case eight hex digits. */
  key: string;
  /** Where the token starts and ends in the text, `#` included. */
  start: number;
  end: number;
  raw: string;
}

const TOKEN_RE = /#(?:(t)-(\d{1,9})|contact-([0-9a-f]{8})|conv-([0-9a-f]{8}))/gi;

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z0-9]/.test(ch);

/** Every reference in the text, in order. */
export function parseReferenceTokens(text: string): ReferenceToken[] {
  const out: ReferenceToken[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = start > 0 ? text[start - 1] : undefined;
    if (before !== undefined && (isWordChar(before) || before === "#")) continue;
    if (isWordChar(text[end])) continue;
    if (m[1] !== undefined) {
      out.push({ kind: "task", key: String(Number(m[2])), start, end, raw: m[0] });
    } else if (m[3] !== undefined) {
      out.push({ kind: "contact", key: m[3].toLowerCase(), start, end, raw: m[0] });
    } else {
      out.push({ kind: "conversation", key: m[4].toLowerCase(), start, end, raw: m[0] });
    }
  }
  return out;
}

/** "T-142", the way a task number is shown and spoken. */
export function taskNumberLabel(number: number): string {
  return `T-${number}`;
}

/** The text a picker inserts for a task. */
export function taskReferenceText(number: number): string {
  return `#T-${number}`;
}

/** The text a picker inserts for a contact or a conversation. */
export function recordReferenceText(kind: "contact" | "conversation", id: string): string {
  const prefix = id.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `#${kind === "contact" ? "contact" : "conv"}-${prefix}`;
}

/**
 * The "#" the member just typed, if the caret sits at the end of one: the
 * query after it. A picker opens on this. Returns null when the caret is not
 * in a `#word`, or the `#` follows a letter or digit (a URL fragment, "No.#4").
 */
export function referenceQueryAt(text: string, caret: number): { start: number; query: string } | null {
  let i = caret;
  while (i > 0 && /[A-Za-z0-9-]/.test(text[i - 1])) i -= 1;
  if (i === 0 || text[i - 1] !== "#") return null;
  const hash = i - 1;
  const before = hash > 0 ? text[hash - 1] : undefined;
  if (isWordChar(before) || before === "#") return null;
  return { start: hash, query: text.slice(i, caret) };
}
