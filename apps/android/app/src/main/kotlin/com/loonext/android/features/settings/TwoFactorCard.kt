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
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val locale = LocalAppLocale.current
    val setupKeyLabel = t("settingsMore.setupKeyClipLabel")
    val recoveryCodesLabel = t("settingsMore.recoveryCodesClipLabel")

    fun fail(cause: Exception) {
        actionError = cause.userMessage(locale)
        busy = false
    }

    SettingsCard(
        title = t("settingsMore.twoFactorTitle"),
        description = t("settingsMore.twoFactorDesc"),
    ) {
        if (mfa.enrolled) {
            Text(
                t("settingsMore.authenticatorOn"),
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
        } else {
            ReadOnlyLine(t("settingsMore.twoFactorHow"))
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    busy = true
                    actionError = null
                    coroutines.launch {
                        try {
                            val token = scope.graph.api.freshSession()?.accessToken
                                ?: error(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.signedOut",
                                    ),
                                )
                            // The name this factor carries inside the reader's
                            // authenticator app, which is the one place it is
                            // ever read. Web translates its own (`Application
                            // d'authentification · {date}`), so this does too;
                            // Loonext and Android are a product and a platform
                            // and stay as they are in both.
                            val enrolled = scope.graph.supabaseAuth.enrollTotp(
                                token,
                                AppStrings.translate(locale, "settingsMore.tfaFactorName"),
                            )
                            val totp = enrolled["totp"]?.let { it as? kotlinx.serialization.json.JsonObject }
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
                },
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
