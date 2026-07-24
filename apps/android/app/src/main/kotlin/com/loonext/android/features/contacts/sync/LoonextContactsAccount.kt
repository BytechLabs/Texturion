package com.loonext.android.features.contacts.sync

import android.accounts.Account
import android.accounts.AccountManager
import android.content.ContentResolver
import android.os.Bundle
import android.provider.ContactsContract

/**
 * Owns the lifecycle of the device-side Loonext account and its Contacts sync
 * (#183, part 3). The account is created once (idempotent), auto-syncs on
 * ContactsContract changes, and can be poked to sync now. Signing out of the app
 * removes it, taking the "Call/Text with Loonext" rows with it.
 */
object LoonextContactsAccount {

    val account: Account = Account(LOONEXT_ACCOUNT_NAME, LOONEXT_ACCOUNT_TYPE)

    /**
     * Ensure the account exists and Contacts auto-sync is on. Idempotent — safe
     * to call on every sign-in / app start. Returns false if the platform
     * refused to add it (some OEM profiles disallow app-owned accounts).
     */
    fun ensure(accountManager: AccountManager): Boolean {
        val exists = accountManager.getAccountsByType(LOONEXT_ACCOUNT_TYPE).isNotEmpty()
        val added = exists || runCatching {
            accountManager.addAccountExplicitly(account, null, null)
        }.getOrDefault(false)
        if (added) {
            ContentResolver.setIsSyncable(account, ContactsContract.AUTHORITY, 1)
            ContentResolver.setSyncAutomatically(account, ContactsContract.AUTHORITY, true)
        }
        return added
    }

    /** Request an immediate one-off sync (expedited, manual). No-op if absent. */
    fun requestSync() {
        val extras = Bundle().apply {
            putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true)
            putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true)
        }
        ContentResolver.requestSync(account, ContactsContract.AUTHORITY, extras)
    }

    /** Remove the account and every "Call/Text with Loonext" row it anchors. */
    fun remove(accountManager: AccountManager) {
        accountManager.getAccountsByType(LOONEXT_ACCOUNT_TYPE).forEach { existing ->
            runCatching { accountManager.removeAccountExplicitly(existing) }
        }
    }
}
