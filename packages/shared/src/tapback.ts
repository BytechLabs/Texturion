export interface Tapback {
  emoji: string;
  quote: string;
  removed: boolean;
}

interface TapbackEvent {
  id: string;
  reaction_to_message_id?: string | null;
  reaction_emoji?: string | null;
  reaction_removed?: boolean;
}

const ACTIONS: readonly [prefix: string, emoji: string, removed?: boolean][] = [
  ["loved", "❤️"],
  ["liked", "👍"],
  ["disliked", "👎"],
  ["laughed at", "😂"],
  ["emphasized", "‼️"],
  ["questioned", "❓"],
  ["removed a heart from", "❤️", true],
  ["removed a like from", "👍", true],
  ["removed a dislike from", "👎", true],
  ["removed a laugh from", "😂", true],
  ["removed an exclamation from", "‼️", true],
  ["removed a question mark from", "❓", true],
  ["a adoré", "❤️"],
  ["a aimé", "👍"],
  ["n'a pas aimé", "👎"],
  ["a ri de", "😂"],
  ["a souligné", "‼️"],
  ["a mis l'accent sur", "‼️"],
  ["a mis un point d'interrogation sur", "❓"],
  ["a posé une question sur", "❓"],
  ["a retiré un cœur de", "❤️", true],
  ["a retiré un « j'aime » de", "👍", true],
  ["a retiré un « je n'aime pas » de", "👎", true],
  ["a retiré un rire de", "😂", true],
  ["a retiré un point d'exclamation de", "‼️", true],
  ["a retiré un point d'interrogation de", "❓", true],
];

const QUOTES = new Map([
  ['"', '"'],
  ["“", "”"],
  ["«", "»"],
]);

function quotedText(value: string): string | null {
  const trimmed = value.trim();
  const closing = QUOTES.get(trimmed.charAt(0));
  if (!closing || !trimmed.endsWith(closing)) return null;
  const quote = trimmed.slice(1, -1).trim();
  return quote.length > 0 && quote.length <= 1600 ? quote : null;
}

function isEmoji(value: string): boolean {
  const first = value.codePointAt(0) ?? 0;
  return value.length <= 32 &&
    ((first >= 0x1f000 && first <= 0x1faff) ||
      (first >= 0x2600 && first <= 0x27bf) ||
      ["❤️", "‼️", "❓", "©️", "®️", "™️"].includes(value) ||
      value.endsWith("⃣")) &&
    Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)).length === 1;
}

export function parseTapback(body: string): Tapback | null {
  const value = body.trim();
  const folded = value.toLowerCase().replaceAll("’", "'");
  for (const [prefix, emoji, removed = false] of ACTIONS) {
    if (!folded.startsWith(prefix)) continue;
    const quote = quotedText(value.slice(prefix.length));
    if (quote) return { emoji, quote, removed };
  }
  for (const separator of [" to ", " à "]) {
    const at = folded.indexOf(separator);
    if (at === -1) continue;
    const emoji = value.slice(0, at).trim().split(" ").at(-1) ?? "";
    const preamble = folded.slice(0, at).trim();
    if (!isEmoji(emoji) || !["", "reacted", "a réagi"].includes(preamble.slice(0, -emoji.length).trim())) {
      continue;
    }
    const quote = quotedText(value.slice(at + separator.length));
    if (quote) return { emoji, quote, removed: false };
  }
  return null;
}

export function foldTapbacks<T extends TapbackEvent>(chronologicalMessages: readonly T[]) {
  const loaded = new Set(chronologicalMessages.map(({ id }) => id));
  const reactions = new Map<string, string>();
  const messages = chronologicalMessages.filter((message) => {
    const { reaction_to_message_id: target, reaction_emoji: emoji } = message;
    if (!target || !emoji || !loaded.has(target)) return true;
    if (message.reaction_removed) {
      if (reactions.get(target) === emoji) reactions.delete(target);
    } else {
      reactions.set(target, emoji);
    }
    return false;
  });
  return { messages, reactions };
}
