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
    // CA without US texting has nothing to register — say so once, plainly.
    if (company.country == "CA" && !company.us_texting_enabled) {
        SettingsCard(title = "Texting registration") {
            Text(
                "No registration needed. Canadian texting works without one. " +
                    "Enabling US texting (from the web app) adds it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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

        RegistrationRow(label = "Business identity", detail = brand)
        Spacer(Modifier.height(8.dp))
        RegistrationRow(label = "Messaging campaign", detail = campaign)

        val rejected = listOfNotNull(brand, campaign)
            .firstOrNull { it.status == RegistrationStatus.REJECTED }
        if (rejected != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                "The carrier registry rejected this" +
                    (rejected.rejection_reason?.let { ": $it" } ?: ".") +
                    " Fix your details in the web app's registration wizard, then " +
                    "resubmit here.",
                style = MaterialTheme.typography.bodySmall,
            )
            if (canManage) {
                InlineError(error)
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
                ) { Text(if (submitting) "Resubmitting…" else "Resubmit registration") }
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

                else -> "Draft — finish the wizard in the web app"
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
                        scope.showMessage("Verified — the registry review continues.")
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
