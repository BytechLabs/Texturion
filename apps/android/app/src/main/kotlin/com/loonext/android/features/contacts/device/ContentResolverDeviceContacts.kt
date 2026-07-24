package com.loonext.android.features.contacts.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Reads device contacts (#183, part 1) behind [DeviceContactsDataSource] so the
 * dialer's correlation depends on an interface, never on ContentResolver — the
 * pure fold ([aggregateDeviceContacts]) is what the tests exercise. The query is
 * a single pass over CommonDataKinds.Phone (display name + number + label),
 * nothing more.
 */
interface DeviceContactsDataSource {
    /** True when READ_CONTACTS is granted right now — the point-of-use gate. */
    fun hasPermission(): Boolean

    /**
     * Every device contact with at least one phone number, deduped and
     * normalized. Returns an empty list (never throws) when the permission is
     * absent or the read fails — the dialer degrades to app-only correlation.
     */
    suspend fun loadContacts(): List<DeviceContact>
}

class ContentResolverDeviceContacts(context: Context) : DeviceContactsDataSource {
    // Hold the application context so a data source outliving its screen never
    // leaks an Activity.
    private val appContext = context.applicationContext

    override fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    override suspend fun loadContacts(): List<DeviceContact> {
        if (!hasPermission()) return emptyList()
        return withContext(Dispatchers.IO) {
            runCatching { readRows() }.getOrDefault(emptyList()).let(::aggregateDeviceContacts)
        }
    }

    private fun readRows(): List<DeviceContactRow> {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.LABEL,
            ContactsContract.CommonDataKinds.Phone.TYPE,
        )
        val rows = ArrayList<DeviceContactRow>()
        appContext.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY +
                " COLLATE NOCASE ASC",
        )?.use { cursor ->
            val keyIdx = cursor.getColumnIndexOrThrow(
                ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY,
            )
            val nameIdx = cursor.getColumnIndexOrThrow(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            )
            val numberIdx = cursor.getColumnIndexOrThrow(
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            )
            val labelIdx = cursor.getColumnIndexOrThrow(
                ContactsContract.CommonDataKinds.Phone.LABEL,
            )
            val typeIdx = cursor.getColumnIndexOrThrow(
                ContactsContract.CommonDataKinds.Phone.TYPE,
            )
            while (cursor.moveToNext()) {
                val type = cursor.getInt(typeIdx)
                val label = cursor.getString(labelIdx)
                    ?: ContactsContract.CommonDataKinds.Phone
                        .getTypeLabel(appContext.resources, type, "")
                        .toString()
                        .takeIf { it.isNotBlank() }
                rows += DeviceContactRow(
                    lookupKey = cursor.getString(keyIdx).orEmpty(),
                    displayName = cursor.getString(nameIdx),
                    rawNumber = cursor.getString(numberIdx),
                    label = label,
                )
            }
        }
        return rows
    }
}
