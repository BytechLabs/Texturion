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

/** Up-to-two-letter initials from a display name (mockup avatar text). */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
