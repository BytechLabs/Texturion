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

    /** "Thread" is retired for "conversation", the record the menus already name. */
    private val threadWord = Regex("""\bthreads?\b""", RegexOption.IGNORE_CASE)

    /**
     * "Line" meaning a phone line is retired for "number". "Line" keeps its other
     * meanings (a line of text, "Line of work", `{line}`), so the bare word is not
     * banned: this matches the phrases a phone line turns up in.
     */
    private val phoneLine = Regex(
        """\b(?:(?:this|that|each|every)\s+line\b|(?:business|phone|shop|office|field|shared)\s+lines?\b|(?:this|that|a|the)\s+line's|the\s+line\s+(?:you|they)\b|line\s+(?:busy|paused|ready)\b|on\s+the\s+line\b)""",
        RegexOption.IGNORE_CASE,
    )

    /** Key to why "thread" is the right word there. */
    private val threadOtherMeanings = emptyMap<String, String>()

    /** Key to why "line" is not a phone line there. */
    private val lineOtherMeanings = mapOf(
        "settings.aiCatchUpHelp" to "every line of a catch-up is a line of text quoting a message",
    )

    /** Placeholders such as `{label}` name a variable, not a word the reader sees. */
    private fun readable(value: String) = placeholder.replace(value, "")

    @Test
    fun `no English value calls a conversation a thread`() {
        val offenders = AppStrings.en
            .filter { (key, value) -> threadWord.containsMatchIn(readable(value)) && key !in threadOtherMeanings }
            .map { (key, value) -> "$key: $value" }
        assertEquals("a conversation is called a thread", emptyList<String>(), offenders)
    }

    @Test
    fun `every thread exception still says thread`() {
        val stale = threadOtherMeanings.keys.filter { key ->
            val value = AppStrings.en[key]
            value == null || !threadWord.containsMatchIn(readable(value))
        }
        assertEquals("exceptions that no longer match", emptyList<String>(), stale)
    }

    @Test
    fun `no English value calls a phone number a line`() {
        val offenders = AppStrings.en
            .filter { (key, value) -> phoneLine.containsMatchIn(readable(value)) && key !in lineOtherMeanings }
            .map { (key, value) -> "$key: $value" }
        assertEquals("a phone number is called a line", emptyList<String>(), offenders)
    }

    @Test
    fun `every line exception still matches`() {
        val stale = lineOtherMeanings.keys.filter { key ->
            val value = AppStrings.en[key]
            value == null || !phoneLine.containsMatchIn(readable(value))
        }
        assertEquals("exceptions that no longer match", emptyList<String>(), stale)
    }

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

    /** #755: the audit log was "History" in the nav and "Activity log" in search. */
    private val auditLogOldNames = Regex("""^\s*history\s*$|\bactivity log\b""", RegexOption.IGNORE_CASE)

    @Test
    fun `no English value names the audit log History or Activity log`() {
        val offenders = AppStrings.en
            .filter { (_, value) -> auditLogOldNames.containsMatchIn(readable(value)) }
            .map { (key, value) -> "$key: $value" }
        assertEquals("the audit log is called something else", emptyList<String>(), offenders)
    }

    /** French names it "Journal d'audit"; "Historique" alone was the nav name. */
    private val auditLogOldNamesFr = Regex("""^\s*historique\s*$|\bjournal d['’]activité\b""", RegexOption.IGNORE_CASE)

    @Test
    fun `no French value names the audit log Historique or Journal d'activité`() {
        assertTrue("the French catalogue is empty", AppStrings.frCA.isNotEmpty())
        val offenders = AppStrings.frCA
            .filter { (_, value) -> auditLogOldNamesFr.containsMatchIn(readable(value)) }
            .map { (key, value) -> "$key: $value" }
        assertEquals("the audit log is called something else", emptyList<String>(), offenders)
    }

    /**
     * A settings heading names its sections, and the one that read "Help and
     * history" held the audit log, so no heading or nav label says history.
     */
    @Test
    fun `no settings heading says history in English or French`() {
        val historyWord = Regex("""\bhistor(?:y|ique)\b""", RegexOption.IGNORE_CASE)
        val headings = (AppStrings.en.entries + AppStrings.frCA.entries)
            .filter { it.key.startsWith("settingsMore.group") || it.key.startsWith("settingsMore.nav") }
        assertTrue("no settings headings were found", headings.isNotEmpty())
        val offenders = headings
            .filter { historyWord.containsMatchIn(readable(it.value)) }
            .map { "${it.key}: ${it.value}" }
        assertEquals("a settings heading says history", emptyList<String>(), offenders)
    }

    /**
     * {ago} is filled with a timestamp label ("5m", "Yesterday", "Jul 14"), so a
     * sentence that adds "ago" reads "Joined Jul 14 ago".
     */
    @Test
    fun `no value with an ago slot also says ago`() {
        val saysAgo = Regex("""\bago\b|\bil y a\b""", RegexOption.IGNORE_CASE)
        val slots = (AppStrings.en.entries + AppStrings.frCA.entries).filter { it.value.contains("{ago}") }
        assertTrue("no value carries an {ago} slot", slots.isNotEmpty())
        val offenders = slots
            .filter { saysAgo.containsMatchIn(readable(it.value)) }
            .map { "${it.key}: ${it.value}" }
        assertEquals("a timestamp label is read as a duration", emptyList<String>(), offenders)
    }
}
