package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #717: the default is offered once, as the inherit choice, never twice. */
class DefaultChoiceTest {

    @Test
    fun `the default's own value is not offered beside the inherit choice`() {
        assertFalse(offeredBesideDefault("en", "en", null))
        assertTrue(offeredBesideDefault("fr-CA", "en", null))
    }

    @Test
    fun `a record already set to the default's value keeps it as the state in force`() {
        assertTrue(offeredBesideDefault("en", "en", "en"))
    }

    @Test
    fun `an unknown default hides nothing`() {
        assertTrue(offeredBesideDefault("en", null, null))
        assertEquals(listOf(15, 20, 30), choicesBesideDefault(listOf(15, 20, 30), null, null))
    }

    @Test
    fun `choices drop only the default unless it is stored`() {
        val rings = listOf(15, 20, 30, 45)
        assertEquals(listOf(15, 20, 30), choicesBesideDefault(rings, 45, null))
        assertEquals(rings, choicesBesideDefault(rings, 45, 45))
        assertEquals(listOf(15, 20, 45), choicesBesideDefault(rings, 30, 45))
    }
}
