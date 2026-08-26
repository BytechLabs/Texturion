package com.loonext.android.features.inbox

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.BulkAppliedRow
import com.loonext.android.core.model.BulkConversationsResult
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #275 — the selection semantics, asserted against the same cases as the web
 * twin (`bulk-selection.test.ts`).
 *
 * This file exists because the logic is HAND-PORTED. The web module and this one
 * are two implementations of one rule, and the rule is: THE UI MUST NEVER CLAIM A
 * NUMBER IT DOES NOT HAVE. A bar reading "340 selected" that acts on the 25 paged
 * rows is the failure #275 names, and it is the kind of thing a port loses
 * silently.
 */
class BulkSelectionTest {
    private val loaded = listOf("a", "b", "c")

    @Test
    fun `empty hides the bar`() {
        assertTrue(BulkSelection.EMPTY.isEmpty())
        assertFalse(selectLoaded(loaded).isEmpty())
        assertFalse(BulkSelection.Filter.isEmpty())
    }

    @Test
    fun `sends ids for a pointed-at selection and null for filter mode`() {
        // null is the instruction "you resolve it" — the server then applies the
        // #106 deny list to a set the client never enumerated.
        assertEquals(listOf("a", "b"), selectLoaded(listOf("b", "a")).idsOrNull()?.sorted())
        assertEquals(null, BulkSelection.Filter.idsOrNull())
    }

    @Test
    fun `filter mode checks every row including ones not loaded yet`() {
        assertTrue(BulkSelection.Filter.isRowSelected("a"))
        assertTrue(BulkSelection.Filter.isRowSelected("not-paged-in-yet"))
    }

    @Test
    fun `id mode checks only the named rows`() {
        val some = selectLoaded(listOf("a"))
        assertTrue(some.isRowSelected("a"))
        assertFalse(some.isRowSelected("b"))
    }

    @Test
    fun `the label never invents a total`() {
        assertEquals("1 selected", selectLoaded(listOf("a")).label())
        assertEquals("3 selected", selectLoaded(loaded).label())
        // The honest phrasing: no digits at all, because we do not know the number.
        val filterLabel = BulkSelection.Filter.label()
        assertEquals("All matching this filter", filterLabel)
        assertFalse(filterLabel.any { it.isDigit() })
    }

    @Test
    fun `unticking in filter mode collapses to the loaded rows minus that one`() {
        val next = BulkSelection.Filter.toggleRow("b", loaded)
        assertTrue(next is BulkSelection.Ids)
        assertEquals(listOf("a", "c"), next.idsOrNull()?.sorted())
        assertFalse(next.isRowSelected("b"))
    }

    @Test
    fun `toggling a row on and off in id mode`() {
        var sel = BulkSelection.EMPTY.toggleRow("a", loaded)
        assertEquals(listOf("a"), sel.idsOrNull())
        sel = sel.toggleRow("a", loaded)
        assertTrue(sel.isEmpty())
    }

    @Test
    fun `the escalation is offered only when it means something`() {
        assertTrue(selectLoaded(loaded).canEscalate(loaded, hasMore = true))
        // Not before the page is fully ticked.
        assertFalse(selectLoaded(listOf("a")).canEscalate(loaded, hasMore = true))
        // Not when everything is already loaded: escalating to the same set while
        // phrasing it as bigger teaches the user the options differ when they do not.
        assertFalse(selectLoaded(loaded).canEscalate(loaded, hasMore = false))
        assertFalse(BulkSelection.Filter.canEscalate(loaded, hasMore = true))
        assertFalse(BulkSelection.EMPTY.canEscalate(emptyList(), hasMore = true))
    }

    @Test
    fun `the result message counts what the server applied`() {
        assertEquals(
            "Closed 2 conversations",
            bulkResultMessage("Closed", applied = 2, failed = 0, matched = 2, capped = false),
        )
        assertEquals(
            "Closed 1 conversation",
            bulkResultMessage("Closed", applied = 1, failed = 0, matched = 1, capped = false),
        )
    }

    @Test
    fun `the result message localizes French grammar and plural verbs`() {
        assertEquals(
            "Terminée 1 tâche",
            bulkResultMessage(
                verb = "Terminée",
                verbMany = "Terminées",
                applied = 1,
                failed = 0,
                matched = 1,
                capped = false,
                nounOne = "tâche",
                nounMany = "tâches",
                locale = "fr-CA",
            ),
        )
        assertEquals(
            "Terminées 2 tâches",
            bulkResultMessage(
                verb = "Terminée",
                verbMany = "Terminées",
                applied = 2,
                failed = 0,
                matched = 2,
                capped = false,
                nounOne = "tâche",
                nounMany = "tâches",
                locale = "fr-CA",
            ),
        )
    }

    @Test
    fun `inbox French verbs agree with one or many conversations`() {
        val one = AppStrings.translate("fr-CA", "inbox.bulkVerbClosedOne")
        val many = AppStrings.translate("fr-CA", "inbox.bulkVerbClosedMany")

        assertEquals(
            "Fermée 1 conversation",
            bulkResultMessage(
                verb = one,
                verbMany = many,
                applied = 1,
                failed = 0,
                matched = 1,
                capped = false,
                locale = "fr-CA",
            ),
        )
        assertEquals(
            "Fermées 2 conversations",
            bulkResultMessage(
                verb = one,
                verbMany = many,
                applied = 2,
                failed = 0,
                matched = 2,
                capped = false,
                locale = "fr-CA",
            ),
        )
    }

    @Test
    fun `the result message names the remainder when the cap was hit`() {
        val message =
            bulkResultMessage("Closed", applied = 500, failed = 0, matched = 640, capped = true)
        assertTrue(message.contains("Closed 500 conversations"))
        assertTrue(message.contains("140 more matched"))
        assertTrue(message.contains("run it again"))
    }

    @Test
    fun `the result message names rows it could not reach`() {
        // The #275 acceptance criterion: never a toast that lies.
        val one =
            bulkResultMessage("Marked read", applied = 3, failed = 1, matched = 4, capped = false)
        assertTrue(one.contains("1 couldn't be reached"))
        assertTrue(one.contains("was left alone"))
        val many =
            bulkResultMessage("Closed", applied = 1, failed = 2, matched = 3, capped = false)
        assertTrue(many.contains("2 couldn't be reached"))
        assertTrue(many.contains("were left alone"))
    }

    @Test
    fun `zero applied reads honestly rather than as a win`() {
        val message =
            bulkResultMessage("Closed", applied = 0, failed = 1, matched = 1, capped = false)
        assertTrue(message.contains("Closed 0 conversations"))
        assertTrue(message.contains("couldn't be reached"))
    }

    @Test
    fun `the copy matches the web twin verbatim`() {
        // Two implementations of one rule. If the wording drifts, the same action
        // reads differently depending on which device the crew member picked up.
        assertEquals(
            "Closed 500 conversations. 140 more matched than one go can handle, so run it again",
            bulkResultMessage("Closed", applied = 500, failed = 0, matched = 640, capped = true),
        )
        assertEquals(
            "Marked read 3 conversations. 1 couldn't be reached and was left alone",
            bulkResultMessage("Marked read", applied = 3, failed = 1, matched = 4, capped = false),
        )
    }

    // ------------------------------------------------------------------
    // #275 — bulkUndoPlan. One undo for the whole operation, grouped by prior
    // value, restoring what each row ACTUALLY was.
    // ------------------------------------------------------------------

    private fun applied(vararg pairs: Pair<String, JsonObject>) =
        BulkConversationsResult(
            action = "set_status",
            matched = pairs.size,
            applied = pairs.map { BulkAppliedRow(it.first, it.second) },
        )

    private fun previous(key: String, value: JsonElement) =
        JsonObject(mapOf(key to value))

    @Test
    fun `a mixed-status close undoes as one call per prior status`() {
        // Not three hundred calls, and not a uniform "open" — a thread that was
        // `new` or `waiting` must come back as that, or the undo quietly loses the
        // fact that nobody had replied to it yet.
        val plan = bulkUndoPlan(
            applied(
                "a" to previous("status", JsonPrimitive("open")),
                "b" to previous("status", JsonPrimitive("new")),
                "c" to previous("status", JsonPrimitive("open")),
                "d" to previous("status", JsonPrimitive("waiting")),
            ),
        )
        assertEquals(3, plan?.size)
        assertEquals(
            listOf("a", "c"),
            plan?.first { it.targetStatus == "open" }?.ids,
        )
        assertEquals(listOf("b"), plan?.first { it.targetStatus == "new" }?.ids)
        assertEquals(listOf("d"), plan?.first { it.targetStatus == "waiting" }?.ids)
    }

    @Test
    fun `a null prior assignee undoes as an explicit unassign`() {
        // The server needs the null said out loud, not inferred from a missing field.
        val plan = bulkUndoPlan(
            BulkConversationsResult(
                action = "assign",
                matched = 2,
                applied = listOf(
                    BulkAppliedRow("a", previous("assigned_user_id", JsonNull)),
                    BulkAppliedRow("b", previous("assigned_user_id", JsonPrimitive("u1"))),
                ),
            ),
        )
        assertEquals(2, plan?.size)
        val unassigned = plan?.first { it.unassign }
        assertEquals(listOf("a"), unassigned?.ids)
        assertEquals(null, unassigned?.targetUserId)
        assertEquals(listOf("b"), plan?.first { it.targetUserId == "u1" }?.ids)
    }

    @Test
    fun `undoing add_tag touches only the rows that did not already have it`() {
        // Otherwise the undo strips a tag somebody applied by hand months ago — a
        // bulk action destroying data it never created.
        val plan = bulkUndoPlan(
            BulkConversationsResult(
                action = "add_tag",
                matched = 2,
                applied = listOf(
                    BulkAppliedRow("already", previous("had_tag", JsonPrimitive(true))),
                    BulkAppliedRow("fresh", previous("had_tag", JsonPrimitive(false))),
                ),
            ),
        )
        assertEquals(1, plan?.size)
        assertEquals("remove_tag", plan?.first()?.action)
        assertEquals(listOf("fresh"), plan?.first()?.ids)
    }

    @Test
    fun `undoing remove_tag restores only the rows that had it`() {
        val plan = bulkUndoPlan(
            BulkConversationsResult(
                action = "remove_tag",
                matched = 2,
                applied = listOf(
                    BulkAppliedRow("had", previous("had_tag", JsonPrimitive(true))),
                    BulkAppliedRow("never", previous("had_tag", JsonPrimitive(false))),
                ),
            ),
        )
        assertEquals(1, plan?.size)
        assertEquals("add_tag", plan?.first()?.action)
        assertEquals(listOf("had"), plan?.first()?.ids)
    }

    @Test
    fun `mark_read offers no undo at all`() {
        // "Unread" is the absence of a read receipt, so there is no prior state to
        // restore and nobody asks to un-read three hundred threads.
        val plan = bulkUndoPlan(
            BulkConversationsResult(
                action = "mark_read",
                matched = 2,
                applied = listOf(
                    BulkAppliedRow("a", JsonObject(emptyMap())),
                    BulkAppliedRow("b", JsonObject(emptyMap())),
                ),
            ),
        )
        assertEquals(null, plan)
    }

    @Test
    fun `an unexpected previous shape is skipped rather than crashing`() {
        // Server JSON. A client that threw here would take the inbox down over an
        // undo button.
        val plan = bulkUndoPlan(
            applied("a" to JsonObject(mapOf("status" to JsonNull))),
        )
        assertEquals(null, plan)
    }
}
