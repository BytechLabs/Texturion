package com.loonext.android.features.contacts.sync

import com.loonext.android.features.contacts.Nanp
import com.loonext.android.features.contacts.device.DeviceContact

/**
 * Connected-Apps plan (#183, part 3) — the pure mapping from the device's
 * contacts to the ContactsContract data rows that make "Call with Loonext" /
 * "Text with Loonext" appear under a person in the system Contacts app (the way
 * WhatsApp/Telegram do). Android-free so the row shapes, MIME types, and the
 * dialable-only filter unit-test on the JVM; the ContentResolver batch that
 * writes these lives in [ContactsSyncAdapter].
 *
 * Approach (consistent with the app's self-managed telecom model): the app owns
 * a device-side account, and its sync adapter writes ONE aggregation RawContact
 * per dialable device number carrying a Phone row (so Android merges it into the
 * matching person) plus two custom-MIME action rows. Tapping an action row fires
 * a VIEW intent on the row that MainActivity resolves back to the number.
 */

/** The device-side account the sync adapter owns (matches authenticator.xml). */
const val LOONEXT_ACCOUNT_TYPE = "com.loonext.android"
const val LOONEXT_ACCOUNT_NAME = "Loonext"

/** Standard ContactsContract MIME types (mirrored as literals to stay pure). */
const val MIME_PHONE = "vnd.android.cursor.item/phone_v2"

/** Our two custom action MIME types, derived from the application id. */
fun callMimeType(pkg: String): String = "vnd.android.cursor.item/vnd.$pkg.call"
fun textMimeType(pkg: String): String = "vnd.android.cursor.item/vnd.$pkg.text"

/** What a tapped Connected-Apps row asks the app to do. */
enum class ContactsActionKind { CALL, TEXT }

/**
 * Which action a tapped data-row MIME type maps to (null when it is not one of
 * ours) — the pure core of MainActivity's Connected-Apps deep-link handling.
 */
fun contactsActionKind(mimeType: String?, pkg: String): ContactsActionKind? = when (mimeType) {
    callMimeType(pkg) -> ContactsActionKind.CALL
    textMimeType(pkg) -> ContactsActionKind.TEXT
    else -> null
}

/** One ContactsContract data row to write under a sync RawContact. */
data class SyncDataRow(
    val mimeType: String,
    /** DATA1 — the row's primary value: the E.164 number the action dials/texts. */
    val data1: String,
    /** DATA2 — the label the Contacts app shows for the row (summaryColumn). */
    val summary: String? = null,
    /** DATA3 — the secondary line (detailColumn). */
    val detail: String? = null,
)

/**
 * One RawContact the adapter inserts under the Loonext account — one per
 * dialable device number, so it aggregates into exactly the person who owns that
 * number. [dataRows] is the Phone aggregation row followed by the call + text
 * action rows.
 */
data class SyncRawContact(
    val lookupKey: String,
    val e164: String,
    val displayName: String,
    val dataRows: List<SyncDataRow>,
)

/** The action-row labels the Contacts app renders (kept beside the plan so the
 *  copy and the strings.xml fallbacks never drift). */
const val CALL_ACTION_LABEL = "Call with Loonext"
const val TEXT_ACTION_LABEL = "Text with Loonext"

/**
 * Build the RawContacts to write. Only strictly-dialable US/CA numbers get
 * action rows ([Nanp.normalize] gives a non-null E.164) — a number Loonext
 * cannot dial or text must not offer to; those are silently skipped. Each
 * distinct dialable E.164 across all contacts yields at most one raw contact
 * (de-duped), preserving first-seen order.
 */
fun buildSyncRawContacts(pkg: String, contacts: List<DeviceContact>): List<SyncRawContact> {
    val callMime = callMimeType(pkg)
    val textMime = textMimeType(pkg)
    val seen = HashSet<String>()
    val out = ArrayList<SyncRawContact>()
    for (contact in contacts) {
        for (number in contact.numbers) {
            val e164 = number.e164 ?: continue // not a dialable US/CA number
            if (!seen.add(e164)) continue // one action set per number
            val pretty = Nanp.formatAsYouType(e164)
            out += SyncRawContact(
                lookupKey = contact.lookupKey,
                e164 = e164,
                displayName = contact.displayName,
                dataRows = listOf(
                    // Phone row → Android aggregates this raw contact into the
                    // person who already owns this number (no visible duplicate).
                    SyncDataRow(mimeType = MIME_PHONE, data1 = e164),
                    SyncDataRow(
                        mimeType = callMime,
                        data1 = e164,
                        summary = CALL_ACTION_LABEL,
                        detail = pretty,
                    ),
                    SyncDataRow(
                        mimeType = textMime,
                        data1 = e164,
                        summary = TEXT_ACTION_LABEL,
                        detail = pretty,
                    ),
                ),
            )
        }
    }
    return out
}
