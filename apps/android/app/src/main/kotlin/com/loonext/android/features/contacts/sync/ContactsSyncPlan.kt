package com.loonext.android.features.contacts.sync

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.contacts.Nanp

const val LOONEXT_ACCOUNT_TYPE = "com.loonext.android"
const val LOONEXT_ACCOUNT_NAME = "Loonext"

enum class ContactsActionKind { CALL, TEXT }

data class SyncPhoneRow(
    val contactId: Long,
    val rawContactId: Long,
    val number: String,
)

data class SyncDataRow(
    val mimeType: String,
    val number: String,
    val summary: String,
    val detail: String,
)

data class SyncRawContact(
    val sourceRawContactId: Long,
    val dataRows: List<SyncDataRow>,
)

fun callMimeType(pkg: String): String = "vnd.android.cursor.item/vnd.$pkg.call"
fun textMimeType(pkg: String): String = "vnd.android.cursor.item/vnd.$pkg.text"

fun contactsActionKind(mimeType: String?, pkg: String): ContactsActionKind? = when (mimeType) {
    callMimeType(pkg) -> ContactsActionKind.CALL
    textMimeType(pkg) -> ContactsActionKind.TEXT
    else -> null
}

/** Only custom action rows belong to Loonext. Native caller ID matches the original phone rows. */
fun buildSyncRawContacts(
    pkg: String,
    phones: List<SyncPhoneRow>,
    locale: String = MessageLocale.DEFAULT,
): List<SyncRawContact> {
    val callMime = callMimeType(pkg)
    val textMime = textMimeType(pkg)
    val callLabel = AppStrings.translate(locale, "contactsSync.callAction")
    val textLabel = AppStrings.translate(locale, "contactsSync.textAction")
    val seen = HashSet<Pair<Long, String>>()
    return phones.mapNotNull { phone ->
        val number = Nanp.normalize(phone.number) ?: return@mapNotNull null
        if (!seen.add(phone.contactId to number)) return@mapNotNull null
        val displayNumber = Nanp.formatAsYouType(number)
        SyncRawContact(
            sourceRawContactId = phone.rawContactId,
            dataRows = listOf(
                SyncDataRow(callMime, number, callLabel, displayNumber),
                SyncDataRow(textMime, number, textLabel, displayNumber),
            ),
        )
    }
}
