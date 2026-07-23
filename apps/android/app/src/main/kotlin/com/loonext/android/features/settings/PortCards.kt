package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.assertAboveIme
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/** "(416) 555-0182" → "+14165550182"; null when it isn't a NANP number. */
fun normalizeNanpInput(input: String): String? {
    val digits = input.filter(Char::isDigit)
    return when {
        digits.length == 10 -> "+1$digits"
        digits.length == 11 && digits.startsWith("1") -> "+$digits"
        else -> null
    }
}

// ---------------------------------------------------------------------------
// Port form (create phase 2 + fix-and-resubmit share it)
// ---------------------------------------------------------------------------

private data class PortForm(
    val entityName: String = "",
    val authPersonName: String = "",
    val accountNumber: String = "",
    val pinPasscode: String = "",
    val ssnSinLast4: String = "",
    val street: String = "",
    val locality: String = "",
    val adminArea: String = "",
    val postalCode: String = "",
) {
    fun isComplete(wireless: Boolean): Boolean =
        entityName.isNotBlank() && authPersonName.isNotBlank() &&
            accountNumber.isNotBlank() && street.isNotBlank() &&
            locality.isNotBlank() && adminArea.isNotBlank() && postalCode.isNotBlank() &&
            (!wireless || (pinPasscode.isNotBlank() && Regex("^\\d{4}$").matches(ssnSinLast4)))

    /** The shared fields of POST and PUT /v1/port-requests bodies. */
    fun fieldsJson(wireless: Boolean): JsonObject = buildJsonObject {
        put("entity_name", entityName.trim())
        put("auth_person_name", authPersonName.trim())
        put("account_number", accountNumber.trim())
        if (wireless) {
            put("pin_passcode", pinPasscode.trim())
            put("ssn_sin_last4", ssnSinLast4.trim())
        }
        put("service_street", street.trim())
        put("service_locality", locality.trim())
        put("service_admin_area", adminArea.trim())
        put("service_postal_code", postalCode.trim())
    }
}

@Composable
private fun PortFormFields(
    form: PortForm,
    onForm: (PortForm) -> Unit,
    wireless: Boolean,
    country: String,
    enabled: Boolean,
) {
    val ssnLabel = if (country == "US") "SSN" else "SIN"
    val regionLabel = if (country == "US") "State" else "Province"
    val postalLabel = if (country == "US") "ZIP code" else "Postal code"

    @Composable
    fun field(
        value: String,
        label: String,
        onChange: (String) -> Unit,
        keyboard: KeyboardType = KeyboardType.Text,
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            singleLine = true,
            enabled = enabled,
            label = { Text(label) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        )
    }

    Text(
        "Enter these exactly as they appear on your current carrier's bill. " +
            "Mismatches are the top cause of rejections.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    field(form.entityName, "Account holder", { onForm(form.copy(entityName = it)) })
    field(form.authPersonName, "Authorized person", { onForm(form.copy(authPersonName = it)) })
    field(form.accountNumber, "Account number", { onForm(form.copy(accountNumber = it)) })
    if (wireless) {
        Text(
            "This is a mobile number. Enter the transfer PIN and the last 4 of the " +
                "account holder's $ssnLabel. We store only the last 4.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
        field(form.pinPasscode, "Transfer PIN", { onForm(form.copy(pinPasscode = it)) })
        field(
            form.ssnSinLast4,
            "Last 4 of $ssnLabel",
            { next ->
                if (next.length <= 4 && next.all(Char::isDigit)) {
                    onForm(form.copy(ssnSinLast4 = next))
                }
            },
            keyboard = KeyboardType.Number,
        )
    }
    field(form.street, "Street address", { onForm(form.copy(street = it)) })
    field(form.locality, "City", { onForm(form.copy(locality = it)) })
    field(form.adminArea, regionLabel, { onForm(form.copy(adminArea = it)) })
    field(form.postalCode, postalLabel, { onForm(form.copy(postalCode = it)) })
}

// ---------------------------------------------------------------------------
// Ports block: start affordance + one tracker card per port
// ---------------------------------------------------------------------------

@Composable
fun PortsBlock(
    scope: SettingsScope,
    company: CompanyView,
    ports: List<PortRequest>,
    onChanged: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    var starting by remember { mutableStateOf(false) }

    ports.filter { it.status != PortStatus.CANCELLED }.forEach { port ->
        PortCard(scope, port, onChanged)
    }

    if (canManage && company.subscriptionActive) {
        SettingsCard(
            title = "Bring your existing number",
            description = "Transfer a number you already own. It keeps working with " +
                "your current carrier until the switch completes, usually a few " +
                "business days. Transfers are free.",
        ) {
            OutlinedButton(onClick = { starting = true }) { Text("Start a transfer") }
        }
    }

    if (starting) {
        StartPortDialog(
            scope = scope,
            company = company,
            onDismiss = { starting = false },
            onCreated = {
                starting = false
                onChanged()
            },
        )
    }
}

@Composable
private fun PortCard(scope: SettingsScope, port: PortRequest, onChanged: () -> Unit) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    val canCancel = SettingsRoleGate.canCancelPort(scope.role)
    var fixing by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(title = "Transfer: ${formatPhone(port.phone_e164)}") {
        when (port.status) {
            PortStatus.CANCEL_PENDING -> StatusPill("Cancelling", PillTone.Neutral)
            PortStatus.EXCEPTION -> StatusPill("Needs attention", PillTone.Warn)
            PortStatus.PORTED -> StatusPill("Ported", PillTone.Positive)
            else -> StatusPill(
                PORT_STEPS.getOrNull(portStepIndex(port.status)) ?: port.status,
                PillTone.Warn,
            )
        }
        Spacer(Modifier.height(8.dp))
        PortStepper(port.status)

        port.foc_date?.let { foc ->
            Text(
                "The carriers agreed on a switch date: $foc.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.status == PortStatus.EXCEPTION) {
            Text(
                "Your current carrier rejected the transfer" +
                    (port.rejection_reason?.let { ": $it" } ?: ".") +
                    " Fix the details and resubmit. Nothing is lost.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.bridge_number_e164 != null) {
            Text(
                "Temporary number while you wait: ${formatPhone(port.bridge_number_e164)}.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.assignment_blocked) {
            Text(
                "Your number arrived, but its texting registration is still held by " +
                    "your previous texting provider. Ask them to release it, and " +
                    "texting switches on automatically.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        // Documents: needed while draft (first submit) or exception (resubmit).
        if (canManage && (port.status == PortStatus.DRAFT || port.status == PortStatus.EXCEPTION)) {
            Spacer(Modifier.height(8.dp))
            PortDocumentsRow(scope, port, onChanged)
        }

        InlineError(actionError)
        Row(modifier = Modifier.padding(top = 6.dp)) {
            if (canManage && port.status == PortStatus.DRAFT && port.has_loa && port.has_invoice) {
                Button(
                    onClick = {
                        busy = true
                        actionError = null
                        coroutines.launch {
                            try {
                                scope.repo.submitPort(scope.companyId, port.id)
                                scope.showMessage("Transfer submitted to the carriers.")
                                onChanged()
                            } catch (cause: Exception) {
                                actionError = cause.userMessage()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                ) { Text(if (busy) "Submitting…" else "Submit transfer") }
                Spacer(Modifier.width(8.dp))
            }
            if (canManage && port.status == PortStatus.EXCEPTION) {
                Button(
                    onClick = { fixing = true },
                    enabled = !busy,
                ) { Text("Fix and resubmit") }
                Spacer(Modifier.width(8.dp))
            }
            if (canCancel &&
                port.status != PortStatus.PORTED &&
                port.status != PortStatus.CANCEL_PENDING
            ) {
                TextButton(onClick = { cancelling = true }, enabled = !busy) {
                    Text("Cancel transfer", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (fixing) {
        FixPortDialog(
            scope = scope,
            port = port,
            onDismiss = { fixing = false },
            onDone = {
                fixing = false
                onChanged()
            },
        )
    }
    if (cancelling) {
        ConfirmDialog(
            title = "Cancel this transfer?",
            body = "Your number stays with your current carrier and nothing changes " +
                "there. You can start a new transfer any time.",
            confirmLabel = "Cancel transfer",
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
                        scope.repo.cancelPort(scope.companyId, port.id)
                        cancelling = false
                        scope.showMessage("Transfer cancelled.")
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

/** The calm 4-step tracker: Draft → Submitted → In progress → Ported. */
@Composable
private fun PortStepper(status: String) {
    val index = portStepIndex(status)
    Row(verticalAlignment = Alignment.CenterVertically) {
        PORT_STEPS.forEachIndexed { i, step ->
            val reached = index >= i
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                androidx.compose.foundation.layout.Box(
                    Modifier
                        .size(10.dp)
                        .background(
                            if (reached) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceContainerHigh,
                            RoundedCornerShape(percent = 50),
                        ),
                )
                Text(
                    step,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (reached) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (i < PORT_STEPS.lastIndex) {
                androidx.compose.foundation.layout.Box(
                    Modifier
                        .weight(1f)
                        .padding(horizontal = 4.dp)
                        .height(2.dp)
                        .background(
                            if (index > i) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant,
                        ),
                )
            }
        }
    }
}

@Composable
private fun PortDocumentsRow(scope: SettingsScope, port: PortRequest, onChanged: () -> Unit) {
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val picker = rememberDocumentPicker(
        onPicked = { upload ->
            uploading = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.uploadPortDocuments(scope.companyId, port.id, listOf(upload))
                    scope.showMessage(
                        if (upload.fieldName == "loa") "Letter of authorization uploaded."
                        else "Carrier bill uploaded.",
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
        "Two documents are needed: a signed letter of authorization and a recent " +
            "bill from your current carrier (PDF, PNG, or JPEG).",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { picker.pick("loa") },
            enabled = !uploading,
        ) { Text(if (port.has_loa) "Replace LOA ✓" else "Upload LOA") }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { picker.pick("invoice") },
            enabled = !uploading,
        ) { Text(if (port.has_invoice) "Replace bill ✓" else "Upload bill") }
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

// ---------------------------------------------------------------------------
// Start-a-port dialog: portability check first, then the full account form
// ---------------------------------------------------------------------------

@Composable
private fun StartPortDialog(
    scope: SettingsScope,
    company: CompanyView,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
) {
    var phoneInput by remember { mutableStateOf("") }
    var check by remember { mutableStateOf<PortabilityCheck?>(null) }
    var checkedE164 by remember { mutableStateOf<String?>(null) }
    var form by remember { mutableStateOf(PortForm()) }
    var wantsBridge by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val idempotencyKey = remember { UUID.randomUUID().toString() }
    val coroutines = rememberCoroutineScope()

    val verdict = check
    val wireless = verdict?.is_wireless == true

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("Bring your existing number") },
        text = {
            // #199: platform-positioned dialog window + debug guard on the
            // port form fields.
            Column(Modifier.verticalScroll(rememberScrollState()).assertAboveIme("dialog")) {
                if (verdict == null || !verdict.portable) {
                    OutlinedTextField(
                        value = phoneInput,
                        onValueChange = { phoneInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !pending,
                        label = { Text("Number to transfer") },
                        placeholder = { Text("(416) 555-0182") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    )
                    if (verdict != null && !verdict.portable) {
                        Text(
                            verdict.reason
                                ?: "That number can't be transferred automatically.",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                } else {
                    Text(
                        formatPhone(checkedE164) + " can be transferred." +
                            (if (wireless) {
                                " It's a mobile number, so a transfer PIN and ID check " +
                                    "are required."
                            } else {
                                ""
                            }),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (!verdict.messaging_capable) {
                        Text(
                            "Heads up: this number may not support texting after the " +
                                "transfer. Calls will still work.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    PortFormFields(
                        form = form,
                        onForm = { form = it },
                        wireless = wireless,
                        country = verdict.country ?: company.country,
                        enabled = !pending,
                    )
                    LabeledSwitchRow(
                        label = "Give me a temporary number while it transfers",
                        supporting = "Optional. Texting starts right away on the " +
                            "temporary number; your own number takes over when the " +
                            "transfer completes.",
                        checked = wantsBridge,
                        onCheckedChange = { wantsBridge = it },
                        enabled = !pending,
                    )
                }
                InlineError(error)
            }
        },
        confirmButton = {
            if (verdict == null || !verdict.portable) {
                Button(
                    onClick = {
                        val e164 = normalizeNanpInput(phoneInput)
                        if (e164 == null) {
                            error = "Enter a full 10-digit US or Canadian number."
                            return@Button
                        }
                        pending = true
                        error = null
                        coroutines.launch {
                            try {
                                check = scope.repo.checkPortability(scope.companyId, e164)
                                checkedE164 = e164
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                pending = false
                            }
                        }
                    },
                    enabled = !pending && phoneInput.isNotBlank(),
                ) { Text(if (pending) "Checking…" else "Check the number") }
            } else {
                Button(
                    onClick = {
                        val e164 = checkedE164 ?: return@Button
                        pending = true
                        error = null
                        coroutines.launch {
                            try {
                                val body = buildJsonObject {
                                    form.fieldsJson(wireless).forEach { (k, v) -> put(k, v) }
                                    put("phone_e164", e164)
                                    put("wants_bridge_number", wantsBridge)
                                }
                                scope.repo.createPort(scope.companyId, idempotencyKey, body)
                                scope.showMessage(
                                    "Transfer created. Upload the two documents to submit it.",
                                )
                                onCreated()
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                pending = false
                            }
                        }
                    },
                    enabled = !pending && form.isComplete(wireless),
                ) { Text(if (pending) "Creating…" else "Create the transfer") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !pending) { Text("Cancel") }
        },
    )
}

// ---------------------------------------------------------------------------
// Fix-and-resubmit dialog (exception → PUT, then POST /resubmit)
// ---------------------------------------------------------------------------

@Composable
private fun FixPortDialog(
    scope: SettingsScope,
    port: PortRequest,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    var form by remember {
        mutableStateOf(
            PortForm(
                entityName = port.entity_name,
                authPersonName = port.auth_person_name,
                accountNumber = "",
                street = port.service_street,
                locality = port.service_locality,
                adminArea = port.service_admin_area,
                postalCode = port.service_postal_code,
            ),
        )
    }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("Fix and resubmit") },
        text = {
            // #199: platform-positioned dialog window + debug guard on the
            // port form fields.
            Column(Modifier.verticalScroll(rememberScrollState()).assertAboveIme("dialog")) {
                port.rejection_reason?.let { reason ->
                    Text(
                        "Rejection reason: $reason",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                Text(
                    "The account number and PIN are never shown back for security. " +
                        "Re-enter them.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
                PortFormFields(
                    form = form,
                    onForm = { form = it },
                    wireless = port.is_wireless,
                    country = port.country,
                    enabled = !pending,
                )
                InlineError(error)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    pending = true
                    error = null
                    coroutines.launch {
                        try {
                            scope.repo.updatePort(
                                scope.companyId,
                                port.id,
                                form.fieldsJson(port.is_wireless),
                            )
                            scope.repo.resubmitPort(scope.companyId, port.id)
                            scope.showMessage("Transfer resubmitted.")
                            onDone()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            pending = false
                        }
                    }
                },
                enabled = !pending && form.isComplete(port.is_wireless),
            ) { Text(if (pending) "Resubmitting…" else "Resubmit") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !pending) { Text("Cancel") }
        },
    )
}
