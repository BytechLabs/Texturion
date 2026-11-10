package com.loonext.android.features.tasks

/** #713: how a tag stands across a selection. Mirrors packages/shared/src/tag-selection.ts. */
enum class TagSelectionState { All, Some, None, Unknown }

/**
 * `itemTagIds` is the tag ids on each selected item, or null when the rows are
 * not loaded (a filter selection). Null or empty is Unknown, never None.
 */
fun tagSelectionState(itemTagIds: List<List<String>>?, tagId: String): TagSelectionState {
    if (itemTagIds.isNullOrEmpty()) return TagSelectionState.Unknown
    val having = itemTagIds.count { tagId in it }
    return when (having) {
        0 -> TagSelectionState.None
        itemTagIds.size -> TagSelectionState.All
        else -> TagSelectionState.Some
    }
}

/** Choosing a tag takes it off only when every selected item already has it. */
fun tagToggleAction(state: TagSelectionState): String =
    if (state == TagSelectionState.All) "remove" else "add"
