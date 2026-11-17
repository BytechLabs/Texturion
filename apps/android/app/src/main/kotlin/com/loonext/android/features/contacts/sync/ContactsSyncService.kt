package com.loonext.android.features.contacts.sync

import android.accounts.Account
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Bundle
import android.os.IBinder
import android.provider.ContactsContract
import android.provider.ContactsContract.AggregationExceptions
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.RawContacts
import com.loonext.android.core.diag.CallFlowLog
import com.loonext.android.core.i18n.UiLocale
import com.loonext.android.core.model.MessageLocale

/**
 * Attaches the Connected Apps actions to existing device contacts without
 * creating another phone row for the system dialer to match.
 */
class ContactsSyncAdapter(context: Context) :
    AbstractThreadedSyncAdapter(context, /* autoInitialize = */ true) {

    private val pkg = context.packageName

    override fun onPerformSync(
        account: Account,
        extras: Bundle,
        authority: String,
        provider: ContentProviderClient,
        syncResult: SyncResult,
    ) {
        runCatching {
            val phones = readSourcePhones(provider, account)
            // These rows are rendered by the system Contacts app, so follow the
            // system/device language rather than a Compose-local value.
            val locale = UiLocale.normalizeDevice(UiLocale.deviceTag()) ?: MessageLocale.DEFAULT
            val plan = buildSyncRawContacts(pkg, phones, locale)

            val ops = ArrayList<ContentProviderOperation>()
            // Clean slate: drop every RawContact we previously wrote for this
            // account, so removed/renamed device contacts don't leave stragglers.
            ops += ContentProviderOperation
                .newDelete(syncAdapterUri(RAW_CONTACTS_URI, account))
                .withSelection(
                    "${RawContacts.ACCOUNT_NAME} = ? AND ${RawContacts.ACCOUNT_TYPE} = ?",
                    arrayOf(account.name, account.type),
                )
                .build()

            for (raw in plan) {
                val backRef = ops.size
                ops += ContentProviderOperation
                    .newInsert(syncAdapterUri(RAW_CONTACTS_URI, account))
                    .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
                    .build()
                for (row in raw.dataRows) {
                    ops += ContentProviderOperation
                        .newInsert(syncAdapterUri(Data.CONTENT_URI, account))
                        .withValueBackReference(Data.RAW_CONTACT_ID, backRef)
                        .withValue(Data.MIMETYPE, row.mimeType)
                        .withValue(Data.DATA1, row.number)
                        .withValue(Data.DATA2, row.summary)
                        .withValue(Data.DATA3, row.detail)
                        .build()
                }
                ops += ContentProviderOperation
                    .newUpdate(syncAdapterUri(AggregationExceptions.CONTENT_URI, account))
                    .withValue(AggregationExceptions.TYPE, AggregationExceptions.TYPE_KEEP_TOGETHER)
                    .withValueBackReference(AggregationExceptions.RAW_CONTACT_ID1, backRef)
                    .withValue(AggregationExceptions.RAW_CONTACT_ID2, raw.sourceRawContactId)
                    .build()
                // Chunk to stay well under the binder transaction ceiling.
                if (ops.size >= BATCH_LIMIT) {
                    applyBatch(provider, ops)
                    ops.clear()
                }
            }
            if (ops.isNotEmpty()) applyBatch(provider, ops)
            CallFlowLog.log("contacts-sync", "wrote ${plan.size} connected rows")
        }.onFailure { error ->
            syncResult.databaseError = true
            CallFlowLog.log("contacts-sync", "failed: ${error.message}")
        }
    }

    private fun readSourcePhones(
        provider: ContentProviderClient,
        account: Account,
    ): List<SyncPhoneRow> {
        val cursor = checkNotNull(
            provider.query(
                Phone.CONTENT_URI,
                arrayOf(Data.CONTACT_ID, Data.RAW_CONTACT_ID, Phone.NUMBER),
                "${RawContacts.ACCOUNT_TYPE} IS NULL OR ${RawContacts.ACCOUNT_TYPE} <> ?",
                arrayOf(account.type),
                Data.RAW_CONTACT_ID,
            ),
        )
        return cursor.use {
            val contact = it.getColumnIndexOrThrow(Data.CONTACT_ID)
            val rawContact = it.getColumnIndexOrThrow(Data.RAW_CONTACT_ID)
            val number = it.getColumnIndexOrThrow(Phone.NUMBER)
            buildList {
                while (it.moveToNext()) {
                    val value = it.getString(number) ?: continue
                    add(SyncPhoneRow(it.getLong(contact), it.getLong(rawContact), value))
                }
            }
        }
    }

    private fun applyBatch(provider: ContentProviderClient, ops: List<ContentProviderOperation>) {
        if (ops.isEmpty()) return
        provider.applyBatch(ArrayList(ops))
    }

    private companion object {
        const val BATCH_LIMIT = 300
        val RAW_CONTACTS_URI = ContactsContract.RawContacts.CONTENT_URI

        /** Tag a write as coming from the sync adapter (required to write into
         *  an account's rows and to hard-delete rather than tombstone). */
        fun syncAdapterUri(uri: android.net.Uri, account: Account) = uri.buildUpon()
            .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
            .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
            .build()
    }
}

/**
 * The bound service the SyncManager talks to — wired in the manifest with the
 * android.content.SyncAdapter meta-data (res/xml/sync_adapter.xml) and the
 * android.provider.CONTACTS_STRUCTURE meta-data (res/xml/contacts.xml, which
 * declares how the call/text rows render). One adapter instance per process.
 */
class ContactsSyncService : Service() {
    override fun onBind(intent: Intent?): IBinder = adapter(this).syncAdapterBinder

    private companion object {
        @Volatile
        private var instance: ContactsSyncAdapter? = null

        fun adapter(context: Context): ContactsSyncAdapter =
            instance ?: synchronized(this) {
                instance ?: ContactsSyncAdapter(context.applicationContext).also { instance = it }
            }
    }
}
