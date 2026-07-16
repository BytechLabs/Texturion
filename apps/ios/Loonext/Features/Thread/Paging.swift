import Foundation

/// Pure cursor-page reducers shared by the inbox list and the thread timeline.
/// SPEC §7 pagination is keyset `(timestamptz, id) DESC` with an opaque cursor;
/// these functions keep client lists consistent when pages append (scroll) and
/// when realtime refetches of page 1 merge into an already-scrolled list.

/// Append an older `page` onto `existing` (both in server DESC order), dropping
/// any row whose id is already present — overlap can happen when a new row
/// lands between two page fetches and shifts the keyset window.
func appendPage<T>(_ existing: [T], _ page: [T], idOf: (T) -> String) -> [T] {
    if page.isEmpty { return existing }
    var seen = Set(existing.map(idOf))
    return existing + page.filter { seen.insert(idOf($0)).inserted }
}

/// Merge a fresh page-1 refetch into an already-loaded list: fresh rows replace
/// stale copies (same id), unseen fresh rows are added, everything re-sorts by
/// `sortKey` DESC with id DESC as the tiebreak — the server's order. This is
/// the realtime re-sort: an updated conversation floats to its new position
/// without dropping the pages the user already scrolled.
func mergeFirstPage<T>(
    _ existing: [T],
    _ fresh: [T],
    idOf: (T) -> String,
    sortKey: (T) -> String
) -> [T] {
    var freshById: [String: T] = [:]
    for row in fresh { freshById[idOf(row)] = row }
    let kept = existing.map { row in freshById[idOf(row)] ?? row }
    let keptIds = Set(kept.map(idOf))
    let added = fresh.filter { !keptIds.contains(idOf($0)) }
    return (kept + added).sorted { a, b in
        let keyA = sortKey(a)
        let keyB = sortKey(b)
        if keyA != keyB { return keyA > keyB }
        return idOf(a) > idOf(b)
    }
}

/// Remove rows that no longer match the active filter after a refetch — e.g. a
/// conversation closed elsewhere should leave the Open list. `freshFirstPageIds`
/// is the authoritative first page; rows NOT in it are kept only when they are
/// older than the last fresh row (they may live on later pages).
func dropVanishedFromFirstWindow<T>(
    merged: [T],
    freshFirstPageIds: Set<String>,
    oldestFreshSortKey: String?,
    idOf: (T) -> String,
    sortKey: (T) -> String
) -> [T] {
    guard let oldestFreshSortKey else {
        return merged.filter { freshFirstPageIds.contains(idOf($0)) }
    }
    return merged.filter { row in
        freshFirstPageIds.contains(idOf(row)) || sortKey(row) < oldestFreshSortKey
    }
}
