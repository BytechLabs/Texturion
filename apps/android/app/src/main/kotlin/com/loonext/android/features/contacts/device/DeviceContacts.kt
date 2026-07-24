package com.loonext.android.features.contacts.device

import com.loonext.android.features.contacts.Nanp

/**
 * The device's own address book (#183, part 1) — a Kotlin domain over
 * ContactsContract that keeps the ContentResolver at arm's length so the
 * correlation logic unit-tests on the JVM with no device.
 *
 * The read is strictly display-name + phone-numbers, normalized to +1 E.164 via
 * the strict NANP port ([Nanp.normalize]) where possible. Nothing else about a
 * device contact is read or retained — no emails, addresses, photos, or org
 * fields — and contacts with no phone number never surface (there is nothing to
 * correlate, call, or text).
 */

/**
 * A phone number attached to a device contact. [e164] is the strict +1 NANP
 * normalization when the raw value is a US/CA number (null otherwise — the bare
 * [digits] still drive correlation, but a non-NANP number is not dialable).
 * [raw] is the value exactly as the device stored it; [label] is the device's
 * own label ("Mobile", "Work", …) when it set one.
 */
data class DevicePhoneNumber(
    val raw: String,
    val e164: String?,
    val label: String? = null,
) {
    /** The bare digit string — the substrate every dialer match runs on. */
    val digits: String = raw.filter(Char::isDigit)
}

/**
 * One device contact: a stable lookup key (ContactsContract.LOOKUP_KEY — survives
 * a re-sync where the numeric _id does not), a display name, and its deduped
 * phone numbers. Only contacts with at least one phone number are ever built.
 */
data class DeviceContact(
    val lookupKey: String,
    val displayName: String,
    val numbers: List<DevicePhoneNumber>,
)

/**
 * A single (lookupKey, name, rawNumber, label) tuple straight off the
 * ContactsContract.CommonDataKinds.Phone cursor — the pure input the aggregator
 * folds into [DeviceContact]s. Isolating the cursor shape here is what lets the
 * fold be tested without an Android ContentResolver.
 */
data class DeviceContactRow(
    val lookupKey: String,
    val displayName: String?,
    val rawNumber: String?,
    val label: String? = null,
)

/**
 * Fold raw Phone-cursor rows into deduped [DeviceContact]s:
 *  - a row with a blank/no-digit number is dropped (nothing to call or text),
 *  - a contact with a blank lookup key is dropped (it cannot be addressed),
 *  - numbers dedupe within a contact by their digit string (the device commonly
 *    stores the same number twice under different labels),
 *  - a contact whose name is blank falls back to its first number, formatted,
 *  - first-seen order is preserved for both contacts and their numbers.
 */
fun aggregateDeviceContacts(rows: List<DeviceContactRow>): List<DeviceContact> {
    // LinkedHashMap keeps first-seen contact order; the inner builder keeps
    // first-seen number order and dedupes by digit string.
    data class Builder(
        var name: String,
        val numbers: LinkedHashMap<String, DevicePhoneNumber>,
    )

    val builders = LinkedHashMap<String, Builder>()
    for (row in rows) {
        val key = row.lookupKey.trim()
        if (key.isEmpty()) continue
        val raw = row.rawNumber?.trim().orEmpty()
        val digits = raw.filter(Char::isDigit)
        if (digits.isEmpty()) continue

        val builder = builders.getOrPut(key) {
            Builder(name = row.displayName?.trim().orEmpty(), numbers = LinkedHashMap())
        }
        // A later row may carry the name a first (name-less) row lacked.
        if (builder.name.isEmpty()) {
            row.displayName?.trim()?.takeIf { it.isNotEmpty() }?.let { builder.name = it }
        }
        builder.numbers.getOrPut(digits) {
            DevicePhoneNumber(
                raw = raw,
                e164 = Nanp.normalize(raw),
                label = row.label?.trim()?.takeIf { it.isNotEmpty() },
            )
        }
    }

    return builders.map { (key, builder) ->
        val numbers = builder.numbers.values.toList()
        DeviceContact(
            lookupKey = key,
            displayName = builder.name.ifEmpty { Nanp.formatAsYouType(numbers.first().raw) },
            numbers = numbers,
        )
    }
}
