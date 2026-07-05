/**
 * Pure logic behind the G9 unread indicators: the `(3) Inbox — Loonext`
 * document title prefix, the favicon swap, and the unread count derived from
 * cached conversation lists. All plain functions/objects — unit-tested in
 * title.test.ts, applied to the DOM by use-unread-title.ts.
 */

/** Title counts above this render as "99+" — precision stops mattering. */
const MAX_DISPLAY_COUNT = 99;

/** `(3) Inbox — Loonext` (G9). Pure — no stripping, base title comes in. */
export function formatUnreadTitle(baseTitle: string, unread: number): string {
  if (unread <= 0) return baseTitle;
  const count =
    unread > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : `${unread}`;
  return `(${count}) ${baseTitle}`;
}

/**
 * Stateful (but DOM-free) title controller. A regex can't distinguish our
 * `(3) ` prefix from a legitimate page title like `(416) 555-0182 — Loonext`
 * (G10 phone formatting), so the controller remembers exactly what it last
 * wrote: any OTHER value it sees is a page-authored base title.
 */
export interface TitleController {
  /** Compute what the document title should be right now. */
  next(currentTitle: string, unread: number): string;
  /** The title to leave behind on unmount (its own prefix removed). */
  restore(currentTitle: string): string;
}

export function createTitleController(): TitleController {
  let base: string | null = null;
  let lastApplied: string | null = null;
  return {
    next(currentTitle, unread) {
      if (base === null || currentTitle !== lastApplied) {
        // The page (route change, dynamic thread name) set a new title.
        base = currentTitle;
      }
      lastApplied = formatUnreadTitle(base, unread);
      return lastApplied;
    },
    restore(currentTitle) {
      return currentTitle === lastApplied && base !== null
        ? base
        : currentTitle;
    },
  };
}

/** Which favicon belongs to this unread count (G9 favicon dot). */
export function faviconHref(unread: number): string {
  return unread > 0 ? "/favicon-unread.svg" : "/favicon.svg";
}

/** The minimal structural shape of a cached conversation-list row. */
interface UnreadCountableRow {
  id: string;
  unread?: boolean;
}

/** The minimal structural shape of a cached infinite conversation list. */
export interface UnreadCountableList {
  pages?: { data?: UnreadCountableRow[] }[];
}

/**
 * Count unread conversations across every cached list (any filter
 * combination), deduplicating rows by id — the same conversation appears in
 * several lists ("Open", "Mine", …). A row counts as unread when ANY cached
 * copy says so.
 */
export function countUnreadConversations(
  lists: Iterable<UnreadCountableList | undefined>,
): number {
  const unreadById = new Map<string, boolean>();
  for (const list of lists) {
    if (!list?.pages) continue;
    for (const page of list.pages) {
      for (const row of page.data ?? []) {
        unreadById.set(
          row.id,
          (unreadById.get(row.id) ?? false) || row.unread === true,
        );
      }
    }
  }
  let count = 0;
  for (const unread of unreadById.values()) {
    if (unread) count += 1;
  }
  return count;
}
