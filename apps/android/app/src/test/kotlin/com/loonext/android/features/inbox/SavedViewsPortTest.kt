package com.loonext.android.features.inbox

import com.loonext.android.core.model.MessageLocale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #280 — the Kotlin half of a contract four things share.
 *
 * `packages/shared/src/saved-views.ts` decides what a view may hold. This is a
 * HAND PORT of that decision, and the failure mode is not a crash: it is a view
 * that saves on the phone and opens something else on the web.
 *
 * Every case here asserts a POSITIVE as well as a refusal, deliberately. A port
 * that rejects everything passes a suite made only of refusals, and that is the
 * shape a broken regex or an inverted condition actually takes.
 */
class SavedViewsPortTest {

    private val id = "11111111-2222-4333-8444-555555555555"
    private val tag = "22222222-3333-4444-8555-666666666666"
    private val me = "aaaaaaaa-1111-4222-8333-444444444444"

    /**
     * #228 moved the suggested name's words into `InboxStrings`, so the builder
     * now takes the reader's language. Asserted in English, which is what the
     * web twin suggests too.
     */
    private val locale = MessageLocale.DEFAULT

    private fun obj(vararg pairs: Pair<String, Any>): JsonObject = buildJsonObject {
        for ((k, v) in pairs) {
            when (v) {
                is Boolean -> put(k, JsonPrimitive(v))
                is String -> put(k, JsonPrimitive(v))
                else -> error("unsupported")
            }
        }
    }

    @Test
    fun `keeps every filter the endpoint understands`() {
        // The positive case for each key. Without these, an allow-list that
        // matched nothing would pass everything below.
        val clean = sanitizeConversationFilters(
            obj(
                "status" to "open",
                "assigned_user_id" to id,
                "tag_id" to tag,
                "unread" to true,
                "is_spam" to true,
                "snoozed" to "only",
                "pinned" to "exclude",
                "awaiting" to "only",
            ),
        )
        assertEquals(8, clean.size)
        assertEquals("open", (clean["status"] as JsonPrimitive).content)
        assertEquals(id, (clean["assigned_user_id"] as JsonPrimitive).content)
    }

    @Test
    fun `drops an unknown key instead of failing the read`() {
        // A view written before a filter was renamed must still open. A refusal
        // here is a dead screen the person cannot repair.
        val clean = sanitizeConversationFilters(obj("status" to "open", "colour" to "red"))
        assertEquals(1, clean.size)
        assertTrue(clean.containsKey("status"))
    }

    @Test
    fun `drops a known key holding a value the endpoint would reject`() {
        assertEquals(0, sanitizeConversationFilters(obj("status" to "archived")).size)
        assertEquals(0, sanitizeConversationFilters(obj("assigned_user_id" to "me")).size)
        // A quoted "true" is not a boolean. The web port had to make the same
        // distinction, and JSON is where the two languages disagree most.
        assertEquals(0, sanitizeConversationFilters(obj("unread" to "true")).size)
    }

    @Test
    fun `refuses cursors and search text`() {
        // A cursor is a position in one result set; a search is a question asked
        // once. Saving either would make a shared view mean something else.
        assertEquals(
            0,
            sanitizeConversationFilters(obj("cursor" to "abc", "q" to "boiler")).size,
        )
    }

    @Test
    fun `never stores both assignee filters`() {
        val clean = sanitizeConversationFilters(
            obj("assigned_to_me" to true, "assigned_user_id" to id),
        )
        assertEquals(1, clean.size)
        assertTrue(clean.containsKey("assigned_to_me"))
    }

    @Test
    fun `drops a false assigned_to_me rather than storing a no-op`() {
        val clean = sanitizeConversationFilters(
            obj("assigned_to_me" to false, "assigned_user_id" to id),
        )
        assertEquals(1, clean.size)
        assertEquals(id, (clean["assigned_user_id"] as JsonPrimitive).content)
    }

    @Test
    fun `resolves Mine to whoever is asking`() {
        assertEquals(me, resolveAssignee(obj("assigned_to_me" to true), me))
        assertEquals(id, resolveAssignee(obj("assigned_user_id" to id), me))
        assertNull(resolveAssignee(obj("status" to "open"), me))
    }

    @Test
    fun `round-trips the inbox controls through a stored view`() {
        val selection = ViewSelection(
            tab = InboxStatusTab.Open,
            assigneeUserId = id,
            assignedToMe = false,
            tagId = tag,
            unreadOnly = true,
            spamOnly = false,
            snoozedOnly = true,
            awaitingOnly = true,
        )
        assertEquals(selection, viewToSelection(selectionToView(selection)))
    }

    @Test
    fun `#508 keeps the unanswered filter, and only its two values`() {
        // Unset already means no filter here, unlike snoozed — so "all" is a
        // third way of saying the same thing and is dropped.
        assertEquals(1, sanitizeConversationFilters(obj("awaiting" to "only")).size)
        assertEquals(1, sanitizeConversationFilters(obj("awaiting" to "exclude")).size)
        assertEquals(0, sanitizeConversationFilters(obj("awaiting" to "all")).size)
        assertTrue(viewToSelection(obj("awaiting" to "only")).awaitingOnly)
        assertFalse(viewToSelection(obj("status" to "open")).awaitingOnly)
    }

    @Test
    fun `Mine is a tab, not an assignee chip`() {
        // The tab and the assignee are entangled the same way on web. A view
        // holding assigned_to_me must select the tab, or it would set a chip
        // the person cannot see and the list would look unfiltered.
        val selection = viewToSelection(obj("assigned_to_me" to true))
        assertEquals(InboxStatusTab.Mine, selection.tab)
        assertNull(selection.assigneeUserId)
        assertTrue(selection.assignedToMe)
    }

    @Test
    fun `matches the arrangement currently on screen`() {
        val selection = viewToSelection(obj("status" to "open", "unread" to true))
        assertTrue(viewMatchesSelection(obj("status" to "open", "unread" to true), selection))
        assertFalse(viewMatchesSelection(obj("status" to "open"), selection))
    }

    @Test
    fun `counts stop at the ceiling`() {
        assertEquals("0", formatViewCount(0))
        assertEquals("99", formatViewCount(SAVED_VIEW_COUNT_CEILING))
        assertEquals("99+", formatViewCount(SAVED_VIEW_COUNT_CEILING + 1))
        assertEquals("99+", formatViewCount(50_000))
    }

    @Test
    fun `suggests a name from what is filtered, and nothing for the whole inbox`() {
        val filtered = ViewSelection(
            tab = InboxStatusTab.Open,
            assigneeUserId = null,
            assignedToMe = false,
            tagId = null,
            unreadOnly = true,
            spamOnly = false,
            snoozedOnly = false,
            awaitingOnly = false,
        )
        assertEquals("Open · Unread", suggestViewName(filtered, locale))
        // Law 6: no em or en dash in rendered copy.
        assertFalse(suggestViewName(filtered, locale).contains("—"))
        assertFalse(suggestViewName(filtered, locale).contains("–"))

        val unfiltered = filtered.copy(tab = InboxStatusTab.All, unreadOnly = false)
        assertEquals("", suggestViewName(unfiltered, locale))
    }
}
