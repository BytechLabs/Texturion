package com.loonext.android.features.notifications

import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #201 regression pins: every badge surface (shell avatar, account sheet,
 * For You bell, notifications header) reads ONE StoreCache key, and the
 * process-lifetime guards in [NotificationsReadState] keep server refetches
 * from resurrecting a dot the user already cleared. These tests drive the
 * exact write sequences NotificationsScreen and the shell perform.
 */
class NotificationsReadStateTest {
    private val companyId = "co-1"

    private fun badge(cache: StoreCache) =
        cache.flowOf<Int>(CacheKeys.unreadNotifications(companyId))

    private fun item(id: String, createdAt: String, unread: Boolean = true) = NotificationItem(
        id = id,
        type = NotificationType.INBOUND_MESSAGE,
        conversation_id = "conv-$id",
        created_at = createdAt,
        unread = unread,
    )

    @Test
    fun `tap-read decrements the shared badge cache immediately`() {
        // markItemRead's optimistic sequence against the one shared key.
        val cache = StoreCache()
        val state = NotificationsReadState().forCompany(companyId)
        badge(cache).value = 3

        state.localReadIds += "n1"
        badge(cache).value = 2
        state.beginMark()

        assertEquals(2, badge(cache).value)
        assertTrue(state.marksInFlight)
    }

    @Test
    fun `a server refetch during an in-flight mark cannot resurrect the badge`() {
        val cache = StoreCache()
        val state = NotificationsReadState().forCompany(companyId)
        badge(cache).value = 2
        state.beginMark()

        // A realtime tick lands mid-POST carrying the pre-mark server count.
        state.offerServerCount(badge(cache), 3)
        assertEquals(2, badge(cache).value)

        // The POST settles; the reconcile refetch now writes the true count.
        assertTrue(state.settleMark())
        state.offerServerCount(badge(cache), 2)
        assertEquals(2, badge(cache).value)
    }

    @Test
    fun `reconcileFetched keeps the cached value only while marks are in flight`() {
        // The For You bell's cache-first fetcher writes whatever it returns,
        // so mid-mark it must hand back the cached value (a no-op write).
        val state = NotificationsReadState().forCompany(companyId)

        assertEquals(5, state.reconcileFetched(cached = 2, fetched = 5))
        state.beginMark()
        assertEquals(2, state.reconcileFetched(cached = 2, fetched = 5))
        assertEquals(5, state.reconcileFetched(cached = null, fetched = 5))
        state.settleMark()
        assertEquals(5, state.reconcileFetched(cached = 2, fetched = 5))
    }

    @Test
    fun `withLocalReads keeps a tapped row read across a racing feed refetch`() {
        val state = NotificationsReadState().forCompany(companyId)
        state.localReadIds += "tapped"

        // The refetched page still carries the pre-mark unread flag.
        val result = state.withLocalReads(
            listOf(
                item("tapped", "2026-07-22T11:00:00Z"),
                item("other", "2026-07-22T12:00:00Z"),
            ),
        )

        assertFalse(result.first { it.id == "tapped" }.unread)
        assertTrue(result.first { it.id == "other" }.unread)
    }

    @Test
    fun `read-all zeroes the shared badge and its watermark holds over refetch`() {
        val cache = StoreCache()
        val state = NotificationsReadState().forCompany(companyId)
        badge(cache).value = 4

        // markAllRead's optimistic sequence, then the server watermark lands.
        badge(cache).value = 0
        state.beginMark()
        state.localWatermark = advanceWatermark(state.localWatermark, "2026-07-22T12:00:00Z")

        // A racing refetch: stale count dropped, stale page flips read via the
        // watermark; items newer than the advance keep their dot (D24).
        state.offerServerCount(badge(cache), 4)
        assertEquals(0, badge(cache).value)
        val page = state.withLocalReads(
            listOf(
                item("older", "2026-07-22T11:00:00Z"),
                item("newer", "2026-07-22T13:00:00Z"),
            ),
        )
        assertFalse(page.first { it.id == "older" }.unread)
        assertTrue(page.first { it.id == "newer" }.unread)
    }

    @Test
    fun `guards outlive the composition but not the session`() {
        // The tap that marks a row read unmounts NotificationsScreen; the
        // fresh instance must resolve the SAME in-flight guards.
        val holder = NotificationsReadState()
        val state = holder.forCompany(companyId)
        state.beginMark()

        assertSame(state, holder.forCompany(companyId))
        assertTrue(holder.forCompany(companyId).marksInFlight)

        // Sign-out drops the guards with the cache.
        holder.clear()
        assertFalse(holder.forCompany(companyId).marksInFlight)
    }

    @Test
    fun `overlapping marks reconcile only once, on the last settle`() {
        val state = NotificationsReadState().forCompany(companyId)
        state.beginMark()
        state.beginMark()

        assertFalse(state.settleMark())
        assertTrue(state.settleMark())
    }

    @Test
    fun `a fresh process paints the post-read server count`() {
        // StoreCache is in-memory only, so a restart refetches; the server
        // watermark advanced at mark time, so the cold prime paints zero and
        // no stale guard state survives to block the write.
        val restarted = StoreCache()
        val state = NotificationsReadState().forCompany(companyId)

        state.offerServerCount(badge(restarted), 0)

        assertEquals(0, badge(restarted).value)
        assertFalse(state.marksInFlight)
    }
}
