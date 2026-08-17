package com.loonext.android.features.settings

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Two-factor authentication (#314) — the Android half of the web's card on
 * Settings → Profile & account.
 *
 * ONE DELIBERATE DIFFERENCE FROM WEB, and it is the whole mobile design: there
 * is no QR code. A QR shown ON the phone that would have to scan it is
 * useless. Instead the app hands the `otpauth://` URI straight to whatever
 * authenticator is installed — one tap, no typing — and falls back to the
 * secret with a copy button when nothing handles it.
 *
 * Everything else matches web, including the part that matters most: the
 * recovery-codes step cannot be dismissed until the codes have been copied.
 * Somebody who enrols and backs out without them has armed a lock and thrown
 * away the spare key, and this product's lock is their business phone line.
 */

/**
 * #473 — the two kinds of second factor, and the rule for naming them.
 *
 * Hand-ported from packages/shared/src/mfa-factors.ts, which web renders
 * directly. The fallback branch is the one a hand-copy drops and the one that
 * matters most: an unnamed factor type must read as "two-factor is on", never
 * as nothing, because telling somebody who IS protected that they are not
 * invites them to enrol a second time or to believe the account is open.
 */
internal const val FACTOR_PASSKEY = "webauthn"
internal const val FACTOR_AUTHENTICATOR = "totp"

internal fun mfaSummaryKey(factorTypes: List<String>): String {
    val passkey = factorTypes.contains(FACTOR_PASSKEY)
    val authenticator = factorTypes.contains(FACTOR_AUTHENTICATOR)
    return when {
        passkey && authenticator -> "settingsMore.tfaBothOn"
        passkey -> "settingsMore.tfaPasskeyOn"
        authenticator -> "settingsMore.tfaAuthenticatorOn"
        else -> "settingsMore.tfaOn"
    }
}

/** Which kinds are still missing, so the card offers exactly those. */
internal fun missingFactorTypes(factorTypes: List<String>): List<String> =
    if (factorTypes.isEmpty()) {
        emptyList()
    } else {
        listOf(FACTOR_PASSKEY, FACTOR_AUTHENTICATOR).filterNot(factorTypes::contains)
    }

private sealed interface EnrolStep {
    data object Idle : EnrolStep
    data class Verify(val factorId: String, val secret: String, val uri: String) : EnrolStep
    data class Codes(val codes: List<String>) : EnrolStep
}

@Composable
fun TwoFactorCard(scope: SettingsScope) {
    var refreshKey by remember { mutableIntStateOf(0) }
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.mfa(scope.me.user_id),
        refreshKey = refreshKey,
    ) { scope.repo.mfa() }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 32.dp),
        )

        is LoadState.Ready -> TwoFactorBody(scope, current.value) { refreshKey++ }
    }
}

@Composable
private fun TwoFactorBody(scope: SettingsScope, mfa: MfaState, onChanged: () -> Unit) {
    var step by remember { mutableStateOf<EnrolStep>(EnrolStep.Idle) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var savedCodes by remember { mutableStateOf(false) }
    var confirmingOff by remember { mutableStateOf(false) }
    // #473: null until the probe answers. Passkeys are offered only once this
    // domain has actually authorised this app — see PasskeyEnrolment.kt for why
    // the switch is read from the web app rather than from a build flag.
    var passkeysAvailable by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val locale = LocalAppLocale.current
    val setupKeyLabel = t("settingsMore.setupKeyClipLabel")
    val recoveryCodesLabel = t("settingsMore.recoveryCodesClipLabel")
    val factorTypes = mfa.factors.map { it.type }
    val missing = missingFactorTypes(factorTypes)

    LaunchedEffect(Unit) {
        passkeysAvailable = isPasskeyDomainAssociated(scope.graph.api.http)
    }

    fun fail(cause: Exception) {
        actionError = cause.userMessage(locale)
        busy = false
    }

    /**
     * Start enrolling an authenticator app.
     *
     * Lifted out of the button it used to live inside, because #473 gave it a
     * SECOND call site: somebody who holds a passkey and wants the app too.
     */
    fun beginAuthenticator() {
        busy = true
        actionError = null
        coroutines.launch {
            try {
                val token = scope.graph.api.freshSession()?.accessToken
                    ?: error(AppStrings.translate(locale, "settingsMore.signedOut"))
                // The name this factor carries inside the reader's authenticator
                // app, which is the one place it is ever read. Web translates its
                // own, so this does too; Loonext and Android are a product and a
                // platform and stay as they are in both.
                val enrolled = scope.graph.supabaseAuth.enrollTotp(
                    token,
                    AppStrings.translate(locale, "settingsMore.tfaFactorName"),
                )
                val totp = enrolled["totp"]?.let {
                    it as? kotlinx.serialization.json.JsonObject
                }
                step = EnrolStep.Verify(
                    factorId = enrolled["id"]!!.toString().trim('"'),
                    secret = totp?.get("secret")?.toString()?.trim('"').orEmpty(),
                    uri = totp?.get("uri")?.toString()?.trim('"').orEmpty(),
                )
            } catch (cause: Exception) {
                fail(cause)
            } finally {
                busy = false
            }
        }
    }

    /**
     * Enrol a passkey: create the factor, run the platform's sheet, hand the
     * answer back, then issue recovery codes.
     *
     * The codes come LAST and only on success, exactly as the authenticator
     * path does. A passkey armed with no spare key is a lock on a business
     * phone line whose only key is inside a phone.
     */
    fun beginPasskey() {
        busy = true
        actionError = null
        coroutines.launch {
            try {
                val token = scope.graph.api.freshSession()?.accessToken
                    ?: error(AppStrings.translate(locale, "settingsMore.signedOut"))
                val factor = scope.graph.supabaseAuth.enrollWebauthn(
                    token,
                    AppStrings.translate(locale, "settingsMore.tfaPasskeyFactorName"),
                )
                val factorId = factor["id"]!!.toString().trim('"')
                val challenge = scope.graph.supabaseAuth.challengeWebauthn(
                    token, factorId, WEBAUTHN_RP_ID,
                )
                when (val created = createPasskey(context, challenge.creationOptionsJson)) {
                    is PasskeyResult.Dismissed -> {
                        // Somebody changed their mind. Not an error to shout about.
                        scope.graph.supabaseAuth.unenrollFactor(token, factorId)
                    }

                    is PasskeyResult.Failed -> {
                        // The platform's own words beat ours: "the operation
                        // either timed out or was not allowed" is what somebody
                        // needs to read when their fingerprint was not accepted.
                        actionError = created.message
                            ?: AppStrings.translate(locale, "settingsMore.tfaPasskeyFailed")
                        scope.graph.supabaseAuth.unenrollFactor(token, factorId)
                        // A domain that refuses us cannot be retried into working.
                        if (created.domainNotAssociated) passkeysAvailable = false
                    }

                    is PasskeyResult.Created -> {
                        val next = scope.graph.supabaseAuth.verifyWebauthn(
                            token,
                            factorId,
                            challenge.challengeId,
                            WEBAUTHN_RP_ID,
                            created.registrationResponseJson,
                        )
                        scope.graph.sessionStore.save(next.toSession())
                        val issued = scope.repo.issueRecoveryCodes()
                        savedCodes = false
                        step = EnrolStep.Codes(issued.codes)
                        haptics.confirm()
                    }
                }
            } catch (cause: Exception) {
                fail(cause)
            } finally {
                busy = false
            }
        }
    }

    SettingsCard(
        title = t("settingsMore.twoFactorTitle"),
        description = t("settingsMore.twoFactorDesc"),
    ) {
        if (mfa.enrolled) {
            // #473: NAMES WHAT IS ON, because two kinds can be. "Two-factor is
            // on" would leave somebody who added a passkey unable to tell whether
            // last year's authenticator app is still there — and that answer
            // decides what happens when they lose one of the two.
            Text(
                t(mfaSummaryKey(factorTypes)),
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(4.dp))
            if (mfa.recovery_codes_remaining > 0) {
                // Two whole sentences rather than a stem plus "code"/"codes":
                // the singular and the plural differ by more than the noun in
                // French, where the number word agrees too.
                ReadOnlyLine(
                    if (mfa.recovery_codes_remaining == 1) {
                        t("settingsMore.oneRecoveryCodeLeft")
                    } else {
                        t(
                            "settingsMore.recoveryCodesLeft",
                            "count" to "${mfa.recovery_codes_remaining}",
                        )
                    },
                )
            } else {
                // Nought left is a lockout waiting for a lost phone, so it
                // reads as something to fix rather than a statistic.
                StatusPill(t("settingsMore.noRecoveryCodesLeft"), PillTone.Warn)
            }
            Spacer(Modifier.height(10.dp))
            Row {
                OutlinedButton(
                    onClick = {
                        busy = true
                        actionError = null
                        coroutines.launch {
                            try {
                                val issued = scope.repo.issueRecoveryCodes()
                                savedCodes = false
                                step = EnrolStep.Codes(issued.codes)
                            } catch (cause: Exception) {
                                fail(cause)
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                ) {
                    Text(t("settingsMore.newRecoveryCodes"))
                }
                Spacer(Modifier.width(8.dp))
                LinkButton(onClick = { confirmingOff = true }, enabled = !busy) {
                    Text(
                        t("settingsMore.turnOff"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            /*
             * #473 — THE SECOND FACTOR, which had no way in.
             *
             * The enrolment controls live in the other branch of this
             * `if (mfa.enrolled)`, so the first factor hid the way to the
             * second: somebody with an authenticator app could never add a
             * passkey. Only the MISSING kind is offered, as one quiet action
             * beside the other management controls rather than a second pitch
             * competing with them.
             *
             * Applying: Chunking, and Zen of Clarity — the option that does not
             * apply is absent rather than disabled.
             */
            if (missing.contains(FACTOR_PASSKEY) && passkeysAvailable) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = ::beginPasskey, enabled = !busy) {
                    Text(t("settingsMore.tfaAddPasskey"))
                }
            }
            if (missing.contains(FACTOR_AUTHENTICATOR)) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = ::beginAuthenticator, enabled = !busy) {
                    Text(t("settingsMore.tfaAddAuthenticator"))
                }
            }
        } else if (passkeysAvailable) {
            /*
             * #473 — the passkey leads where this domain allows it.
             *
             * #314 shipped codes from an authenticator app and said in its own
             * words that passkeys suit these users better. It is right: a
             * tradesperson holds ONE phone, and the authenticator sits on the
             * same screen as the app asking for the six digits. A passkey is a
             * fingerprint instead.
             *
             * The app is still offered underneath, in full, because a passkey
             * lives on THIS handset and somebody who works from two should be
             * able to choose. Applying: Outcomes Over Features — the pitch is
             * what it is like to use, not what it is called.
             */
            ReadOnlyLine(t("settingsMore.tfaPasskeyPitch"))
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = ::beginPasskey,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("settingsMore.tfaUsePasskey"))
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = ::beginAuthenticator,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("settingsMore.tfaAddAuthenticator"))
            }
        } else {
            ReadOnlyLine(t("settingsMore.twoFactorHow"))
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = ::beginAuthenticator,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("settingsMore.setUpTwoFactor"))
            }
        }
        InlineError(actionError.takeIf { step is EnrolStep.Idle })
    }

    when (val current = step) {
        is EnrolStep.Verify -> ConfirmDialog(
            title = t("settingsMore.addToAuthenticator"),
            body = t("settingsMore.addToAuthenticatorBody"),
            confirmLabel = t("settingsMore.turnItOn"),
            pending = busy,
            error = actionError,
            confirmEnabled = code.filter { it.isDigit() }.length >= 6,
            onDismiss = {
                step = EnrolStep.Idle
                code = ""
                actionError = null
            },
            onConfirm = {
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        val token = scope.graph.api.freshSession()?.accessToken
                            ?: error(
                                AppStrings.translate(locale, "settingsMore.signedOut"),
                            )
                        val challenge = scope.graph.supabaseAuth.challengeFactor(
                            token, current.factorId,
                        )
                        // The verify response is a FRESH session at aal2 —
                        // storing it is what makes the workspace gate stop
                        // refusing this device.
                        val next = scope.graph.supabaseAuth.verifyFactor(
                            token, current.factorId, challenge, code.filter { it.isDigit() },
                        )
                        scope.graph.sessionStore.save(next.toSession())
                        val issued = scope.repo.issueRecoveryCodes()
                        code = ""
                        savedCodes = false
                        step = EnrolStep.Codes(issued.codes)
                        haptics.confirm()
                    } catch (cause: Exception) {
                        actionError =
                            AppStrings.translate(locale, "settingsMore.codeDidNotMatch")
                    } finally {
                        busy = false
                    }
                }
            },
            extraContent = {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = {
                        // The mobile answer to "scan this QR with this phone".
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, current.uri.toUri()))
                        }.onFailure {
                            actionError = AppStrings.translate(
                                locale,
                                "settingsMore.noAuthenticatorApp",
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(t("settingsMore.openAuthenticator"))
                }
                Spacer(Modifier.height(8.dp))
                ReadOnlyLine(t("settingsMore.orEnterKey"))
                Spacer(Modifier.height(2.dp))
                Text(current.secret, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(4.dp))
                LinkButton(onClick = {
                    copyToClipboard(context, setupKeyLabel, current.secret)
                }) {
                    Text(t("settingsMore.copyKey"))
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text(t("settingsMore.sixDigitCode")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
        )

        is EnrolStep.Codes -> ConfirmDialog(
            title = t("settingsMore.saveRecoveryCodes"),
            body = t("settingsMore.saveRecoveryCodesBody"),
            confirmLabel = t("settingsMore.savedThem"),
            // The friction is the feature: this is the step people skip and
            // then need six months later.
            confirmEnabled = savedCodes,
            // No way out but forward: see SettingsUi.ConfirmDialog.
            dismissLabel = null,
            onDismiss = {},
            onConfirm = {
                step = EnrolStep.Idle
                savedCodes = false
                onChanged()
                scope.showMessage(
                    AppStrings.translate(locale, "settingsMore.twoFactorOn"),
                )
            },
            extraContent = {
                Spacer(Modifier.height(10.dp))
                Column {
                    current.codes.forEach { entry ->
                        Text(entry, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = {
                        copyToClipboard(
                            context, recoveryCodesLabel, current.codes.joinToString("\n"),
                        )
                        savedCodes = true
                        scope.showMessage(
                            AppStrings.translate(locale, "settingsMore.copiedToast"),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        if (savedCodes) {
                            t("settingsMore.copied")
                        } else {
                            t("settingsMore.copyAllCodes")
                        },
                    )
                }
            },
        )

        EnrolStep.Idle -> Unit
    }

    if (confirmingOff) {
        ConfirmDialog(
            title = t("settingsMore.turnOffTwoFactorTitle"),
            body = t("settingsMore.turnOffTwoFactorBody"),
            confirmLabel = t("settingsMore.turnItOff"),
            destructive = true,
            pending = busy,
            error = actionError,
            onDismiss = { confirmingOff = false },
            onConfirm = {
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        val token = scope.graph.api.freshSession()?.accessToken
                            ?: error(
                                AppStrings.translate(locale, "settingsMore.signedOut"),
                            )
                        mfa.factors.forEach { factor ->
                            scope.graph.supabaseAuth.unenrollFactor(token, factor.id)
                        }
                        confirmingOff = false
                        onChanged()
                        scope.showMessage(
                            AppStrings.translate(locale, "settingsMore.twoFactorOff"),
                        )
                    } catch (cause: Exception) {
                        fail(cause)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
