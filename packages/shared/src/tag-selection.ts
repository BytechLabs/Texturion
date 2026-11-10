/**
 * #713: one control for a tag (or task label) across a selection, instead of
 * an "add" list and a "remove" list.
 *
 * The control shows what the selection already has: every item, some, or none.
 * A selection that is a whole filter has rows the client never loaded, so its
 * state is unknown and reads like "some". Choosing a tag every item has removes
 * it; choosing any other adds it to the items that lack it.
 *
 * The Kotlin and Swift ports are checked against `vectors/tag-selection.json`.
 */

export type TagSelectionState = "all" | "some" | "none" | "unknown";

/** `itemTagIds` holds each selected item's tag ids; null when the rows are not loaded. */
export function tagSelectionState(
  itemTagIds: readonly (readonly string[])[] | null,
  tagId: string,
): TagSelectionState {
  if (itemTagIds === null || itemTagIds.length === 0) return "unknown";
  const having = itemTagIds.filter((ids) => ids.includes(tagId)).length;
  if (having === 0) return "none";
  return having === itemTagIds.length ? "all" : "some";
}

export function tagToggleAction(state: TagSelectionState): "add" | "remove" {
  return state === "all" ? "remove" : "add";
}
