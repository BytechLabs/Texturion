package com.loonext.android.features.settings

import com.loonext.android.core.model.Template
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #274 — how a template list stops collapsing at thirty.
 *
 * The same vectors as apps/web settings/templates/grouping.test.ts. What is
 * pinned is the rule that makes grouping worth having in a workspace that has
 * not adopted it: an ungrouped template must not acquire an invented group.
 */
class TemplateGroupingTest {
    private fun template(name: String, category: String? = null) = Template(
        id = name,
        name = name,
        body = "…",
        category = category,
        created_at = "2026-08-01T00:00:00.000Z",
        updated_at = "2026-08-01T00:00:00.000Z",
    )

    @Test
    fun `gathers a category together under its own name`() {
        val groups = groupTemplates(
            listOf(
                template("Quote sent", "Quoting"),
                template("On my way", "Dispatch"),
                template("Quote reminder", "Quoting"),
            ),
        )
        assertEquals(listOf("Dispatch", "Quoting"), groups.map { it.first })
        assertEquals(
            listOf("Quote sent", "Quote reminder"),
            groups[1].second.map { it.name },
        )
    }

    @Test
    fun `puts ungrouped templates last, under NO heading`() {
        // Not a category called "Other". A heading invents a group the crew did
        // not make, and it would sit over every row in a shop that never uses
        // categories.
        val groups = groupTemplates(
            listOf(template("On my way"), template("Quote sent", "Quoting")),
        )
        assertEquals(listOf("Quoting", null), groups.map { it.first })
        assertEquals(listOf("On my way"), groups[1].second.map { it.name })
    }

    @Test
    fun `returns one unlabelled group when nothing is categorised`() {
        // The common shop. It must look exactly like the flat list it was.
        val groups = groupTemplates(listOf(template("A"), template("B")))
        assertEquals(1, groups.size)
        assertEquals(null, groups[0].first)
        assertEquals(2, groups[0].second.size)
    }

    @Test
    fun `treats a blank category as no category`() {
        // The API normalises "" to null, but a row that slipped through with
        // whitespace must not open a group headed by nothing.
        val groups = groupTemplates(listOf(template("A", "   "), template("B", "")))
        assertEquals(listOf(null), groups.map { it.first })
        assertEquals(2, groups[0].second.size)
    }

    @Test
    fun `loses no template, whatever the mix`() {
        val rows = listOf(
            template("A", "Quoting"),
            template("B"),
            template("C", "Dispatch"),
            template("D", "Quoting"),
        )
        assertEquals(rows.size, groupTemplates(rows).sumOf { it.second.size })
    }
}
