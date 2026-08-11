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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.RejectionDomain
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
    // #319: the field a carrier rejection concerns, routed here by the notice
    // above. Nine fields and no direction is how somebody resubmits the same
    // mistake and buys another multi-day carrier review.
    focusField: String? = null,
    onFocusHandled: () -> Unit = {},
) {
    val ssnLabel = if (country == "US") {
        t("settingsMore.ssnLabel")
    } else {
        t("settingsMore.sinLabel")
    }
    val regionLabel = if (country == "US") {
        t("settingsMore.stateLabel")
    } else {
        t("settingsMore.provinceLabel")
    }
    val postalLabel = if (country == "US") {
        t("settingsMore.zipLabel")
    } else {
        t("settingsMore.postalLabel")
    }
    // Keyed by the same field names the shared catalogue routes to, so the
    // vectors that pin the routing also pin what this can reach.
    val focusRequesters = remember { mutableMapOf<String, FocusRequester>() }

    @Composable
    fun field(
        value: String,
        label: String,
        onChange: (String) -> Unit,
        keyboard: KeyboardType = KeyboardType.Text,
        key: String? = null,
    ) {
        val requester = key?.let { name ->
            remember(name) { FocusRequester() }.also { focusRequesters[name] = it }
        }
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .let { if (requester != null) it.focusRequester(requester) else it },
            singleLine = true,
            enabled = enabled,
            label = { Text(label) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        )
    }

    // The requesters exist by the time effects run, so unlike the registration
    // form there is nothing to expand first — these fields are always composed.
    LaunchedEffect(focusField) {
        val target = focusField ?: return@LaunchedEffect
        // requestFocus throws if the node is gone (a field the wireless branch
        // does not render). Losing the cursor is a worse-than-nothing outcome,
        // not a crash-worthy one.
        runCatching { focusRequesters[target]?.requestFocus() }
        onFocusHandled()
    }

    Text(
        t("settingsMore.portFormIntro"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    field(
        form.entityName,
        t("settingsMore.accountHolder"),
        { onForm(form.copy(entityName = it)) },
        key = "entity_name",
    )
    field(
        form.authPersonName,
        t("settingsMore.authorizedPerson"),
        { onForm(form.copy(authPersonName = it)) },
        key = "auth_person_name",
    )
    field(
        form.accountNumber,
        t("settingsMore.accountNumber"),
        { onForm(form.copy(accountNumber = it)) },
        key = "account_number",
    )
    if (wireless) {
        Text(
            t("settingsMore.portWirelessNote", "idLabel" to ssnLabel),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
        field(
            form.pinPasscode,
            t("settingsMore.transferPin"),
            { onForm(form.copy(pinPasscode = it)) },
        )
        field(
            form.ssnSinLast4,
            t("settingsMore.last4Of", "idLabel" to ssnLabel),
            { next ->
                if (next.length <= 4 && next.all(Char::isDigit)) {
                    onForm(form.copy(ssnSinLast4 = next))
                }
            },
            keyboard = KeyboardType.Number,
        )
    }
    field(
        form.street,
        t("settingsMore.streetAddress"),
        { onForm(form.copy(street = it)) },
        key = "service_street",
    )
    field(form.locality, t("settingsMore.city"), { onForm(form.copy(locality = it)) })
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
    /**
     * #523: the same numbers the cards above are drawn from, so a tracker can
     * tell whether the line its transfer delivered still works. Passed in rather
     * than fetched here because the two surfaces describing one line must read
     * one list — see [portLineIsHeld].
     */
    numbers: List<PhoneNumberSummary>,
    onChanged: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    var starting by remember { mutableStateOf(false) }

    ports.filter { it.status != PortStatus.CANCELLED }.forEach { port ->
        PortCard(
            scope = scope,
            port = port,
            heldLine = portLineIsHeld(port.phone_e164, numbers),
            onChanged = onChanged,
        )
    }

    if (canManage && company.subscriptionActive) {
        SettingsCard(
            title = t("settingsMore.bringNumber"),
            description = t("settingsMore.bringNumberDesc"),
        ) {
            OutlinedButton(onClick = { starting = true }) {
                Text(t("settingsMore.startTransfer"))
            }
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

/**
 * #523 — the tracker's status pill, which is about the TRANSFER until the line
 * it delivered stops working, and about the line from then on.
 *
 * THE HELD BRANCH IS FIRST, and that ordering is the whole fix. A completed
 * transfer used to draw "Ported" in the positive tone whatever had since become
 * of the number, so a held ported line carried a green all-clear on one card and
 * "you can't send or answer from it" on the card above. One line, two verdicts,
 * and the pleasant one wins every reading.
 *
 * WARN RATHER THAN BAD, matching the number card's own "Suspended" pill. Nothing
 * has been lost — the number is still ours and still receiving — and a red pill
 * on a card whose note says "it hasn't been given up" would contradict its own
 * paragraph, which is the class of defect this function exists to end.
 *
 * Extracted from the composable so it can be proven: a unit test cannot render a
 * card, and the property that matters here is a decision, not a pixel.
 */
internal fun portPill(status: String, heldLine: Boolean): Pair<String, PillTone> = when {
    heldLine -> "On hold" to PillTone.Warn
    status == PortStatus.CANCEL_PENDING -> "Cancelling" to PillTone.Neutral
    status == PortStatus.EXCEPTION -> "Needs attention" to PillTone.Warn
    status == PortStatus.PORTED -> "Ported" to PillTone.Positive
    else -> (PORT_STEPS.getOrNull(portStepIndex(status)) ?: status) to PillTone.Warn
}

@Composable
private fun PortCard(
    scope: SettingsScope,
    port: PortRequest,
    /** #523: the number this transfer delivered is suspended — see [portLineIsHeld]. */
    heldLine: Boolean,
    onChanged: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    val canCancel = SettingsRoleGate.canCancelPort(scope.role)
    var fixing by remember { mutableStateOf(false) }
    // #319: which form field the rejection notice asked the fix dialog to focus.
    var focusField by remember { mutableStateOf<String?>(null) }
    var cancelling by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current

    SettingsCard(
        title = t("settingsMore.transferTitle", "number" to formatPhone(port.phone_e164)),
    ) {
        val (pillLabel, pillTone) = portPill(port.status, heldLine)
        StatusPill(pillLabel, pillTone)
        Spacer(Modifier.height(8.dp))
        // THE STEPPER STAYS FILLED UNDER A HOLD, deliberately. The transfer did
        // complete, and emptying it to make the card look consistent would delete
        // the true half of the story in order to fix the false one. What was
        // wrong was reading a finished transfer as a verdict on the line, so the
        // pill above and the note below say which is which — in that order,
        // because somebody who reads only the top of a card has to leave with the
        // half that changes what they do next.
        PortStepper(port.status)
        if (heldLine) {
            Text(
                portHoldNote(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        port.foc_date?.let { foc ->
            Text(
                t("settingsMore.focDate", "date" to foc),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.status == PortStatus.EXCEPTION) {
            Spacer(Modifier.height(8.dp))
            // #319: the carrier's token, translated into what happened and the
            // one thing to change, with a jump to the field it concerns. The
            // catalogue and this component both shipped with #352 and were
            // wired to registration only — a rejected transfer still read out
            // "LOA_MISMATCH" and left the customer to guess.
            RejectionNotice(
                domain = RejectionDomain.PORT,
                reason = port.rejection_reason,
                submissionCount = port.submission_count,
                onGoToField = { field ->
                    // The form lives behind a dialog here, so "take me to it"
                    // has to open the dialog before it can reach the field.
                    focusField = field
                    fixing = true
                },
            )
        }
        if (port.bridge_number_e164 != null) {
            Text(
                t(
                    "settingsMore.bridgeNumber",
                    "number" to formatPhone(port.bridge_number_e164),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.assignment_blocked) {
            Text(
                t("settingsMore.registrationHeld"),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (port.status in PRE_CUTOVER_STATUSES) {
            // Last of the informational block, above the actions: status, then
            // the facts about this transfer, then what to do about them.
            Spacer(Modifier.height(8.dp))
            PreCutoverChecklist()
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
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.transferSubmitted",
                                    ),
                                )
                                onChanged()
                            } catch (cause: Exception) {
                                actionError = cause.userMessage()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                ) {
                    Text(
                        if (busy) {
                            t("settingsMore.submitting")
                        } else {
                            t("settingsMore.submitTransfer")
                        },
                    )
                }
                Spacer(Modifier.width(8.dp))
            }
            if (canManage && port.status == PortStatus.EXCEPTION) {
                Button(
                    onClick = { fixing = true },
                    enabled = !busy,
                ) { Text(t("settingsMore.fixResubmit")) }
                Spacer(Modifier.width(8.dp))
            }
            if (canCancel &&
                port.status != PortStatus.PORTED &&
                port.status != PortStatus.CANCEL_PENDING
            ) {
                LinkButton(onClick = { cancelling = true }, enabled = !busy) {
                    Text(
                        t("settingsMore.cancelTransfer"),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }

    if (fixing) {
        FixPortDialog(
            scope = scope,
            port = port,
            focusField = focusField,
            onDismiss = {
                fixing = false
                focusField = null
            },
            onDone = {
                fixing = false
                focusField = null
                onChanged()
            },
        )
    }
    if (cancelling) {
        ConfirmDialog(
            title = t("settingsMore.cancelTransferTitle"),
            body = t("settingsMore.cancelTransferBody"),
            confirmLabel = t("settingsMore.cancelTransfer"),
            destructive = true,
            pending = busy,
            error = actionError,
            dismissLabel = t("settingsMore.keepItGoing"),
            onDismiss = { cancelling = false },
            onConfirm = {
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        scope.repo.cancelPort(scope.companyId, port.id)
                        cancelling = false
                        scope.showMessage(
                            AppStrings.translate(locale, "settingsMore.transferCancelled"),
                        )
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

/**
 * In flight, and the switch hasn't happened yet — the only window where this
 * advice can still be acted on. Not `draft` (nothing is in flight), not
 * `exception` (the rejection notice owns that card and a checklist under it
 * buries the fix), not `ported`/`cancelled`/`cancel-pending` (too late, or moot).
 *
 * `in-process` is here even though it is not one of the three statuses #319
 * names, because it is where a submitted transfer actually sits: routes/
 * porting.ts moves draft → in-process on submit, and exception → in-process on
 * resubmit. Leaving it out would hide the checklist for most of the wait. Our
 * own tracker already groups it with the other two at "In progress"
 * (portStepIndex).
 */
/**
 * #248: `internal` rather than private so a test can compare it to the shared
 * module at RUNTIME. The first attempt read this set out of the source with a
 * regex and got nothing — these are constants, not string literals — which is the
 * fragility that makes a source lint the wrong tool when the real values are
 * reachable. Same reason `portPill` above is internal.
 */
internal val PRE_CUTOVER_STATUSES = setOf(
    PortStatus.SUBMITTED,
    PortStatus.IN_PROCESS,
    PortStatus.FOC_DATE_CONFIRMED,
    PortStatus.ACTIVATION_IN_PROGRESS,
)

/**
 * #319 — fixed copy, fixed order, identical on every client. The order is the
 * point: cancelling the old service early is the one mistake that can genuinely
 * lose the number, so it goes first and nothing gets added after the fourth.
 *
 * This existed only in the marketing blog post (port-business-number-without-
 * going-dark), which is exactly where a customer already inside the product
 * never looks — they see "transfer in progress" and no instructions.
 */
@Composable
private fun preCutoverSteps(): List<Pair<String, String>> = listOf(
    t("settingsMore.cutoverKeepOld") to t("settingsMore.cutoverKeepOldDetail"),
    t("settingsMore.cutoverExport") to t("settingsMore.cutoverExportDetail"),
    t("settingsMore.cutoverTellCrew") to t("settingsMore.cutoverTellCrewDetail"),
    t("settingsMore.cutoverTextsTrail") to t("settingsMore.cutoverTextsTrailDetail"),
)

/**
 * Quiet guidance, not an alarm. It sits under the status pill and must not
 * out-shout it, so this borrows RejectionNotice's nested-block shape (same
 * radius, same insets) with the neutral container instead of the error one —
 * nothing here has gone wrong, and a red panel on a healthy transfer reads as
 * one that hasn't.
 */
@Composable
private fun PreCutoverChecklist() {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                t("settingsMore.beforeSwitch"),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            preCutoverSteps().forEachIndexed { index, (lead, detail) ->
                // 3dp inside an item, 10dp between them: the sentence belongs
                // to the lead above it, not to the item below. Without the gap
                // four pairs read as one paragraph and the order stops meaning
                // anything.
                Spacer(Modifier.height(if (index == 0) 8.dp else 10.dp))
                Text(
                    lead,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
    val locale = LocalAppLocale.current
    val picker = rememberDocumentPicker(
        onPicked = { upload ->
            uploading = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.uploadPortDocuments(scope.companyId, port.id, listOf(upload))
                    scope.showMessage(
                        AppStrings.translate(
                            locale,
                            if (upload.fieldName == "loa") {
                                "settingsMore.loaUploaded"
                            } else {
                                "settingsMore.billUploaded"
                            },
                        ),
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
        t("settingsMore.portDocsNote"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { picker.pick("loa") },
            enabled = !uploading,
        ) {
            Text(
                if (port.has_loa) {
                    t("settingsMore.replaceLoa")
                } else {
                    t("settingsMore.uploadLoa")
                },
            )
        }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { picker.pick("invoice") },
            enabled = !uploading,
        ) {
            Text(
                if (port.has_invoice) {
                    t("settingsMore.replaceBill")
                } else {
                    t("settingsMore.uploadBill")
                },
            )
        }
    }
    if (uploading) {
        Text(
            t("settingsMore.uploading"),
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
    val locale = LocalAppLocale.current

    val verdict = check
    val wireless = verdict?.is_wireless == true

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(t("settingsMore.bringNumber")) },
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
                        label = { Text(t("settingsMore.numberToTransfer")) },
                        placeholder = { Text(t("settingsMore.phoneSample")) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    )
                    if (verdict != null && !verdict.portable) {
                        Text(
                            verdict.reason ?: t("settingsMore.notPortable"),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                } else {
                    Text(
                        t(
                            "settingsMore.canBeTransferred",
                            "number" to formatPhone(checkedE164),
                        ) + (if (wireless) t("settingsMore.wirelessRequires") else ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (!verdict.messaging_capable) {
                        Text(
                            t("settingsMore.mayNotText"),
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
                        label = t("settingsMore.wantBridge"),
                        supporting = t("settingsMore.wantBridgeSupporting"),
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
                            error = AppStrings.translate(
                                locale,
                                "settingsMore.enterFullNanp",
                            )
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
                ) {
                    Text(
                        if (pending) {
                            t("settingsMore.checking")
                        } else {
                            t("settingsMore.checkNumber")
                        },
                    )
                }
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
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.transferCreated",
                                    ),
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
                ) {
                    Text(
                        if (pending) {
                            t("settingsMore.creating")
                        } else {
                            t("settingsMore.createTransfer")
                        },
                    )
                }
            }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !pending) { Text(t("common.cancel")) }
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
    // #319: the field the notice on the card sent them here for, if any.
    focusField: String?,
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
    var focus by remember { mutableStateOf(focusField) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(t("settingsMore.fixResubmit")) },
        text = {
            // #199: platform-positioned dialog window + debug guard on the
            // port form fields.
            Column(Modifier.verticalScroll(rememberScrollState()).assertAboveIme("dialog")) {
                // #319: the same translation the card shows, kept in view while
                // they retype, in place of the bare carrier token that used to
                // head this dialog.
                RejectionNotice(
                    domain = RejectionDomain.PORT,
                    reason = port.rejection_reason,
                    submissionCount = port.submission_count,
                    onGoToField = { focus = it },
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    t("settingsMore.reenterSecrets"),
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
                    focusField = focus,
                    onFocusHandled = { focus = null },
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
                            scope.showMessage(
                                AppStrings.translate(
                                    locale,
                                    "settingsMore.transferResubmitted",
                                ),
                            )
                            onDone()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            pending = false
                        }
                    }
                },
                enabled = !pending && form.isComplete(port.is_wireless),
            ) {
                Text(
                    if (pending) {
                        t("settingsMore.resubmitting")
                    } else {
                        t("settingsMore.resubmit")
                    },
                )
            }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !pending) { Text(t("common.cancel")) }
        },
    )
}
