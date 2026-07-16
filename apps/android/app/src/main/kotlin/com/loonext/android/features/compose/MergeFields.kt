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
 *
 * An unknown token, or a supported token whose value is null/empty, is dropped
 * CLEANLY — the literal never reaches the preview and no stray double-spaces
 * or dangling punctuation are left behind.
 */
object MergeFields {
    /** The literal tokens this substituter understands. */
    val TOKENS = listOf("first_name", "business_name")

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
        contactName: String?,
        businessName: String?,
    ): String = when (token) {
        "first_name" -> firstName(contactName)
        "business_name" -> businessName?.trim().orEmpty()
        // Unknown token: drop it (never render the literal braces).
        else -> ""
    }

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
    fun applyMergeFields(
        text: String,
        contactName: String? = null,
        businessName: String? = null,
    ): String {
        if (!text.contains('{')) return text

        var anyDropped = false
        val substituted = TOKEN_PATTERN.replace(text) { match ->
            val token = match.groupValues[1].lowercase()
            val replacement = resolveToken(token, contactName, businessName)
            if (replacement.isEmpty()) anyDropped = true
            replacement
        }
        return if (anyDropped) tidyDroppedTokens(substituted) else substituted
    }

    /** True when `text` contains at least one {token} this substituter handles. */
    fun hasMergeFields(text: String): Boolean {
        if (!text.contains('{')) return false
        return TOKEN_PATTERN.findAll(text).any { match ->
            match.groupValues[1].lowercase() in TOKENS
        }
    }
}
