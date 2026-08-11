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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
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
            title = t("settingsMore.textEnableTitle"),
            description = t("settingsMore.textEnableDesc"),
        ) {
            OutlinedButton(onClick = { starting = true }) {
                Text(t("settingsMore.textEnableAction"))
            }
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
    val locale = LocalAppLocale.current

    val open = order.status != TextEnablementStatus.COMPLETED &&
        order.status != TextEnablementStatus.CANCELLED

    SettingsCard(
        title = t("settingsMore.textEnableCardTitle", "number" to formatPhone(order.phone_e164)),
    ) {
        when (order.status) {
            TextEnablementStatus.COMPLETED ->
                StatusPill(t("settingsMore.teLive"), PillTone.Positive)

            TextEnablementStatus.FAILED ->
                StatusPill(t("settingsMore.teFailed"), PillTone.Bad)

            TextEnablementStatus.ACTION_REQUIRED ->
                StatusPill(t("settingsMore.statusActionNeeded"), PillTone.Warn)

            TextEnablementStatus.IN_PROGRESS ->
                StatusPill(t("settingsMore.teReviewing"), PillTone.Warn)

            TextEnablementStatus.PENDING ->
                StatusPill(t("settingsMore.teReceived"), PillTone.Warn)

            else -> StatusPill(order.status, PillTone.Neutral)
        }
        Spacer(Modifier.height(6.dp))
        // The carrier's own `last_error` is appended verbatim — it is their
        // sentence, and a translation of it here would be a second copy that
        // goes stale the moment they reword theirs.
        val carrierSays = order.last_error
            ?.let { t("settingsMore.colonReason", "reason" to it) }
            ?: t("settingsMore.fullStop")
        Text(
            when (order.status) {
                TextEnablementStatus.COMPLETED -> t("settingsMore.teLiveBody")

                TextEnablementStatus.FAILED ->
                    t("settingsMore.teFailedBody") + carrierSays +
                        t("settingsMore.teFixAndResubmit")

                TextEnablementStatus.ACTION_REQUIRED ->
                    t("settingsMore.teActionBody") + carrierSays

                else -> t("settingsMore.teReviewingBody")
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
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.orderResubmitted",
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
                            t("settingsMore.resubmitting")
                        } else {
                            t("settingsMore.resubmit")
                        },
                    )
                }
                Spacer(Modifier.width(8.dp))
            }
            if (canCancel && open) {
                LinkButton(onClick = { cancelling = true }, enabled = !busy) {
                    Text(
                        t("settingsMore.cancelOrder"),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }

    if (cancelling) {
        ConfirmDialog(
            title = t("settingsMore.cancelTextEnableTitle"),
            body = t("settingsMore.cancelTextEnableBody"),
            confirmLabel = t("settingsMore.cancelOrder"),
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
                        scope.repo.cancelTextEnablement(scope.companyId, order.id)
                        cancelling = false
                        scope.showMessage(
                            AppStrings.translate(
                                locale,
                                "settingsMore.textEnableCancelled",
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
    val locale = LocalAppLocale.current
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
                        AppStrings.translate(
                            locale,
                            if (upload.fieldName == "loa") {
                                "settingsMore.loaUploaded"
                            } else {
                                "settingsMore.plainBillUploaded"
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
        t("settingsMore.teDocsNote"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { picker.pick("loa") },
            enabled = !uploading,
        ) {
            Text(
                if (order.has_loa) {
                    t("settingsMore.replaceLoa")
                } else {
                    t("settingsMore.uploadLoa")
                },
            )
        }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { picker.pick("bill") },
            enabled = !uploading,
        ) {
            Text(
                if (order.has_bill) {
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
    val locale = LocalAppLocale.current

    fun requestCode(method: String) {
        requesting = true
        error = null
        coroutines.launch {
            try {
                scope.repo.requestVerificationCode(scope.companyId, order.id, method)
                codeSent = true
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        if (method == "sms") {
                            "settingsMore.codeSentBySms"
                        } else {
                            "settingsMore.codeComingByCall"
                        },
                    ),
                )
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                requesting = false
            }
        }
    }

    Text(
        t("settingsMore.ownershipCheckNote"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(modifier = Modifier.padding(top = 6.dp)) {
        OutlinedButton(
            onClick = { requestCode("sms") },
            enabled = !requesting && !verifying,
        ) { Text(t("settingsMore.textMeTheCode")) }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(
            onClick = { requestCode("call") },
            enabled = !requesting && !verifying,
        ) { Text(t("settingsMore.callMeInstead")) }
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
                label = { Text(t("settingsMore.verificationCode")) },
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
                            scope.showMessage(
                                AppStrings.translate(
                                    locale,
                                    "settingsMore.numberVerified",
                                ),
                            )
                            onChanged()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            verifying = false
                        }
                    }
                },
                enabled = !verifying && code.isNotBlank(),
            ) {
                Text(
                    if (verifying) {
                        t("settingsMore.checking")
                    } else {
                        t("settingsMore.verify")
                    },
                )
            }
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
    val locale = LocalAppLocale.current

    ConfirmDialog(
        title = t("settingsMore.textEnableTitle"),
        body = t("settingsMore.startTextEnableBody"),
        confirmLabel = t("settingsMore.start"),
        pending = pending,
        error = error,
        onDismiss = onDismiss,
        onConfirm = {
            val e164 = normalizeNanpInput(phoneInput)
            if (e164 == null) {
                error = AppStrings.translate(locale, "settingsMore.enterFullNanp")
                return@ConfirmDialog
            }
            pending = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.createTextEnablement(scope.companyId, idempotencyKey, e164)
                    scope.showMessage(
                        AppStrings.translate(locale, "settingsMore.teOrderCreated"),
                    )
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
                label = { Text(t("settingsMore.landlineNumberLabel")) },
                placeholder = { Text(t("settingsMore.phoneSample")) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        },
    )
}
