package com.loonext.android.features.compose

/**
 * Merge-field substitution — an exact Kotlin port of
 * packages/shared/src/merge-fields.ts, used for the composer's live preview.
 * The server applies the same function authoritatively at send time, so what
 * the user previews is exactly what ships.
 *
 * Supported tokens (curly-brace delimited, case-insensitive name):
 *   {first_name}     — the first whitespace-delimited token of the contact name.
 *   {business_name}  — the company name.
 *   {address}        — the contact's service address (#274).
 *   {my_name}        — the crew member sending it (#274).
 *   {our_number}     — the workspace number to reply to, formatted (#274).
 *   {job_day}        — the day of the next scheduled visit, e.g. "Tuesday".
 *   {job_time}       — the time of it, e.g. "2:00 PM".
 *
 * An unknown token, or a supported token whose value is null/empty, is dropped
 * CLEANLY — the literal never reaches the preview and no stray double-spaces
 * or dangling punctuation are left behind.
 */
object MergeFields {
    /** The literal tokens this substituter understands. */
    val TOKENS = listOf(
        "first_name",
        "business_name",
        "address",
        "my_name",
        "our_number",
        "job_day",
        "job_time",
    )

    /**
     * #274 — the tokens the template editor offers, in order. MIRROR of
     * MERGE_FIELD_VARIABLES in packages/shared.
     *
     * The list was duplicated in three editors before, and duplicated lists
     * drift: a token offered on the phone and not the laptop means a template
     * somebody writes here and then cannot maintain there.
     *
     * #228: the third element is a CATALOGUE KEY, not a sentence. This list is
     * a `val` read from a template editor and from the composer's preview, and
     * neither read happens in composition — so the description is resolved
     * where it is rendered, with `t(...)`.
     */
    val VARIABLES: List<Triple<String, String, String>> = listOf(
        Triple("first_name", "First name", "thread.mergeFirstName"),
        Triple("address", "Address", "thread.mergeAddress"),
        Triple("job_day", "Day", "thread.mergeJobDay"),
        Triple("job_time", "Time", "thread.mergeJobTime"),
        Triple("my_name", "My name", "thread.mergeMyName"),
        Triple("business_name", "Business", "thread.mergeBusinessName"),
        Triple("our_number", "Our number", "thread.mergeOurNumber"),
    )

    /**
     * #274 — stand-in values so a preview SHOWS each token working. MIRROR of
     * MERGE_FIELD_SAMPLES in packages/shared.
     *
     * Obvious placeholders, not plausible data: a real-looking address in a
     * preview gets mistaken for the customer's own and shipped unread.
     */
    const val SAMPLE_CONTACT = "Dana"
    const val SAMPLE_ADDRESS = "18 Rosewood Ave"
    const val SAMPLE_SENDER = "Sam"
    const val SAMPLE_JOB_DAY = "Tuesday"
    const val SAMPLE_JOB_TIME = "2:00 PM"

    /**
     * #274 — a NANP number as a person reads it. MIRROR of formatNanpNumber in
     * packages/shared. The number lands inside a customer's message, so its
     * formatting is a product fact rather than a display choice, and a preview
     * formatted differently from the wire defeats the point of previewing.
     */
    fun formatNanpNumber(e164: String): String {
        val match = Regex("""^\+1(\d{3})(\d{3})(\d{4})$""").find(e164)
            ?: return e164
        val (a, b, c) = match.destructured
        return "($a) $b-$c"
    }

    /** {token} where token is one of the supported names OR any [a-z_] word. */
    private val TOKEN_PATTERN =
        Regex("""\{([a-z_][a-z0-9_]*)\}""", RegexOption.IGNORE_CASE)

    /** First whitespace-delimited token of a name, or "" when there is none. */
    private fun firstName(contactName: String?): String {
        val trimmed = contactName?.trim().orEmpty()
        if (trimmed.isEmpty()) return ""
        return trimmed.split(Regex("""\s+""")).first()
    }

    private fun resolveToken(
        token: String,
        values: MergeValues,
    ): String = when (token) {
        "first_name" -> firstName(values.contactName)
        "business_name" -> values.businessName?.trim().orEmpty()
        // #274: one line, whatever the contact stored. Newlines are collapsed
        // because this lands mid-sentence ("on my way to {address}") and a
        // multi-line address there would break the message in two.
        "address" ->
            values.contactAddress?.replace(Regex("""\s*\n+\s*"""), ", ")?.trim().orEmpty()
        "my_name" -> firstName(values.senderName)
        "our_number" -> values.ourNumber?.trim().orEmpty()
        "job_day" -> values.jobDay?.trim().orEmpty()
        "job_time" -> values.jobTime?.trim().orEmpty()
        // Unknown token: drop it (never render the literal braces).
        else -> ""
    }

    /** The values a caller supplies. All optional — absent means "drop it". */
    data class MergeValues(
        val contactName: String? = null,
        val businessName: String? = null,
        val contactAddress: String? = null,
        val senderName: String? = null,
        val ourNumber: String? = null,
        val jobDay: String? = null,
        val jobTime: String? = null,
    )

    /**
     * Collapse the whitespace/punctuation artifacts left when a token resolves
     * to "" — "Hi {first_name}, thanks" with no name becomes "Hi, thanks", not
     * "Hi , thanks". Only runs when at least one token was dropped, so text
     * with no empty tokens is returned byte-for-byte unchanged.
     */
    private fun tidyDroppedTokens(text: String): String = text
        // " ," / " ." etc. left by a dropped token before punctuation.
        .replace(Regex("""[ \t]+([,.;:!?])"""), "$1")
        // Collapse runs of intra-line spaces/tabs to a single space.
        .replace(Regex("""[ \t]{2,}"""), " ")
        // Trim trailing spaces/tabs at end of each line.
        .replace(Regex("""[ \t]+$""", RegexOption.MULTILINE), "")
        // Trim leading spaces/tabs at start of each line.
        .replace(Regex("""^[ \t]+""", RegexOption.MULTILINE), "")

    /**
     * Substitute all {tokens} from the given values. Pure and side-effect
     * free; unknown or empty tokens are dropped and whitespace tidied.
     */
    fun applyMergeFields(text: String, values: MergeValues): String {
        if (!text.contains('{')) return text

        var anyDropped = false
        val substituted = TOKEN_PATTERN.replace(text) { match ->
            val token = match.groupValues[1].lowercase()
            val replacement = resolveToken(token, values)
            if (replacement.isEmpty()) anyDropped = true
            replacement
        }
        return if (anyDropped) tidyDroppedTokens(substituted) else substituted
    }

    /**
     * The two-token call every existing caller already makes. Kept so the
     * composer's preview and the away/MCTB previews are untouched by #274 —
     * those messages genuinely cannot carry the other five.
     */
    fun applyMergeFields(
        text: String,
        contactName: String? = null,
        businessName: String? = null,
    ): String = applyMergeFields(
        text,
        MergeValues(contactName = contactName, businessName = businessName),
    )

    /**
     * #274 — the TEMPLATE preview: every token resolved, so each one is seen
     * working. An unresolved {address} renders as nothing, which is exactly
     * what a broken token looks like.
     */
    fun previewTemplate(
        text: String,
        businessName: String?,
        ourNumberE164: String?,
    ): String = applyMergeFields(
        text,
        MergeValues(
            contactName = SAMPLE_CONTACT,
            businessName = businessName,
            contactAddress = SAMPLE_ADDRESS,
            senderName = SAMPLE_SENDER,
            ourNumber = ourNumberE164?.let { formatNanpNumber(it) },
            jobDay = SAMPLE_JOB_DAY,
            jobTime = SAMPLE_JOB_TIME,
        ),
    )

    /**
     * #274 — the tokens a CLIENT cannot resolve honestly. MIRROR of
     * SERVER_ONLY_TOKENS in packages/shared.
     *
     * {job_day}/{job_time} come from the conversation's next open due-dated
     * task. A composer could look that up in its own cache and usually be
     * right — and "usually right" is the worst possible property for a
     * preview, whose whole reason to exist is being exactly what ships.
     */
    val SERVER_ONLY_TOKENS = listOf("job_day", "job_time")

    /**
     * The note a composer preview appends when it cannot show the whole truth.
     *
     * #228: a catalogue KEY. The composer renders it with `t(...)`, which is
     * the only place it is read.
     */
    const val SERVER_ONLY_TOKENS_NOTE_KEY = "thread.serverOnlyTokensNote"

    /** True when `text` uses a token only the send path can resolve. */
    fun hasServerOnlyTokens(text: String): Boolean {
        if (!text.contains('{')) return false
        return TOKEN_PATTERN.findAll(text).any { match ->
            match.groupValues[1].lowercase() in SERVER_ONLY_TOKENS
        }
    }

    /** True when `text` contains at least one {token} this substituter handles. */
    fun hasMergeFields(text: String): Boolean {
        if (!text.contains('{')) return false
        return TOKEN_PATTERN.findAll(text).any { match ->
            match.groupValues[1].lowercase() in TOKENS
        }
    }
}
