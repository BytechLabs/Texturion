package com.loonext.android.features.contacts

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

private val MONTHS = listOf(
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

/**
 * "March 2026" from an ISO timestamp, or null when it cannot be read.
 *
 * Parsed off the STRING rather than through a date type, so a device timezone
 * cannot shift a midnight-UTC first conversation into the previous month on
 * one client and not another.
 */
fun monthYear(iso: String?): String? {
    val trimmed = iso?.trim().orEmpty()
    val match = Regex("""^(\d{4})-(\d{2})""").find(trimmed) ?: return null
    val month = MONTHS.getOrNull(match.groupValues[2].toInt() - 1) ?: return null
    return "$month ${match.groupValues[1]}"
}

/**
 * The identity line, or null when there is nothing worth saying.
 *
 * Null on a contact with no conversations — one somebody typed in, or one
 * whose history sits entirely on numbers this member cannot see. Both honestly
 * mean "nothing to tell you".
 */
fun contactRelationshipLine(conversationCount: Int?, firstConversationAt: String?): String? {
    val count = conversationCount ?: 0
    if (count <= 0) return null
    val conversations = if (count == 1) "1 conversation" else "$count conversations"
    val since = monthYear(firstConversationAt)
    // A count with no date still earns its place: "3 conversations" answers
    // the question this exists for, and inventing a date would not.
    return if (since != null) "Customer since $since · $conversations" else conversations
}
