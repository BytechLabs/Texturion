import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
// Type-only imports: erased at compile time, so this module stays free of the
// runtime API/env dependencies that make it testable in isolation.
import type { ConversationFilters } from "@/lib/api/filters";
import type { ConversationStatus } from "@/lib/api/types";

/**
 * #275 — what "selected" means, kept out of the component so it can be reasoned
 * about and tested.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID. The obvious implementation holds a Set of
 * ids and, when the user asks for everything, fills it with the ids it happens to
 * have loaded. The inbox is virtualized and cursor-paged, so that Set is 25 rows
 * out of 340 — and the bar then says "select all" while acting on the page. #275
 * names it: *selecting only the loaded page while implying more is a trap.*
 *
 * So there are two DIFFERENT kinds of selection here and they are not
 * interchangeable:
 *
 *   `ids`    — the user pointed at specific rows. We know exactly which, and
 *              exactly how many.
 *   `filter` — the user asked for everything matching what they are looking at.
 *              We do NOT know how many, because the server has not counted them
 *              yet, and this module refuses to guess. The count comes back in the
 *              response as `matched`.
 *
 * That second mode is why the UI never renders a total it has not been told. A
 * confident "340 selected" that turns out to be 25 is worse than "all matching
 * this filter", which is vague and true.
 */

export type BulkSelection =
  | { readonly mode: "ids"; readonly ids: ReadonlySet<string> }
  | { readonly mode: "filter" };

/** Nothing selected — the state the bar is hidden in. */
export const EMPTY_SELECTION: BulkSelection = {
  mode: "ids",
  ids: new Set<string>(),
};

export function isEmpty(selection: BulkSelection): boolean {
  return selection.mode === "ids" && selection.ids.size === 0;
}

/** True when this row should render as checked. */
export function isRowSelected(
  selection: BulkSelection,
  conversationId: string,
): boolean {
  // In filter mode every row the user can see is included by definition, so every
  // checkbox is checked — including rows that scroll into view later.
  return selection.mode === "filter" || selection.ids.has(conversationId);
}

/**
 * Toggle one row.
 *
 * Toggling a row while in filter mode DROPS OUT of filter mode, keeping the rows
 * currently loaded minus the one just unticked. Anything else would be a lie: the
 * user has just said "not that one" about a set we cannot enumerate, so we cannot
 * honour it as an exclusion — and silently ignoring the untick would leave a
 * visibly unchecked row inside the selection.
 */
export function toggleRow(
  selection: BulkSelection,
  conversationId: string,
  loadedIds: readonly string[],
): BulkSelection {
  if (selection.mode === "filter") {
    const next = new Set(loadedIds);
    next.delete(conversationId);
    return { mode: "ids", ids: next };
  }
  const next = new Set(selection.ids);
  if (next.has(conversationId)) next.delete(conversationId);
  else next.add(conversationId);
  return { mode: "ids", ids: next };
}

/** Tick every loaded row. Does NOT claim anything about rows not yet fetched. */
export function selectLoaded(loadedIds: readonly string[]): BulkSelection {
  return { mode: "ids", ids: new Set(loadedIds) };
}

/** Escalate to "everything matching the filter", however many that turns out to be. */
export function selectAllMatching(): BulkSelection {
  return { mode: "filter" };
}

/**
 * Whether to offer the escalation.
 *
 * Only once every loaded row is ticked AND there is more to fetch. Offering it
 * earlier invites the user to escalate before they have understood the page;
 * offering it when everything is already loaded would be an escalation to the
 * same set, phrased as if it were bigger.
 */
export function canEscalate(
  selection: BulkSelection,
  loadedIds: readonly string[],
  hasMore: boolean,
): boolean {
  if (selection.mode === "filter") return false;
  if (loadedIds.length === 0) return false;
  if (!hasMore) return false;
  return loadedIds.every((id) => selection.ids.has(id));
}

/**
 * The bar's label. Never invents a total.
 *
 * Filter mode deliberately has no number in it. The server counts the set when it
 * runs the action and reports `matched`; until then the honest phrasing is the
 * one that does not commit to a figure.
 */
export function selectionLabel(
  selection: BulkSelection,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  if (selection.mode === "filter") return t("inbox.bulkSelectedAllMatching");
  return t("inbox.bulkSelectedCount", { count: selection.ids.size });
}

/** The ids to send, or null when the server should resolve the filter itself. */
export function selectionIds(selection: BulkSelection): string[] | null {
  return selection.mode === "filter" ? null : [...selection.ids];
}

/**
 * The sentence shown after an action ran, from what the server actually did.
 *
 * Built from the RESPONSE, never from the selection: those two numbers differ
 * whenever a row was on a denied number, already gone, or past the cap, and the
 * difference is exactly what #275 says must not be swallowed. `applied` is the
 * only count that describes reality.
 *
 * #228: the glue between the counts is keyed, and the VERB and NOUN stay the
 * caller's — which action ran, and what it ran on, are facts this module is
 * told rather than facts it knows. Both are interpolated rather than
 * concatenated so a translator can put them where the sentence needs them; a
 * caller that has not been converted yet passes English words into a French
 * frame, which is visibly half-done rather than quietly wrong.
 */
export function bulkResultMessage(
  verb: string,
  result: { applied?: unknown[]; failed?: unknown[]; matched?: number; capped?: boolean },
  /** #478: what was acted on. Defaulted so every existing call is unchanged. */
  noun: { one: string; many: string } = {
    one: "conversation",
    many: "conversations",
  },
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  const applied = result.applied?.length ?? 0;
  const failed = result.failed?.length ?? 0;
  const matched = result.matched ?? applied;

  const thing = applied === 1 ? noun.one : noun.many;
  let message = t("inbox.bulkResultApplied", { verb, count: applied, thing });

  // The cap is the case where "it worked" and "it finished" are different
  // answers, so the remainder is named rather than left to be discovered.
  if (result.capped && matched > applied) {
    message += t("inbox.bulkResultCapped", { count: matched - applied });
  }
  if (failed > 0) {
    // One and many are separate keys rather than one sentence with the verb
    // swapped in: the agreement moves more than a word in French.
    message +=
      failed === 1
        ? t("inbox.bulkResultFailedOne", { count: failed })
        : t("inbox.bulkResultFailedMany", { count: failed });
  }
  return message;
}

export interface BulkConversationsBody {
  action:
    | "mark_read"
    | "set_status"
    | "assign"
    | "set_spam"
    | "add_tag"
    | "remove_tag";
  /** Omit to act on everything matching `filter`. */
  ids?: string[];
  filter?: ConversationFilters;
  target_user_id?: string | null;
  target_tag_id?: string;
  target_status?: ConversationStatus;
  target_spam?: boolean;
}

export interface BulkConversationsResult {
  action: string;
  matched: number;
  applied: { id: string; previous: Record<string, unknown> }[];
  failed: { id: string; reason: string }[];
  capped: boolean;
}

/**
 * Turn a bulk result into the calls that put it back.
 *
 * Grouped by prior value so an undo of "close 300 threads that were a mix of new,
 * open and waiting" is three calls rather than three hundred — and each row lands
 * back on the status it actually had, not a uniform "open". A row whose recorded
 * previous value matches what was just written needs no call at all.
 *
 * Returns [] when the action left nothing to reverse (mark_read records no prior
 * state, because "unread" is the absence of a read receipt and nobody asks to
 * un-read three hundred threads).
 */
export function undoBulkCalls(
  result: BulkConversationsResult,
  /**
   * The request that produced `result`. Needed for the tag actions: the tag id is
   * not in the response, and an undo that sent no tag would be rejected — so the
   * caller hands back what it asked for rather than the builder guessing.
   */
  original: BulkConversationsBody,
): BulkConversationsBody[] {
  const groups = new Map<string, { body: BulkConversationsBody; ids: string[] }>();

  for (const row of result.applied) {
    let body: BulkConversationsBody | null = null;
    if ("status" in row.previous) {
      body = {
        action: "set_status",
        target_status: row.previous.status as ConversationStatus,
      };
    } else if ("assigned_user_id" in row.previous) {
      body = {
        action: "assign",
        target_user_id: (row.previous.assigned_user_id as string | null) ?? null,
      };
    } else if ("is_spam" in row.previous) {
      body = { action: "set_spam", target_spam: row.previous.is_spam === true };
    } else if ("had_tag" in row.previous) {
      // Undoing an add removes only the rows that did NOT already carry the tag,
      // and undoing a remove restores only the rows that DID. Without that the
      // undo would strip a tag somebody had applied by hand months ago.
      const hadTag = row.previous.had_tag === true;
      if (result.action === "add_tag" && hadTag) continue;
      if (result.action === "remove_tag" && !hadTag) continue;
      if (!original.target_tag_id) continue;
      body = {
        action: result.action === "add_tag" ? "remove_tag" : "add_tag",
        target_tag_id: original.target_tag_id,
      };
    }
    if (!body) continue;

    const key = JSON.stringify(body);
    const group = groups.get(key) ?? { body, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({ ...group.body, ids: group.ids }));
}
