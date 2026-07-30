package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.RejectionDomain
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * US 10DLC registration (#157): brand + campaign status with honest dates,
 * rejection reason + resubmit (POST /v1/registration/submit), and the
 * sole-proprietor SMS OTP verify/resend step. The full wizard form stays on
 * the web — this surface tracks and unblocks.
 */
@Composable
fun RegistrationBlock(
    scope: SettingsScope,
    company: CompanyView,
    registration: RegistrationDetailPair,
    onChanged: () -> Unit,
) {
    // CA without US texting has nothing to register yet — but turning it on is
    // an owner decision we can take right here, the way the web does.
    if (company.country == "CA" && !company.us_texting_enabled) {
        EnableUsCard(scope, onChanged)
        return
    }

    val brand = registration.brand
    val campaign = registration.campaign
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "Texting registration",
        description = "US carriers require every business texter to register (10DLC). " +
            "Approval usually takes a few days; texting US numbers starts once both " +
            "steps are approved.",
    ) {
        if (brand == null && campaign == null) {
            Text(
                "Registration hasn't started yet. It's created automatically when " +
                    "your subscription starts.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SettingsCard
        }

        // #352: which field the rejection notice asked the form to focus.
        var focusField by remember { mutableStateOf<String?>(null) }

        RegistrationRow(label = "Business identity", detail = brand)
        Spacer(Modifier.height(8.dp))
        RegistrationRow(label = "Messaging campaign", detail = campaign)

        val rejected = listOfNotNull(brand, campaign)
            .firstOrNull { it.status == RegistrationStatus.REJECTED }
        if (rejected != null) {
            Spacer(Modifier.height(8.dp))
            // #352: the carrier's token, translated into what happened and the
            // one thing to change, with a jump to the field it concerns. G7 has
            // required "rejection reason in plain language" since before launch;
            // what shipped was the reason, raw.
            RejectionNotice(
                domain = RejectionDomain.REGISTRATION,
                reason = rejected.rejection_reason,
                submissionCount = rejected.submission_count,
                onGoToField = { focusField = it },
            )
        }

        // Draft and rejected rows are both editable, and both are dead ends
        // without this: a rejection you cannot act on, or a draft that never
        // goes out. Resubmitting without an edit stays possible.
        val editable = registrationEditable(brand) || registrationEditable(campaign)
        if (canManage && editable) {
            InlineError(error)
            RegistrationFixForm(
                scope = scope,
                country = company.country,
                brand = brand,
                campaign = campaign,
                submitLabel = if (rejected != null) {
                    "Resubmit registration"
                } else {
                    "Submit registration"
                },
                onSubmitted = onChanged,
                focusField = focusField,
                onFocusHandled = { focusField = null },
            )
            if (rejected != null) {
                Button(
                    onClick = {
                        submitting = true
                        error = null
                        coroutines.launch {
                            try {
                                scope.repo.submitRegistration(scope.companyId)
                                scope.showMessage("Registration resubmitted.")
                                onChanged()
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                submitting = false
                            }
                        }
                    },
                    enabled = !submitting,
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Text(
                        if (submitting) {
                            "Resubmitting…"
                        } else {
                            "Resubmit without changes"
                        },
                    )
                }
            }
        }

        // Sole-proprietor brands verify ownership with an SMS PIN to the
        // registered mobile — the one in-app unblock the registry needs.
        if (canManage && brand != null && brand.sole_proprietor &&
            brand.status != RegistrationStatus.APPROVED &&
            brand.status != RegistrationStatus.DRAFT &&
            brand.status != RegistrationStatus.REJECTED
        ) {
            Spacer(Modifier.height(10.dp))
            SolePropOtpRow(scope, onChanged)
        }

        if (!canManage) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine("Only owners and admins can change registration.")
        }
    }
}

/**
 * A Canadian workspace turning US texting on: a one-time $29 carrier
 * registration, owner only. Everyone else gets the honest read-only line.
 */
@Composable
private fun EnableUsCard(scope: SettingsScope, onChanged: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "US texting",
        description = "Texting Canadian numbers already works. Texting US numbers needs " +
            "a one-time carrier registration.",
    ) {
        if (SettingsRoleGate.canEnableUsTexting(scope.role)) {
            Button(onClick = { confirming = true }) {
                Text("Enable US texting: \$29 one-time")
            }
        } else {
            ReadOnlyLine(
                "Ask your account owner to enable US texting; it's a one-time " +
                    "\$29 carrier registration.",
            )
        }
    }

    if (confirming) {
        ConfirmDialog(
            title = "Enable US texting?",
            body = "A one-time \$29 registration fee is charged to your card on file, " +
                "and we register your business with US carriers. Approval usually " +
                "takes 3 to 7 business days. We handle it and email you when it's live.",
            confirmLabel = if (pending) "Starting…" else "Enable US texting",
            confirmEnabled = !pending,
            pending = pending,
            error = error,
            dismissLabel = "Not now",
            onDismiss = {
                if (!pending) {
                    confirming = false
                    error = null
                }
            },
            onConfirm = {
                pending = true
                error = null
                coroutines.launch {
                    try {
                        scope.repo.enableUsTexting(scope.companyId)
                        confirming = false
                        scope.showMessage(
                            "US registration started. We'll email you when it's approved.",
                        )
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        pending = false
                    }
                }
            },
        )
    }
}

@Composable
private fun RegistrationRow(label: String, detail: RegistrationDetail?) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            val line = when {
                detail == null -> "Not started"
                detail.status == RegistrationStatus.APPROVED ->
                    "Approved" + (detail.approved_at?.let { " ${relativeTime(it)} ago" } ?: "")

                detail.status == RegistrationStatus.REJECTED ->
                    "Rejected" + (detail.rejected_at?.let { " ${relativeTime(it)} ago" } ?: "")

                detail.status == RegistrationStatus.SUBMITTED ||
                    detail.status == RegistrationStatus.PENDING ->
                    "In review" + (detail.submitted_at?.let {
                        " · submitted ${relativeTime(it)} ago"
                    } ?: "")

                else -> "Draft · not submitted yet"
            }
            Text(
                line,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(8.dp))
        when (detail?.status) {
            null -> StatusPill("Not started", PillTone.Neutral)
            RegistrationStatus.APPROVED -> StatusPill("Approved", PillTone.Positive)
            RegistrationStatus.REJECTED -> StatusPill("Rejected", PillTone.Bad)
            RegistrationStatus.SUBMITTED, RegistrationStatus.PENDING ->
                StatusPill("In review", PillTone.Warn)

            else -> StatusPill("Draft", PillTone.Neutral)
        }
    }
}

@Composable
private fun SolePropOtpRow(scope: SettingsScope, onChanged: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var verifying by remember { mutableStateOf(false) }
    var resending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    Text(
        "One more step: the registry texted a 6-digit PIN to your registered mobile " +
            "to confirm it's really you.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(
        modifier = Modifier.padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = code,
            onValueChange = { next ->
                if (next.length <= 6 && next.all(Char::isDigit)) code = next
            },
            modifier = Modifier.weight(1f),
            singleLine = true,
            enabled = !verifying && !resending,
            label = { Text("6-digit PIN") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        Spacer(Modifier.width(8.dp))
        Button(
            onClick = {
                verifying = true
                error = null
                coroutines.launch {
                    try {
                        scope.repo.verifyRegistrationOtp(scope.companyId, code)
                        scope.showMessage("Verified. The registry review continues.")
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        verifying = false
                    }
                }
            },
            enabled = !verifying && !resending && code.length == 6,
        ) { Text(if (verifying) "Checking…" else "Verify") }
    }
    OutlinedButton(
        onClick = {
            resending = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.resendRegistrationOtp(scope.companyId)
                    scope.showMessage("A new PIN is on its way.")
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    resending = false
                }
            }
        },
        enabled = !verifying && !resending,
        modifier = Modifier.padding(top = 6.dp),
    ) { Text(if (resending) "Sending…" else "Resend the PIN") }
    InlineError(error)
}
