package com.loonext.android.features.settings

import com.loonext.android.core.i18n.SETTINGS_INDEX
import com.loonext.android.core.i18n.SettingsIndexEntry
import java.text.Normalizer
import java.util.Locale

internal data class SettingsSearchResult(
    val entry: SettingsIndexEntry,
    /** The text to show: the entry's first word in the viewer's language. */
    val label: String,
    /** 0 when the query matched the label, 1 for a synonym. */
    val rank: Int,
)

private val COMBINING_MARKS = Regex("[\u0300-\u036f]")
private val NOT_WORD = Regex("[^a-z0-9]+")

/** Lowercase, accents and punctuation removed, one space between words. */
internal fun normalizeSettingsQuery(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD)
        .replace(COMBINING_MARKS, "")
        .lowercase(Locale.ROOT)
        .replace(NOT_WORD, " ")
        .trim()

private fun String.from(index: Int): String = if (index >= length) "" else substring(index)

/** Is [a] within one edit (insert, delete, replace, swap) of [b]? */
private fun withinOneEdit(a: String, b: String): Boolean {
    if (a == b) return true
    val gap = a.length - b.length
    if (kotlin.math.abs(gap) > 1) return false
    var i = 0
    while (i < a.length && i < b.length && a[i] == b[i]) i++
    if (gap == 0) {
        if (a.from(i + 1) == b.from(i + 1)) return true
        return a.getOrNull(i) == b.getOrNull(i + 1) &&
            a.getOrNull(i + 1) == b.getOrNull(i) &&
            a.from(i + 2) == b.from(i + 2)
    }
    return if (gap > 0) a.from(i + 1) == b.from(i) else b.from(i + 1) == a.from(i)
}

/** Does [word] start with [token], give or take one typo in a long token? */
private fun wordMatches(token: String, word: String, allowTypo: Boolean): Boolean {
    if (word.startsWith(token)) return true
    if (!allowTypo || token.length < 4) return false
    for (length in intArrayOf(token.length - 1, token.length, token.length + 1)) {
        if (length > 0 && withinOneEdit(token, word.take(length))) return true
    }
    return false
}

private fun phraseMatches(query: String, phrase: String): Boolean {
    val words = phrase.split(" ")
    val tokens = query.split(" ")
    // A typo is forgiven only in a one-word query; across two words it lets
    // "zone" find "one" and the list fills with noise.
    val allowTypo = tokens.size == 1
    if (tokens.all { token -> words.any { word -> wordMatches(token, word, allowTypo) } }) return true
    // "timezone" typed for "time zone", and the other way round.
    val joined = query.replace(" ", "")
    return joined.length >= 3 && phrase.replace(" ", "").startsWith(joined)
}

/**
 * The settings that match [query], label matches first, then synonyms, each
 * group in index order. Only sections [canSee] allows are searched.
 */
internal fun searchSettings(
    query: String,
    locale: String?,
    canSee: (section: String) -> Boolean,
): List<SettingsSearchResult> {
    val q = normalizeSettingsQuery(query)
    if (q.isEmpty()) return emptyList()
    val french = locale?.startsWith("fr") == true
    val results = ArrayList<SettingsSearchResult>()
    for (item in SETTINGS_INDEX) {
        if (!canSee(item.section)) continue
        val words = if (french) item.fr else item.en
        val label = words.firstOrNull() ?: continue
        val rank = when {
            phraseMatches(q, normalizeSettingsQuery(label)) -> 0
            words.drop(1).any { phraseMatches(q, normalizeSettingsQuery(it)) } -> 1
            else -> -1
        }
        if (rank >= 0) results.add(SettingsSearchResult(item, label, rank))
    }
    return results.sortedBy { it.rank }
}

/** The phone section an entry opens, or null when this phone has no such screen. */
internal fun phoneSectionOf(entry: SettingsIndexEntry): SettingsSection? = when (entry.section) {
    "hours" ->
        if (entry.page == "automatic-texts") SettingsSection.AutomaticTexts else SettingsSection.Hours
    // Sign-in, password, two-factor and account deletion live under Profile here.
    "account" -> SettingsSection.Profile
    else -> SettingsSection.entries.firstOrNull { it.sharedId == entry.section }
}

/** A result on this phone: the setting, where it sits, and what opening it does. */
internal data class PhoneSettingResult(
    val entry: SettingsIndexEntry,
    val label: String,
    val group: SettingsGroup,
    val section: SettingsSection,
)

/**
 * Search for this role. A setting is offered only when its section is one the
 * role can open (the same rule as the list) and this phone has a screen for it.
 */
internal fun searchPhoneSettings(
    query: String,
    locale: String?,
    role: String?,
): List<PhoneSettingResult> {
    val visible = visibleSettingsSections(role).toSet()
    return searchSettings(query, locale) { shared ->
        shared == "account" && SettingsSection.Profile in visible ||
            visible.any { it.sharedId == shared }
    }.mapNotNull { result ->
        val section = phoneSectionOf(result.entry)?.takeIf { it in visible } ?: return@mapNotNull null
        PhoneSettingResult(result.entry, result.label, settingsGroupOf(section), section)
    }
}
