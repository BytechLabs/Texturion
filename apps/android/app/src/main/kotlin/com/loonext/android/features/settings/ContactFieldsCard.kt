package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.contacts.ContactFields
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactFieldDef
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #291 — the fields a workspace defines for itself.
 *
 * Design notes, and the principles behind them:
 *
 * - **Nobody types a key.** The label is the only thing worth asking for; the
 *   key is derived from it and shown, not edited. Asking a plumber to invent a
 *   machine-readable identifier is asking them about our storage format.
 *   *Applying: Smart Defaults — a new row arrives as Text, not as an empty
 *   form with five unanswered questions.*
 * - **The privacy line sits where the decision is made.** It is the one moment
 *   somebody is thinking about what goes in a field. On a help page it would
 *   never be read, and once a card number is in a text column it is too late.
 * - **The choices editor only exists for a dropdown.** Four of the five types
 *   have nothing to configure, so the fifth's editor appears when it is picked
 *   rather than sitting greyed out on every row. *Applying: Progressive
 *   Disclosure & Zen of Clarity.*
 * - **Removing says what it does to the data.** The field goes from every
 *   contact; what the crew typed into it stays. Saying so is the difference
 *   between an owner who tidies up and an owner who thinks they deleted
 *   something. *Applying: Ethical Friction, on the edge that carries a
 *   misconception rather than on every tap.*
 * - **The ceiling is shown, not enforced by a refusal at save.** Ten is
 *   plenty; the Add button goes away with a sentence explaining why.
 *
 * Mirrors the web card; `ContactFieldsParityTest` keeps the words the same.
 */
@Composable
fun ContactFieldsCard(scope: SettingsScope) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<List<ContactFieldDef>>(emptyList()) }
    var draft by remember { mutableStateOf<List<ContactFieldDef>>(emptyList()) }
    var freshKeys by remember { mutableStateOf(setOf<Int>()) }
    var cap by remember { mutableStateOf(ContactFields.CAP) }
    var saving by remember { mutableStateOf(false) }

    // Resolved in composition because `commit` runs from a press handler, where
    // the reader's locale is no longer in scope.
    val nameEveryField = t("settings.contactFieldsNeedName")
    val savedBackToStandard = t("settings.contactFieldsSavedEmpty")
    val savedOnEveryCustomer = t("settings.contactFieldsSaved")

    LaunchedEffect(scope.companyId) {
        runCatching { scope.repo.contactFields(scope.companyId) }
            .onSuccess { response ->
                saved = response.data
                draft = response.data
                cap = response.cap
                loaded = true
            }
            .onFailure { loaded = true }
    }

    fun commit() {
        if (!canEdit || saving) return
        if (draft.any { it.key.isEmpty() || it.label.isBlank() }) {
            scope.showMessage(nameEveryField)
            return
        }
        saving = true
        coroutines.launch {
            try {
                val result = scope.repo.saveContactFields(scope.companyId, draft)
                saved = result.data
                draft = result.data
                freshKeys = emptySet()
                scope.showMessage(
                    if (result.data.isEmpty()) savedBackToStandard else savedOnEveryCustomer,
                )
            } catch (cause: Exception) {
                scope.showMessage(cause.userMessage())
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = ContactFields.Copy.HEADING,
        description = ContactFields.Copy.INTRO,
    ) {
        if (!loaded) {
            Text(
                t("settings.contactFieldsLoading"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SettingsCard
        }

        if (draft.isEmpty()) {
            Text(
                t("settings.contactFieldsEmpty"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        draft.forEachIndexed { index, field ->
            val isNew = freshKeys.contains(index)
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    OutlinedTextField(
                        value = field.label,
                        onValueChange = { next ->
                            draft = draft.mapIndexed { i, row ->
                                if (i != index) {
                                    row
                                } else {
                                    // A NEW row's key follows its label; a SAVED
                                    // row's key is frozen. Values are stored
                                    // under the key, so re-deriving it on a
                                    // saved field would turn a typo fix into a
                                    // silent wipe on every contact.
                                    row.copy(
                                        label = next.take(80),
                                        key = if (isNew) {
                                            ContactFields.key(next).orEmpty()
                                        } else {
                                            row.key
                                        },
                                    )
                                }
                            }
                        },
                        label = { Text(t("settings.contactFieldsNameLabel")) },
                        placeholder = { Text(t("settings.contactFieldsNamePlaceholder")) },
                        enabled = canEdit,
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )

                    var kindOpen by remember { mutableStateOf(false) }
                    TextButton(
                        onClick = { kindOpen = true },
                        // A saved field's TYPE cannot change: the values under
                        // it were entered against the old one, and a text
                        // column reinterpreted as a date is a column of errors.
                        enabled = canEdit && isNew,
                    ) { Text(ContactFields.kindLabel(field.kind)) }
                    DropdownMenu(expanded = kindOpen, onDismissRequest = { kindOpen = false }) {
                        for (kind in ContactFields.KINDS) {
                            DropdownMenuItem(
                                text = { Text(ContactFields.kindLabel(kind)) },
                                onClick = {
                                    kindOpen = false
                                    draft = draft.mapIndexed { i, row ->
                                        if (i == index) {
                                            row.copy(
                                                kind = kind,
                                                options = if (kind == "select") {
                                                    row.options.orEmpty()
                                                } else {
                                                    null
                                                },
                                            )
                                        } else {
                                            row
                                        }
                                    }
                                },
                            )
                        }
                    }

                    if (canEdit) {
                        TextButton(onClick = {
                            draft = draft.filterIndexed { i, _ -> i != index }
                            freshKeys = freshKeys.filter { it != index }
                                .map { if (it > index) it - 1 else it }
                                .toSet()
                        }) { Text(t("settings.contactFieldsRemove")) }
                    }
                }

                // The choices editor, for the one type that has any.
                if (field.kind == "select") {
                    OutlinedTextField(
                        value = field.options.orEmpty().joinToString("\n"),
                        onValueChange = { text ->
                            val options = text.split("\n")
                                .map { it.trim() }
                                .filter { it.isNotEmpty() }
                                .take(ContactFields.OPTIONS_CAP)
                            draft = draft.mapIndexed { i, row ->
                                if (i == index) row.copy(options = options) else row
                            }
                        },
                        label = { Text(t("settings.contactFieldsChoices")) },
                        enabled = canEdit,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    )
                }

                if (field.key.isNotEmpty()) {
                    Text(
                        // The key matters because it is the column head in an
                        // export, and because a saved field's key is frozen.
                        if (isNew) {
                            t("settings.contactFieldsExportsAs", "key" to field.key)
                        } else {
                            t("settings.contactFieldsExportsAsFrozen", "key" to field.key)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }

        if (canEdit && draft.size < cap) {
            OutlinedButton(
                onClick = {
                    // Smart Defaults: a row arrives as Text with an empty name,
                    // which is the commonest field and one decision fewer.
                    draft = draft + ContactFieldDef(kind = "text")
                    freshKeys = freshKeys + (draft.size - 1)
                },
                modifier = Modifier.padding(top = 6.dp),
            ) { Text(t("settings.contactFieldsAdd")) }
        }

        if (draft.size >= cap) {
            Text(
                ContactFields.Copy.CAP_REACHED,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        // Said where fields are DEFINED, which is the only moment it lands.
        Text(
            ContactFields.Copy.PRIVACY,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )

        if (canEdit && draft != saved) {
            // What a removal actually does, said before it is committed.
            if (saved.any { field -> draft.none { it.key == field.key } }) {
                Text(
                    ContactFields.Copy.DELETE_WARNING,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Row(
                Modifier.padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Button(onClick = { commit() }, enabled = !saving) {
                    Text(t("settings.contactFieldsSave"))
                }
                TextButton(onClick = {
                    draft = saved
                    freshKeys = emptySet()
                }) { Text(t("settings.contactFieldsDiscard")) }
            }
        }
    }
}
