package com.loonext.android.features.thread

import org.junit.Assert.assertEquals
import org.junit.Test

/** Cursor-append and page-1-merge reducers (SPEC §7 keyset pagination). */
class PagingTest {

    private data class Row(val id: String, val at: String)

    private fun row(id: String, at: String) = Row(id, at)

    @Test
    fun `appendPage adds older rows after existing`() {
        val existing = listOf(row("c", "3"), row("b", "2"))
        val page = listOf(row("a", "1"))
        assertEquals(
            listOf("c", "b", "a"),
            appendPage(existing, page) { it.id }.map { it.id },
        )
    }

    @Test
    fun `appendPage drops overlap rows already present`() {
        val existing = listOf(row("c", "3"), row("b", "2"))
        val page = listOf(row("b", "2"), row("a", "1"))
        assertEquals(
            listOf("c", "b", "a"),
            appendPage(existing, page) { it.id }.map { it.id },
        )
    }

    @Test
    fun `appendPage with an empty page returns existing unchanged`() {
        val existing = listOf(row("a", "1"))
        assertEquals(existing, appendPage(existing, emptyList()) { it.id })
    }

    @Test
    fun `mergeFirstPage replaces stale copies and re-sorts DESC`() {
        val existing = listOf(row("b", "2"), row("a", "1"))
        // Row "a" got a new message and floats to the top.
        val fresh = listOf(row("a", "5"), row("b", "2"))
        val merged = mergeFirstPage(existing, fresh, { it.id }, { it.at })
        assertEquals(listOf("a", "b"), merged.map { it.id })
        assertEquals("5", merged.first().at)
    }

    @Test
    fun `mergeFirstPage keeps deeper pages that fell out of the fresh window`() {
        val existing = listOf(row("c", "3"), row("b", "2"), row("a", "1"))
        val fresh = listOf(row("d", "4"), row("c", "3"))
        val merged = mergeFirstPage(existing, fresh, { it.id }, { it.at })
        assertEquals(listOf("d", "c", "b", "a"), merged.map { it.id })
    }

    @Test
    fun `mergeFirstPage tiebreaks equal sort keys by id DESC`() {
        val merged = mergeFirstPage(
            listOf(row("a", "1")),
            listOf(row("b", "1")),
            { it.id },
            { it.at },
        )
        assertEquals(listOf("b", "a"), merged.map { it.id })
    }

    @Test
    fun `dropVanished keeps rows older than the fresh window`() {
        val merged = listOf(row("d", "4"), row("c", "3"), row("a", "1"))
        val kept = dropVanishedFromFirstWindow(
            merged = merged,
            freshFirstPageIds = setOf("d", "c"),
            oldestFreshSortKey = "3",
            idOf = { it.id },
            sortKey = { it.at },
        )
        assertEquals(listOf("d", "c", "a"), kept.map { it.id })
    }

    @Test
    fun `dropVanished removes a row inside the fresh window that vanished`() {
        // "b" (at=3.5) sorts inside the fresh window but is not in it — it no
        // longer matches the filter (e.g. closed elsewhere) and must go.
        val merged = listOf(row("d", "4"), row("b", "3.5"), row("c", "3"), row("a", "1"))
        val kept = dropVanishedFromFirstWindow(
            merged = merged,
            freshFirstPageIds = setOf("d", "c"),
            oldestFreshSortKey = "3",
            idOf = { it.id },
            sortKey = { it.at },
        )
        assertEquals(listOf("d", "c", "a"), kept.map { it.id })
    }

    @Test
    fun `dropVanished with a null oldest key keeps only the fresh page`() {
        val merged = listOf(row("d", "4"), row("a", "1"))
        val kept = dropVanishedFromFirstWindow(
            merged = merged,
            freshFirstPageIds = setOf("d"),
            oldestFreshSortKey = null,
            idOf = { it.id },
            sortKey = { it.at },
        )
        assertEquals(listOf("d"), kept.map { it.id })
    }
}
