package com.loonext.android.features.thread

/**
 * Pure cursor-page reducers shared by the inbox list and the thread timeline.
 * SPEC §7 pagination is keyset `(timestamptz, id) DESC` with an opaque cursor;
 * these functions keep client lists consistent when pages append (scroll) and
 * when realtime refetches of page 1 merge into an already-scrolled list.
 */

/**
 * Append an older [page] onto [existing] (both in server DESC order), dropping
 * any row whose id is already present — overlap can happen when a new row
 * lands between two page fetches and shifts the keyset window.
 */
fun <T> appendPage(existing: List<T>, page: List<T>, idOf: (T) -> String): List<T> {
    if (page.isEmpty()) return existing
    val seen = existing.mapTo(HashSet(existing.size)) { idOf(it) }
    return existing + page.filter { seen.add(idOf(it)) }
}

/**
 * Merge a fresh page-1 refetch into an already-loaded list: fresh rows replace
 * stale copies (same id), unseen fresh rows are added, everything re-sorts by
 * [sortKey] DESC with id DESC as the tiebreak — the server's order. This is
 * the realtime re-sort: an updated conversation floats to its new position
 * without dropping the pages the user already scrolled.
 */
fun <T> mergeFirstPage(
    existing: List<T>,
    fresh: List<T>,
    idOf: (T) -> String,
    sortKey: (T) -> String,
): List<T> {
    val freshById = fresh.associateBy(idOf)
    val kept = existing.map { row -> freshById[idOf(row)] ?: row }
    val keptIds = kept.mapTo(HashSet(kept.size)) { idOf(it) }
    val added = fresh.filter { idOf(it) !in keptIds }
    return (kept + added).sortedWith(
        compareByDescending(sortKey).thenByDescending(idOf),
    )
}

/**
 * Remove rows that no longer match the active filter after a refetch — e.g. a
 * conversation closed elsewhere should leave the Open list. [freshFirstPageIds]
 * is the authoritative first page; rows NOT in it are kept only when they are
 * older than the last fresh row (they may live on later pages).
 */
fun <T> dropVanishedFromFirstWindow(
    merged: List<T>,
    freshFirstPageIds: Set<String>,
    oldestFreshSortKey: String?,
    idOf: (T) -> String,
    sortKey: (T) -> String,
): List<T> {
    if (oldestFreshSortKey == null) return merged.filter { idOf(it) in freshFirstPageIds }
    return merged.filter { row ->
        idOf(row) in freshFirstPageIds || sortKey(row) < oldestFreshSortKey
    }
}
