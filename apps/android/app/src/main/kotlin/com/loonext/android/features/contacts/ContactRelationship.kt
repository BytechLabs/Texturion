package com.loonext.android.features.contacts

import com.loonext.android.core.i18n.AppStrings

/**
 * #410 — how long they have been a customer, and how often, in one line.
 *
 * Hand-ported from `packages/shared/src/contact-relationship.ts`, whose
 * `CONTACT_RELATIONSHIP_CASES` table is the fixture this is pinned against
 * case for case (see ContactRelationshipTest). The same deal `SettingsLogic`
 * and `MentionLogic` already keep.
 *
 * Two facts and deliberately not a third: a count and a date are observations,
 * while a score or a segment is a judgement, and the line this product holds
 * is that it never tells a crew what a customer is worth.
 */

/*
 * #228 — catalogue KEYS. The old table was fixed rather than locale-derived
 * because a DEVICE locale is not a shared input; the app locale is, and every
 * screen here already resolves against it.
 */
private val MONTH_KEYS = listOf(
    "domain.monthJanuary", "domain.monthFebruary", "domain.monthMarch",
    "domain.monthApril", "domain.monthMay", "domain.monthJune",
    "domain.monthJuly", "domain.monthAugust", "domain.monthSeptember",
    "domain.monthOctober", "domain.monthNovember", "domain.monthDecember",
)

/**
 * "March 2026" from an ISO timestamp, or null when it cannot be read.
 *
 * Parsed off the STRING rather than through a date type, so a device timezone
 * cannot shift a midnight-UTC first conversation into the previous month on
 * one client and not another.
 */
fun monthYear(iso: String?, locale: String? = null): String? {
    val trimmed = iso?.trim().orEmpty()
    val match = Regex("""^(\d{4})-(\d{2})""").find(trimmed) ?: return null
    val key = MONTH_KEYS.getOrNull(match.groupValues[2].toInt() - 1) ?: return null
    return "${AppStrings.translate(locale, key)} ${match.groupValues[1]}"
}

/**
 * The identity line, or null when there is nothing worth saying.
 *
 * Null on a contact with no conversations — one somebody typed in, or one
 * whose history sits entirely on numbers this member cannot see. Both honestly
 * mean "nothing to tell you".
 */
fun contactRelationshipLine(
    conversationCount: Int?,
    firstConversationAt: String?,
    locale: String? = null,
): String? {
    val count = conversationCount ?: 0
    if (count <= 0) return null
    // One and many are separate keys: English gets away with an "s", a
    // language that agrees the noun with the number does not.
    val conversations = if (count == 1) {
        AppStrings.translate(locale, "domain.contactConversationOne")
    } else {
        AppStrings.translate(
            locale,
            "domain.contactConversationMany",
            mapOf("count" to count.toString()),
        )
    }
    val since = monthYear(firstConversationAt, locale)
    // A count with no date still earns its place: "3 conversations" answers
    // the question this exists for, and inventing a date would not.
    return if (since != null) {
        AppStrings.translate(
            locale,
            "domain.contactSince",
            mapOf("since" to since, "conversations" to conversations),
        )
    } else {
        conversations
    }
}

/**
 * Two, because the open conversation is one of them.
 *
 * Named rather than inlined so the three clients cannot drift apart on the
 * threshold — this mirrors `REPEAT_CUSTOMER_MINIMUM` in the shared module, not
 * the literal.
 */
const val REPEAT_CUSTOMER_MINIMUM = 2

/**
 * #505 — the THREAD-HEADER form of the same fact: a count, or nothing.
 *
 * The person who most needs to know they are talking to a five-time customer
 * is the one replying right now, and they are looking at the thread, not the
 * contact panel. But the header is a GLANCE surface and the panel is a READING
 * surface, so they do not carry the same weight of text: the panel says
 * "Customer since March 2026 · 7 conversations", the header says
 * "7 conversations".
 *
 * Silent below two on purpose. `conversation_count` counts every conversation
 * with this contact INCLUDING the open one, so a first-time caller reads
 * exactly 1 — a badge on every thread would be noise on the common case, and a
 * header that decorates everybody distinguishes nobody. Their header stays
 * byte-for-byte what it is today; being new is said by the ABSENCE of a badge.
 *
 * The count is the number-access-filtered one the server derived (#106/D88):
 * a member kept off a number must not learn the customer's history from a badge
 * either. Nothing here re-counts or re-filters anything.
 */
fun contactRepeatBadge(conversationCount: Int?, locale: String? = null): String? {
    val count = conversationCount ?: 0
    if (count < REPEAT_CUSTOMER_MINIMUM) return null
    // Always the plural key: the threshold is two, so this can never be one.
    return AppStrings.translate(
        locale,
        "domain.contactConversationMany",
        mapOf("count" to count.toString()),
    )
}
