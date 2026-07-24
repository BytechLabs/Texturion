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
import com.loonext.android.core.diag.CallFlowLog
import com.loonext.android.features.contacts.device.ContentResolverDeviceContacts
import kotlinx.coroutines.runBlocking

/**
 * Writes the Connected-Apps rows (#183, part 3). On each sync it rebuilds the
 * Loonext account's RawContacts from the device address book: delete our prior
 * rows, then insert one aggregation RawContact per dialable number carrying a
 * Phone row plus the "Call with Loonext" / "Text with Loonext" custom-MIME
 * action rows ([buildSyncRawContacts]). Android aggregates each into the person
 * who owns that number, so the actions appear under real contacts.
 *
 * The row PLAN is pure and unit-tested; this class is the thin ContentResolver
 * translation. It reads the device book through [ContentResolverDeviceContacts]
 * (the same source the dialer uses) and needs READ_CONTACTS + WRITE_CONTACTS.
 */
class ContactsSyncAdapter(context: Context) :
    AbstractThreadedSyncAdapter(context, /* autoInitialize = */ true) {

    private val pkg = context.packageName
    private val deviceContacts = ContentResolverDeviceContacts(context)

    override fun onPerformSync(
        account: Account,
        extras: Bundle,
        authority: String,
        provider: ContentProviderClient,
        syncResult: SyncResult,
    ) {
        runCatching {
            val contacts = runBlocking { deviceContacts.loadContacts() }
            val plan = buildSyncRawContacts(pkg, contacts)

            val ops = ArrayList<ContentProviderOperation>()
            // Clean slate: drop every RawContact we previously wrote for this
            // account, so removed/renamed device contacts don't leave stragglers.
            ops += ContentProviderOperation
                .newDelete(syncAdapterUri(RAW_CONTACTS_URI, account))
                .build()

            for (raw in plan) {
                val backRef = ops.size
                ops += ContentProviderOperation
                    .newInsert(syncAdapterUri(RAW_CONTACTS_URI, account))
                    .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
                    .withValue(ContactsContract.RawContacts.AGGREGATION_MODE,
                        ContactsContract.RawContacts.AGGREGATION_MODE_DEFAULT)
                    .withValue(ContactsContract.RawContacts.SYNC1, raw.e164)
                    .build()
                for (row in raw.dataRows) {
                    ops += ContentProviderOperation
                        .newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI, account))
                        .withValueBackReference(
                            ContactsContract.Data.RAW_CONTACT_ID, backRef,
                        )
                        .withValue(ContactsContract.Data.MIMETYPE, row.mimeType)
                        .withValue(ContactsContract.Data.DATA1, row.data1)
                        .apply {
                            row.summary?.let { withValue(ContactsContract.Data.DATA2, it) }
                            row.detail?.let { withValue(ContactsContract.Data.DATA3, it) }
                        }
                        .build()
                }
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
