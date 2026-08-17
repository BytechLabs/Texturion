package com.loonext.android.features.settings

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * #473 — enrolling a passkey on Android, through Credential Manager.
 *
 * ## What this file is, and is not
 *
 * It is a courier. GoTrue produces `PublicKeyCredentialCreationOptionsJSON`,
 * Credential Manager consumes it and produces `RegistrationResponseJSON`, and
 * GoTrue consumes that. Both are the shapes the WebAuthn spec defines, so the
 * two ends already agree and nothing here parses, re-encodes, or base64s
 * anything. No private key is ever visible to this process — the credential is
 * created and held by the platform, behind the user's own screen lock.
 *
 * ## Why the failures are told apart
 *
 * Three things go wrong here and they need three different answers:
 *
 * - **Dismissed.** Somebody pressed back on the sheet. Not an error; say
 *   nothing and leave the card as it was. Shouting at somebody who changed
 *   their mind teaches them the button is dangerous.
 * - **The domain is not associated with this app.** Until
 *   `https://<rpId>/.well-known/assetlinks.json` names this package and its
 *   signing certificate, every attempt fails, and it fails identically for the
 *   first person to try it and for a genuine bug. This one has to be named,
 *   because "try again" is advice that cannot work.
 * - **Anything else.** The platform's own message beats ours: "the operation
 *   either timed out or was not allowed" is what somebody needs to read when
 *   their fingerprint was not recognised.
 *
 * ## The relying party
 *
 * [WEBAUTHN_RP_ID] is the web app's host, not the API's. A passkey is scoped to
 * the RP that created it, so enrolling under a different id here would produce a
 * credential the web app could never use — the same account, two second factors
 * that each work in exactly one place.
 */

/**
 * The relying party every client enrols under. The web app enrols with
 * `window.location.hostname`, which is this, and the phones must match it or the
 * credentials do not travel.
 */
const val WEBAUTHN_RP_ID = "app.loonext.com"

/**
 * Whether this domain has authorised this app to hold passkeys for it.
 *
 * ## Why ask at all, rather than just offering the button
 *
 * Because until `/.well-known/assetlinks.json` names this package, EVERY
 * ceremony fails — and it fails the same way a genuine bug does. Offering a
 * button that cannot work is the one thing worse than not offering it, and this
 * product's audience is standing in somebody's driveway when they try it.
 *
 * ## Why a probe rather than a build flag
 *
 * A flag would need an app update to flip, and an app update takes weeks to
 * reach a phone. The association file is served by the web app, which deploys
 * in minutes. Reading the switch from the side that can move means passkeys
 * appear the day they start working, on handsets that were installed months
 * before.
 *
 * ## What it does NOT verify
 *
 * The signing fingerprint. Checking that this build's certificate is among the
 * ones listed would mean hashing our own APK signature — worth it if this were
 * a security decision, and it is not: the platform re-checks everything anyway
 * and refuses on any mismatch. This answers the weaker, sufficient question,
 * "has anybody configured this domain for Android at all", whose honest answer
 * today is no.
 *
 * Failure is `false`: no network, no passkey offer, and the authenticator app
 * is right there.
 */
suspend fun isPasskeyDomainAssociated(
    http: OkHttpClient,
    rpId: String = WEBAUTHN_RP_ID,
): Boolean = withContext(Dispatchers.IO) {
    try {
        val request = Request.Builder()
            .url("https://$rpId/.well-known/assetlinks.json")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext false
            val statements = Json.parseToJsonElement(
                response.body.string(),
            ) as? JsonArray ?: return@withContext false
            statements.any { entry ->
                val statement = entry as? JsonObject ?: return@any false
                val target = statement["target"]?.jsonObject
                val relations = statement["relation"] as? JsonArray
                target?.get("namespace")?.jsonPrimitive?.content == "android_app" &&
                    target["package_name"]?.jsonPrimitive?.content == ANDROID_PACKAGE &&
                    relations?.any {
                        it.jsonPrimitive.content == LOGIN_CREDS_RELATION
                    } == true
            }
        }
    } catch (_: Exception) {
        // Any failure — offline, DNS, malformed JSON — means we cannot show a
        // passkey option we can stand behind. The authenticator app path is
        // untouched and needs no network to be offered.
        false
    }
}

/** This app's package, as the statement file must name it. */
private const val ANDROID_PACKAGE = "com.loonext.android"

/** The relation WebAuthn checks. See the web route that serves the file. */
private const val LOGIN_CREDS_RELATION = "delegate_permission/common.get_login_creds"

/** What came back from the platform's passkey sheet. */
sealed interface PasskeyResult {
    /** The registration response JSON, ready for GoTrue verbatim. */
    data class Created(val registrationResponseJson: String) : PasskeyResult

    /** Somebody dismissed the sheet. Not a failure to report. */
    data object Dismissed : PasskeyResult

    /**
     * The ceremony failed. [domainNotAssociated] separates the one cause that
     * no amount of retrying fixes, so the card can say so instead of offering
     * advice that cannot work.
     */
    data class Failed(
        val message: String?,
        val domainNotAssociated: Boolean,
    ) : PasskeyResult
}

/**
 * Run the platform's passkey creation sheet.
 *
 * Needs an [Activity] context: Credential Manager presents system UI over the
 * caller, and an application context has nothing to present over.
 */
suspend fun createPasskey(
    context: Context,
    creationOptionsJson: String,
): PasskeyResult {
    val activity = context.findActivity()
        ?: return PasskeyResult.Failed(message = null, domainNotAssociated = false)

    return try {
        val response = CredentialManager.create(activity).createCredential(
            context = activity,
            request = CreatePublicKeyCredentialRequest(requestJson = creationOptionsJson),
        )
        val created = response as? CreatePublicKeyCredentialResponse
            ?: return PasskeyResult.Failed(message = null, domainNotAssociated = false)
        PasskeyResult.Created(created.registrationResponseJson)
    } catch (_: CreateCredentialCancellationException) {
        PasskeyResult.Dismissed
    } catch (cause: CreateCredentialException) {
        PasskeyResult.Failed(
            message = cause.errorMessage?.toString(),
            domainNotAssociated = cause.isDomainAssociationFailure(),
        )
    }
}

/**
 * Whether the failure is Digital Asset Links refusing to associate this app
 * with the relying party.
 *
 * Matched on the message rather than on an exception class because the platform
 * does not give this its own type — it arrives as a generic
 * `CreateCredentialUnknownException` (or a `DomException` subtype) whose text
 * carries the reason. Matching text is fragile, which is why it only ever
 * ADDS a sentence: a miss shows the platform's own message, which is the same
 * thing that would have been shown without this check at all.
 */
private fun CreateCredentialException.isDomainAssociationFailure(): Boolean {
    val haystack = buildString {
        append(type)
        append(' ')
        append(errorMessage ?: "")
    }.lowercase()
    return DOMAIN_FAILURE_MARKERS.any { haystack.contains(it) }
}

private val DOMAIN_FAILURE_MARKERS = listOf(
    // What Play Services says when assetlinks.json does not name this package,
    // is unreachable, or lists a different signing certificate.
    "asset",
    "relying party",
    "not allowed to create a credential",
    "origin",
)

/** The nearest [Activity] up the context chain, or null under an app context. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
