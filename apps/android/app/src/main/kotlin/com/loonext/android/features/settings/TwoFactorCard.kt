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
import androidx.compose.material3.TextButton
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

    fun fail(cause: Exception) {
        actionError = cause.userMessage()
        busy = false
    }

    SettingsCard(
        title = "Two-factor authentication",
        description = "A code from an app, on top of your password. It is what stops a " +
            "stolen password becoming somebody texting your customers as you.",
    ) {
        if (mfa.enrolled) {
            Text("Authenticator app is on", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(4.dp))
            if (mfa.recovery_codes_remaining > 0) {
                ReadOnlyLine(
                    "${mfa.recovery_codes_remaining} recovery " +
                        (if (mfa.recovery_codes_remaining == 1) "code" else "codes") + " left.",
                )
            } else {
                // Nought left is a lockout waiting for a lost phone, so it
                // reads as something to fix rather than a statistic.
                StatusPill("No recovery codes left", PillTone.Warn)
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
                    Text("New recovery codes")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { confirmingOff = true }, enabled = !busy) {
                    Text("Turn off", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            ReadOnlyLine(
                "You will add Loonext to an authenticator app — Google Authenticator, " +
                    "1Password, whatever you already use — and enter the six-digit code " +
                    "it shows. We will give you backup codes for the day you lose the phone.",
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    busy = true
                    actionError = null
                    coroutines.launch {
                        try {
                            val token = scope.graph.api.freshSession()?.accessToken
                                ?: error("You're signed out.")
                            val enrolled = scope.graph.supabaseAuth.enrollTotp(
                                token,
                                "Loonext on Android",
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
                Text("Set up two-factor")
            }
        }
        InlineError(actionError.takeIf { step is EnrolStep.Idle })
    }

    when (val current = step) {
        is EnrolStep.Verify -> ConfirmDialog(
            title = "Add Loonext to your authenticator",
            body = "Tap below to hand it to your authenticator app, or copy the key in " +
                "by hand. Then enter the six-digit code it shows.",
            confirmLabel = "Turn it on",
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
                            ?: error("You're signed out.")
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
                            "That code didn't match. Check your app and try the next one."
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
                            actionError =
                                "No authenticator app answered. Copy the key below instead."
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open my authenticator app")
                }
                Spacer(Modifier.height(8.dp))
                ReadOnlyLine("Or enter this key by hand:")
                Spacer(Modifier.height(2.dp))
                Text(current.secret, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = {
                    copyToClipboard(context, "Setup key", current.secret)
                }) {
                    Text("Copy key")
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Six-digit code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
        )

        is EnrolStep.Codes -> ConfirmDialog(
            title = "Save your recovery codes",
            body = "This is the only time you will see these. If you lose your phone, one " +
                "of these codes is how you get back in — without them, getting back into " +
                "your business line takes us weeks.",
            confirmLabel = "I've saved them",
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
                scope.showMessage("Two-factor authentication is on.")
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
                            context, "Recovery codes", current.codes.joinToString("\n"),
                        )
                        savedCodes = true
                        scope.showMessage("Copied.")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (savedCodes) "Copied" else "Copy all codes")
                }
            },
        )

        EnrolStep.Idle -> Unit
    }

    if (confirmingOff) {
        ConfirmDialog(
            title = "Turn off two-factor authentication?",
            body = "Your account goes back to a password alone. If this workspace requires " +
                "two-factor, you will be asked to set it up again the next time you open " +
                "the app.",
            confirmLabel = "Turn it off",
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
                            ?: error("You're signed out.")
                        mfa.factors.forEach { factor ->
                            scope.graph.supabaseAuth.unenrollFactor(token, factor.id)
                        }
                        confirmingOff = false
                        onChanged()
                        scope.showMessage("Two-factor authentication is off.")
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
