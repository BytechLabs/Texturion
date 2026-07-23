package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Process-lifetime mark-read bookkeeping (#201), one entry per company, held
 * on AppGraph next to StoreCache. These guards used to be composition state
 * inside NotificationsScreen, but tapping a row navigates to the thread and
 * UNMOUNTS the screen while its mark POST survives on appScope; a fresh
 * instance then mounted with empty guards, and its immediate refetch was free
 * to repaint the pre-mark server state (nothing ever corrected it, because no
 * mark endpoint broadcasts a realtime event). Hoisted here, the guards live
 * exactly as long as the POSTs they guard.
 *
 * Contract: every fetcher that writes CacheKeys.unreadNotifications goes
 * through [CompanyReadState.offerServerCount] (or [reconcileFetched] inside a
 * cache-first fetch), and every fetched feed page goes through
 * [CompanyReadState.withLocalReads]. Cleared on sign-out with the cache.
 */
class NotificationsReadState {
    private val companies = ConcurrentHashMap<String, CompanyReadState>()

    fun forCompany(companyId: String): CompanyReadState =
        companies.getOrPut(companyId) { CompanyReadState() }

    fun clear() = companies.clear()
}

class CompanyReadState {
    private val pendingMarks = AtomicInteger(0)

    /** Per-item reads this process (#188): applied over every refetch so a
     *  revalidate racing the POST can't resurrect a tapped row's dot. */
    val localReadIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** The furthest watermark this process has advanced to (forward-only,
     *  the server RPC's semantics). */
    @Volatile
    var localWatermark: String? = null

    /** True while any mark POST is in flight. */
    val marksInFlight: Boolean get() = pendingMarks.get() > 0

    fun beginMark() {
        pendingMarks.incrementAndGet()
    }

    /** Returns true when this settle was the LAST in-flight mark: the
     *  caller's cue to run one reconcile refetch (mark endpoints emit no
     *  realtime event, so nothing else corrects drift). */
    fun settleMark(): Boolean = pendingMarks.decrementAndGet() == 0

    /** The one write gate for the shared badge count: server counts are
     *  dropped while a mark POST is in flight (they'd briefly resurrect the
     *  pre-mark badge); reconciled on settle. */
    fun offerServerCount(badge: MutableStateFlow<Int?>, count: Int) {
        if (!marksInFlight) badge.value = count
    }

    /** [offerServerCount] shaped for cache-first fetchers, which write
     *  whatever they return: while a mark is in flight, hand back the cached
     *  value so the write is a no-op instead of a resurrection. */
    fun reconcileFetched(cached: Int?, fetched: Int): Int =
        if (marksInFlight) cached ?: fetched else fetched

    /** Re-applies this process's optimistic reads over a fetched page. */
    fun withLocalReads(fetched: List<NotificationItem>): List<NotificationItem> {
        val marked = localWatermark?.let { applyWatermark(fetched, it) } ?: fetched
        if (localReadIds.isEmpty()) return marked
        return marked.map {
            if (it.unread && it.id in localReadIds) it.copy(unread = false) else it
        }
    }
}
