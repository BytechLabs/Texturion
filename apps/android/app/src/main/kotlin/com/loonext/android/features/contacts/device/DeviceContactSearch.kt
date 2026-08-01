package com.loonext.android.features.contacts.device

/**
 * #459 — searching the phone's own address book, shown beside the crew's.
 *
 * WHY THE TWO LISTS STAY SEPARATE. The Contacts tab is the crew's SHARED book:
 * the people this workspace texts, with history, tasks and opt-out state
 * attached. A phone's personal address book is a different thing — a dentist, a
 * brother-in-law, four hundred numbers nobody else on the crew has ever seen.
 * Merging them would bury the shared book under somebody's personal one, and the
 * shared book is what the product is for.
 *
 * WHY THE FILTER IS LOCAL. These rows never leave the phone. Reading the address
 * book is a permission granted for matching names, not a licence to upload it,
 * so there is no server to ask. The book is already in memory because the dialer
 * loaded it, and the result is capped.
 *
 * Hand-port of `packages/shared/src/device-contacts.ts`, with the same cases
 * asserted in `DeviceContactSearchTest`. Word starts are found by hand rather
 * than with a regex boundary: `\b` is a backspace character in a Kotlin string,
 * so it would compile and silently match nothing.
 */

/** How many device rows a list shows before it says there are more. */
const val MAX_DEVICE_CONTACT_ROWS = 50

/** Fewest characters before a device search runs. Below this, show the head. */
const val MIN_DEVICE_QUERY = 1

/**
 * One row as the LIST holds it: a name, and the number to reach it on.
 *
 * Distinct from [DeviceContactRow], which is the raw ContactsContract cursor
 * tuple. One is what the device gave us; this is what a person reads.
 */
data class DeviceContactListRow(
    /** Stable per device book — the ContactsContract lookup key. */
    val id: String,
    val name: String,
    /** E.164 when the number is NANP, otherwise whatever the device stored. */
    val number: String,
)

/** The rows to show for a query, and whether the cap hid any. */
data class DeviceContactPage(
    val rows: List<DeviceContactListRow>,
    val truncated: Boolean,
)

/**
 * True when a device row answers what somebody typed.
 *
 * Names match at WORD STARTS, the same rule the dialer uses: "sm" finds "Dana
 * Smith" and not "Kasm Roofing". Numbers match as a substring of the digits,
 * because somebody searching by number is usually typing the tail of one they
 * half-remember.
 */
fun deviceContactMatches(row: DeviceContactListRow, query: String): Boolean {
    val trimmed = query.trim().lowercase()
    if (trimmed.length < MIN_DEVICE_QUERY) return true

    val digits = trimmed.filter(Char::isDigit)
    // A query that is ONLY digits is a number search. Checking the name too
    // would match "A1 Plumbing" for "1", which is noise dressed as a result.
    if (digits.isNotEmpty() && digits == trimmed) {
        return nationalDigits(row.number).contains(digits)
    }

    val name = row.name.lowercase()
    if (name.startsWith(trimmed)) return true
    // Any later word: a surname finds a person at least as often as a first
    // name does, and "Roofing" has to find "Alaska Roofing".
    for (index in 1 until name.length) {
        val previous = name[index - 1]
        val isWordStart = !previous.isLetter() && !previous.isDigit()
        if (isWordStart && name.startsWith(trimmed, index)) return true
    }
    return false
}

/**
 * The device rows to show for a query, capped.
 *
 * Reports whether anything was hidden rather than silently cutting the list. A
 * list that stops at fifty without saying so reads as "these are all of them",
 * and somebody who cannot find their plumber concludes we never read their
 * contacts at all.
 */
fun filterDeviceContacts(
    rows: List<DeviceContactListRow>,
    query: String,
    limit: Int = MAX_DEVICE_CONTACT_ROWS,
): DeviceContactPage {
    val matched = rows.filter { deviceContactMatches(it, query) }
    return DeviceContactPage(rows = matched.take(limit), truncated = matched.size > limit)
}

/**
 * Flatten loaded device contacts into list rows — one per contact, on its FIRST
 * number.
 *
 * One row per contact rather than one per number, unlike the dialer's
 * candidates. The dialer is correlating digits somebody already typed, so every
 * number has to be a candidate; this list is a directory, and showing the same
 * person three times because their phone stored a mobile, a work and a home
 * number is a directory nobody can scan.
 */
fun deviceContactRows(contacts: List<DeviceContact>): List<DeviceContactListRow> =
    contacts.mapNotNull { contact ->
        val number = contact.numbers.firstOrNull() ?: return@mapNotNull null
        DeviceContactListRow(
            id = contact.lookupKey,
            name = contact.displayName,
            number = number.e164 ?: number.raw,
        )
    }
