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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Text-enablement (#157): "keep your number" — hosted SMS on an existing
 * landline/VoIP number while calls stay with the current carrier. Orders are
 * carrier-reviewed over days; the cards say so plainly and texting is live
 * only at `completed`.
 */
@Composable
fun TextEnableBlock(
    scope: SettingsScope,
    company: CompanyView,
    orders: List<TextEnablementOrder>,
    onChanged: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    var starting by remember { mutableStateOf(false) }

    orders.filter { it.status != TextEnablementStatus.CANCELLED }.forEach { order ->
        TextEnableCard(scope, order, onChanged)
    }

    if (canManage && company.subscriptionActive) {
        SettingsCard(
            title = "Text-enable your landline",
            description = "Keep your number: texting runs through Loonext while calls " +
                "stay exactly where they are today. The carrier review takes a few " +
                "business days.",
        ) {
            OutlinedButton(onClick = { starting = true }) { Text("Text-enable a number") }
        }
    }

    if (starting) {
        StartTextEnableDialog(
            scope = scope,
            onDismiss = { starting = false },
            onCreated = {
                starting = false
                onChanged()
            },
        )
    }
}

@Composable
private fun TextEnableCard(
    scope: SettingsScope,
    order: TextEnablementOrder,
    onChanged: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    val canCancel = SettingsRoleGate.canCancelTextEnablement(scope.role)
    var busy by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val open = order.status != TextEnablementStatus.COMPLETED &&
        order.status != TextEnablementStatus.CANCELLED

    SettingsCard(title = "Text-enable: ${formatPhone(order.phone_e164)}") {
        when (order.status) {
            TextEnablementStatus.COMPLETED -> StatusPill("Texting live", PillTone.Positive)
            TextEnablementStatus.FAILED -> StatusPill("Didn't go through", PillTone.Bad)
            TextEnablementStatus.ACTION_REQUIRED -> StatusPill("Action needed", PillTone.Warn)
            TextEnablementStatus.IN_PROGRESS -> StatusPill("Carrier reviewing", PillTone.Warn)
            TextEnablementStatus.PENDING -> StatusPill("Order received", PillTone.Warn)
            else -> StatusPill(order.status, PillTone.Neutral)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            when (order.status) {
                TextEnablementStatus.COMPLETED ->
                    "Texting is live on this number. Calls stay with your current carrier."

                TextEnablementStatus.FAILED ->
                    "The order didn't go through" +
                        (order.last_error?.let { ": $it" } ?: ".") +
                        " Fix what's named and resubmit."

                TextEnablementStatus.ACTION_REQUIRED ->
                    "The carrier needs something from you" +
                        (order.last_error?.let { ": $it" } ?: ".")

                else ->
                    "The carrier reviews text-enablement over a few business days. " +
                        "Texting goes live only when the review completes — we'll " +
                        "keep this card honest in the meantime."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (canManage && open) {
            Spacer(Modifier.height(8.dp))
            TextEnableDocumentsRow(scope, order, onChanged)
            Spacer(Modifier.height(8.dp))
            VerificationRow(scope, order, onChanged)
        }

        InlineError(actionError)
        Row(modifier = Modifier.padding(top = 6.dp)) {
            if (canManage && order.status == TextEnablementStatus.FAILED) {
                Button(
                    onClick = {
                        busy = true
                        actionError = null
                        coroutines.launch {
                            try {
                                scope.repo.resubmitTextEnablement(scope.companyId, order.id)
                                scope.showMessage("Order resubmitted.")
                                onChanged()
                            } catch (cause: Exception) {
                                actionError = cause.userMessage()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                ) { Text(if (busy) "Resubmitting…" else "Resubmit") }
                Spacer(Modifier.width(8.dp))
            }
            if (canCancel && open) {
                TextButton(onClick = { cancelling = true }, enabled = !busy) {
                    Text("Cancel order", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (cancelling) {
        ConfirmDialog(
            title = "Cancel text-enablement?",
            body = "Nothing changes with your current carrier — the number keeps " +
                "working exactly as it does today. You can start again any time.",
            confirmLabel = "Cancel order",
            destructive = true,
            pending = busy,
            error = actionError,
            dismissLabel = "Keep it going",
            onDismiss = { cancelling = false },
            onConfirm = {
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        scope.repo.cancelTextEnablement(scope.companyId, order.id)
                        cancelling = false
                        scope.showMessage("Text-enablement cancelled.")
                        onChanged()
                    } catch (cause: Exception) {
                        actionError = cause.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

@Composable
private fun TextEnableDocumentsRow(
    scope: SettingsScope,
    order: TextEnablementOrder,
    onChanged: () -> Unit,
) {
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val picker = rememberDocumentPicker(
        onPicked = { upload ->
            uploading = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.uploadTextEnablementDocuments(
                        scope.companyId, order.id, listOf(upload),
                    )
                    scope.showMessage(
                        if (upload.fieldName == "loa") "Letter of authorization uploaded."
                        else "Bill uploaded.",
                    )
                    onChanged()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    uploading = false
                }
            }
        },
        onError = { message -> error = message },
    )

    Text(
        "Ownership proof: a signed letter of authorization and a recent bill for " +
            "the number (PDF, PNG, or JPEG).",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { picker.pick("loa") },
            enabled = !uploading,
        ) { Text(if (order.has_loa) "Replace LOA ✓" else "Upload LOA") }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { picker.pick("bill") },
            enabled = !uploading,
        ) { Text(if (order.has_bill) "Replace bill ✓" else "Upload bill") }
    }
    if (uploading) {
        Text(
            "Uploading…",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
    InlineError(error)
}

@Composable
private fun VerificationRow(
    scope: SettingsScope,
    order: TextEnablementOrder,
    onChanged: () -> Unit,
) {
    var code by remember(order.id) { mutableStateOf("") }
    var requesting by remember { mutableStateOf(false) }
    var verifying by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var codeSent by remember(order.id) { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()

    fun requestCode(method: String) {
        requesting = true
        error = null
        coroutines.launch {
            try {
                scope.repo.requestVerificationCode(scope.companyId, order.id, method)
                codeSent = true
                scope.showMessage(
                    if (method == "sms") "Code sent by text to your number."
                    else "You'll get a call at your number with the code.",
                )
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                requesting = false
            }
        }
    }

    Text(
        "Number ownership check: the carrier sends a code to the number itself.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { requestCode("sms") },
            enabled = !requesting && !verifying,
        ) { Text("Text me the code") }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { requestCode("call") },
            enabled = !requesting && !verifying,
        ) { Text("Call me instead") }
    }
    if (codeSent) {
        Row(
            modifier = Modifier.padding(top = 6.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = code,
                onValueChange = { next ->
                    if (next.length <= 16) code = next
                },
                modifier = Modifier.weight(1f),
                singleLine = true,
                enabled = !verifying,
                label = { Text("Verification code") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    verifying = true
                    error = null
                    coroutines.launch {
                        try {
                            scope.repo.submitVerificationCode(
                                scope.companyId, order.id, code.trim(),
                            )
                            scope.showMessage("Number verified.")
                            onChanged()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            verifying = false
                        }
                    }
                },
                enabled = !verifying && code.isNotBlank(),
            ) { Text(if (verifying) "Checking…" else "Verify") }
        }
    }
    InlineError(error)
}

@Composable
private fun StartTextEnableDialog(
    scope: SettingsScope,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
) {
    var phoneInput by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val idempotencyKey = remember { UUID.randomUUID().toString() }
    val coroutines = rememberCoroutineScope()

    ConfirmDialog(
        title = "Text-enable your landline",
        body = "Texting for this number runs through Loonext; calls stay with your " +
            "current carrier, nothing changes there. The carrier reviews the order " +
            "over a few business days, and you'll upload proof you own the number.",
        confirmLabel = "Start",
        pending = pending,
        error = error,
        onDismiss = onDismiss,
        onConfirm = {
            val e164 = normalizeNanpInput(phoneInput)
            if (e164 == null) {
                error = "Enter a full 10-digit US or Canadian number."
                return@ConfirmDialog
            }
            pending = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.createTextEnablement(scope.companyId, idempotencyKey, e164)
                    scope.showMessage("Order created. Upload the documents to move it along.")
                    onCreated()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
        extraContent = {
            OutlinedTextField(
                value = phoneInput,
                onValueChange = { phoneInput = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                singleLine = true,
                enabled = !pending,
                label = { Text("Your landline or VoIP number") },
                placeholder = { Text("(416) 555-0182") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        },
    )
}
