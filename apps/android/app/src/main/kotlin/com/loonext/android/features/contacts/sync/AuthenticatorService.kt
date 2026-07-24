package com.loonext.android.features.contacts.sync

import android.accounts.AbstractAccountAuthenticator
import android.accounts.Account
import android.accounts.AccountAuthenticatorResponse
import android.accounts.AccountManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.IBinder

/**
 * The device-side account that anchors the Connected-Apps sync (#183, part 3).
 * A sync adapter must belong to an account, so the app owns one — but it is a
 * pure integration hook, NOT a login: it holds no token and never authenticates
 * anyone. Every credential-bearing operation is unsupported; only the account's
 * existence (as a sync anchor) matters.
 *
 * The account is invisible in system Settings (visibility is DEFAULT and it
 * carries no auth), and the app's real sign-in is Supabase (core/auth) — this is
 * deliberately separate and never touches it.
 */
class LoonextAuthenticator(context: Context) : AbstractAccountAuthenticator(context) {

    override fun addAccount(
        response: AccountAuthenticatorResponse?,
        accountType: String?,
        authTokenType: String?,
        requiredFeatures: Array<out String>?,
        options: Bundle?,
    ): Bundle? = null // the app adds its own account programmatically; no UI flow

    override fun getAuthToken(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        authTokenType: String?,
        options: Bundle?,
    ): Bundle = unsupported()

    override fun getAuthTokenLabel(authTokenType: String?): String? = null

    override fun confirmCredentials(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        options: Bundle?,
    ): Bundle? = null

    override fun editProperties(
        response: AccountAuthenticatorResponse?,
        accountType: String?,
    ): Bundle = unsupported()

    override fun updateCredentials(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        authTokenType: String?,
        options: Bundle?,
    ): Bundle = unsupported()

    override fun hasFeatures(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        features: Array<out String>?,
    ): Bundle = Bundle().apply { putBoolean(AccountManager.KEY_BOOLEAN_RESULT, false) }

    private fun unsupported(): Bundle = Bundle().apply {
        putInt(AccountManager.KEY_ERROR_CODE, AccountManager.ERROR_CODE_UNSUPPORTED_OPERATION)
        putString(AccountManager.KEY_ERROR_MESSAGE, "Loonext account is sync-only")
    }
}

/**
 * The bound service the platform talks to for the Loonext account type — wired
 * in the manifest with the android.accounts.AccountAuthenticator meta-data that
 * points at res/xml/authenticator.xml.
 */
class AuthenticatorService : Service() {
    private lateinit var authenticator: LoonextAuthenticator

    override fun onCreate() {
        super.onCreate()
        authenticator = LoonextAuthenticator(this)
    }

    override fun onBind(intent: Intent?): IBinder = authenticator.iBinder
}
