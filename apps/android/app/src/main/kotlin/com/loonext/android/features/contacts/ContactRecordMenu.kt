package com.loonext.android.features.contacts

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.isCarrierEnforcedOptOut
import com.loonext.android.AppGraph
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.ContactActionId
import com.loonext.android.ui.common.ContactActionsInput
import com.loonext.android.ui.common.RecordMenu
import com.loonext.android.ui.common.contactActions
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #712: a contact's action menu on the contacts list, from the same `contactActions`
 * list the contact's own screen draws.
 *
 * The list row does not know whether the number is blocked, so Block is not offered
 * here rather than offered on a guess; the contact's own screen has it.
 *
 * Opt out and Delete ask first, with the same sentences that screen uses.
 */
@Composable
internal fun ContactRecordMenu(
    contact: Contact,
    expanded: Boolean,
    onDismiss: () -> Unit,
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    canDelete: Boolean,
    callerIdName: String,
    onOpen: (String) -> Unit,
    onText: (phone: String) -> Unit,
    onChanged: () -> Unit,
    onMessage: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    var confirmOptOut by remember(contact.id) { mutableStateOf(false) }
    var confirmDelete by remember(contact.id) { mutableStateOf(false) }

    val softphone = remember(graph) { SoftphoneManager.get(context, graph.api) }
    fun placeCall() {
        softphone.start(companyId, callerIdName)
        scope.launch {
            try {
                softphone.placeCall(
                    displayName = contact.name?.ifBlank { null } ?: formatPhone(contact.phone_e164),
                    contactId = contact.id,
                )
            } catch (cause: Exception) {
                onMessage(cause.userMessage(locale))
            }
        }
    }
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) placeCall() else onMessage(AppStrings.translate(locale, "contactsTasks.micNeeded"))
    }

    RecordMenu(
        expanded = expanded,
        onDismiss = onDismiss,
        actions = contactActions(
            ContactActionsInput(
                canOpen = true,
                optedOut = contact.opted_out,
                carrierEnforced = isCarrierEnforcedOptOut(contact.opt_out_source),
                blocked = null,
                canBlock = false,
                canDelete = canDelete,
            ),
        ),
        onSelect = { actionId, _ ->
            when (actionId) {
                ContactActionId.OPEN -> onOpen(contact.id)
                ContactActionId.TEXT -> onText(contact.phone_e164)
                ContactActionId.CALL ->
                    if (softphone.hasMicPermission()) placeCall()
                    else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                ContactActionId.COPY_NUMBER -> {
                    clipboard.setText(AnnotatedString(contact.phone_e164))
                    onMessage(AppStrings.translate(locale, "recordMenu.numberCopied"))
                }
                ContactActionId.OPT_OUT -> confirmOptOut = true
                ContactActionId.OPT_IN -> scope.launch {
                    try {
                        MessagingRepository(graph.api).revokeOptOut(companyId, contact.id)
                        onChanged()
                    } catch (cause: Exception) {
                        onMessage(cause.userMessage(locale))
                    }
                }
                ContactActionId.DELETE -> confirmDelete = true
            }
        },
    )

    if (confirmOptOut) {
        AlertDialog(
            onDismissRequest = { confirmOptOut = false },
            title = { Text(t("contactsTasks.optOutTitle")) },
            text = {
                Text(t("contactsTasks.optOutBody", "number" to formatPhone(contact.phone_e164)))
            },
            confirmButton = {
                TextButton(onClick = {
                    haptics.reject()
                    confirmOptOut = false
                    scope.launch {
                        try {
                            mutations.optOut(companyId, contact.id)
                            onChanged()
                        } catch (cause: Exception) {
                            onMessage(cause.userMessage(locale))
                        }
                    }
                }) {
                    Text(t("contactsTasks.optOut"), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmOptOut = false }) { Text(t("common.cancel")) }
            },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(t("contactsTasks.deleteContactTitle")) },
            text = { Text(t("contactsTasks.deleteContactBody")) },
            confirmButton = {
                TextButton(onClick = {
                    haptics.reject()
                    confirmDelete = false
                    scope.launch {
                        try {
                            mutations.delete(companyId, contact.id)
                            onChanged()
                        } catch (cause: Exception) {
                            onMessage(cause.userMessage(locale))
                        }
                    }
                }) {
                    Text(t("common.delete"), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text(t("contactsTasks.keepContact"))
                }
            },
        )
    }
}
