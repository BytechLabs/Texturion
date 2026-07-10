/**
 * Stable colored-initial avatar palette (APP-SHELL-REDESIGN §4, mockup .ava .a-*).
 * A contact/name maps deterministically to one of the four warm gradient fills so
 * the same person always wears the same color across the list, thread, and
 * context panel. The classes are the app-scope avatar utilities in globals.css.
 */
const AVATAR_CLASSES = [
  "app-ava-petrol",
  "app-ava-amber",
  "app-ava-clay",
  "app-ava-slate",
] as const;

export type AvatarColorClass = (typeof AVATAR_CLASSES)[number];

/** Deterministic hash → one of the four avatar fills, stable per key. */
export function avatarColorClass(key: string): AvatarColorClass {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_CLASSES[Math.abs(hash) % AVATAR_CLASSES.length];
}

/** Up-to-two-letter initials from a display name (mockup avatar text).
 * A display name with no letters at all is a bare phone number (unnamed
 * contact) — those wear a neutral "#" instead of digit/punctuation shrapnel
 * like "(5" from "(415) 555-0133". */
export function avatarInitials(name: string): string {
  if (name.trim() === "") return "?";
  if (!/\p{L}/u.test(name)) return "#";
  const isGlyph = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => [...word].some(isGlyph));
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const chars = [...words[0]].filter(isGlyph);
    return chars.slice(0, 2).join("").toUpperCase();
  }
  const first = (word: string) => [...word].find(isGlyph) ?? "";
  return (first(words[0]) + first(words[1])).toUpperCase();
}
