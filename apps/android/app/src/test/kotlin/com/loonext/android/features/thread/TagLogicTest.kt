package com.loonext.android.features.thread

import com.loonext.android.core.model.Tag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Create-on-attach resolution (#165): the sheet must attach an EXISTING tag
 * when the typed name matches one (case-insensitively — tags_name_uq is on
 * lower(name)) and only create when the name is genuinely new.
 */
class TagLogicTest {

    private fun tag(id: String, name: String) = Tag(id = id, name = name)

    private val existing = listOf(
        tag("t1", "Estimate"),
        tag("t2", "Follow up"),
    )

    @Test
    fun `blank input resolves to nothing`() {
        assertNull(resolveTagInput("", existing))
        assertNull(resolveTagInput("   ", existing))
    }

    @Test
    fun `over-limit input resolves to nothing`() {
        assertNull(resolveTagInput("x".repeat(TAG_NAME_MAX + 1), existing))
    }

    @Test
    fun `input at the limit still resolves`() {
        val name = "x".repeat(TAG_NAME_MAX)
        assertEquals(TagAttachPlan.CreateNew(name), resolveTagInput(name, existing))
    }

    @Test
    fun `exact name attaches the existing tag by id`() {
        assertEquals(
            TagAttachPlan.Existing(existing[0]),
            resolveTagInput("Estimate", existing),
        )
    }

    @Test
    fun `match is case-insensitive like the server's create-on-attach`() {
        assertEquals(
            TagAttachPlan.Existing(existing[1]),
            resolveTagInput("FOLLOW UP", existing),
        )
    }

    @Test
    fun `surrounding whitespace is trimmed before matching`() {
        assertEquals(
            TagAttachPlan.Existing(existing[0]),
            resolveTagInput("  estimate  ", existing),
        )
    }

    @Test
    fun `an unknown name plans a create with the trimmed name`() {
        assertEquals(
            TagAttachPlan.CreateNew("Warranty"),
            resolveTagInput("  Warranty ", existing),
        )
    }

    @Test
    fun `no loaded tags means every valid name creates`() {
        assertEquals(
            TagAttachPlan.CreateNew("Estimate"),
            resolveTagInput("Estimate", emptyList()),
        )
    }
}
