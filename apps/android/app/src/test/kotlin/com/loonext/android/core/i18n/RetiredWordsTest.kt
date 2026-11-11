package com.loonext.android.core.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One word per thing. A task's labels and a conversation's tags are the same
 * list (`task_tags` takes its values from the workspace's tag vocabulary), so
 * English says "tag" everywhere. This reads every English value and fails when
 * "label" or "labels" appears, unless the key is named below with the reason
 * its word means something else.
 *
 * The roster is closed: an entry whose value no longer says "label" FAILS, so
 * it cannot outlive the copy it excuses.
 */
class RetiredWordsTest {
    private val labelWord = Regex("""\blabels?\b""", RegexOption.IGNORE_CASE)
    private val placeholder = Regex("""\{[A-Za-z0-9_]+}""")

    /** Key to why "label" is the right word there. */
    private val otherMeanings = mapOf(
        "contactsTasks.labelField" to "the name of a custom field's label",
        "contactsTasks.importPropertiesLead" to "a vCard label typed beside a number, a file-format term",
        "contactsTasks.importParameterNote" to "a vCard property parameter, a file-format term",
        "settings.screeningFlag" to "call screening flags a call with a caller-ID label",
    )

    /** Placeholders such as `{label}` name a variable, not a word the reader sees. */
    private fun readable(value: String) = placeholder.replace(value, "")

    @Test
    fun `no English value calls a tag a label`() {
        val all = AppStrings.en
        assertTrue("read only ${all.size} English values", all.size > 1000)

        val offenders = all
            .filter { (key, value) -> labelWord.containsMatchIn(readable(value)) && key !in otherMeanings }
            .map { (key, value) -> "$key: $value" }
        assertEquals("a tag is called a label", emptyList<String>(), offenders)
    }

    @Test
    fun `every named exception still says label`() {
        val stale = otherMeanings.keys.filter { key ->
            val value = AppStrings.en[key]
            value == null || !labelWord.containsMatchIn(readable(value))
        }
        assertEquals("exceptions that no longer match", emptyList<String>(), stale)
    }
}
