package com.loonext.android.features.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.loonext.android.core.contacts.ContactFields
import com.loonext.android.core.model.ContactFieldDef

/**
 * #291 — what this workspace needs to know about a customer.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent until the workspace defines something.** A crew that has not set
 *   up any fields sees nothing here rather than an empty heading on every
 *   contact forever. *Applying: Zen of Clarity.*
 * - **Every defined field shows, answered or not.** The unanswered ones are
 *   the point: an empty gate code on a job sheet is the prompt to ask. Hiding
 *   them until filled would make the feature invisible exactly when it helps.
 * - **A value commits when the field loses focus, like the rows above it.**
 *   These are one-line facts a crew corrects from a van; a Save button under
 *   ten inputs is a step between knowing something and recording it.
 * - **A refused value keeps what was typed.** The field holds the text and
 *   says why, rather than reverting and losing the correction just made.
 *
 * Mirrors the web and iOS lists; `ContactFieldsParityTest` keeps the rules and
 * the words the same.
 */
@Composable
fun CustomFields(
    defs: List<ContactFieldDef>,
    values: Map<String, String>,
    /** Called with the WHOLE set — the API stores what it is given. */
    onCommit: (Map<String, String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (defs.isEmpty()) return

    var drafts by remember(values) { mutableStateOf(values) }
    var errors by remember(defs) { mutableStateOf(mapOf<String, String>()) }

    fun commit(def: ContactFieldDef, next: String) {
        if (next == (values[def.key] ?: "")) return
        val reason = ContactFields.valueError(def.kind, def.options, def.label, next)
        if (reason != null) {
            errors = errors + (def.key to reason)
            return
        }
        errors = errors - def.key
        onCommit(drafts + (def.key to next))
    }

    Column(modifier.fillMaxWidth().padding(top = 6.dp)) {
        for (def in defs) {
            val value = drafts[def.key] ?: ""
            when (def.kind) {
                "checkbox" -> Row(
                    Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(def.label, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            // "Not asked" is a THIRD state, and a real one:
                            // it is not the same as an answered no.
                            when (value) {
                                "yes" -> "Yes"
                                "no" -> "No"
                                else -> CUSTOM_FIELD_UNANSWERED
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = value == "yes",
                        onCheckedChange = { on ->
                            val next = if (on) "yes" else "no"
                            drafts = drafts + (def.key to next)
                            commit(def, next)
                        },
                        modifier = Modifier.semantics { contentDescription = def.label },
                    )
                }

                "select" -> {
                    var open by remember { mutableStateOf(false) }
                    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text(
                            def.label,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { open = true }) {
                            Text(value.ifEmpty { CUSTOM_FIELD_UNSET })
                        }
                        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                            // Empty is an ANSWER and has to stay reachable:
                            // "we asked, there is no gate code" is a fact, and
                            // a dropdown of only real values traps the first
                            // mis-tap forever.
                            DropdownMenuItem(
                                text = { Text(CUSTOM_FIELD_UNSET) },
                                onClick = {
                                    open = false
                                    drafts = drafts + (def.key to "")
                                    commit(def, "")
                                },
                            )
                            for (choice in def.options.orEmpty()) {
                                DropdownMenuItem(
                                    text = { Text(choice) },
                                    onClick = {
                                        open = false
                                        drafts = drafts + (def.key to choice)
                                        commit(def, choice)
                                    },
                                )
                            }
                        }
                    }
                }

                else -> OutlinedTextField(
                    value = value,
                    onValueChange = { drafts = drafts + (def.key to it) },
                    label = { Text(def.label) },
                    isError = errors.containsKey(def.key),
                    supportingText = errors[def.key]?.let { { Text(it) } },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp)
                        // Losing focus IS the save, which is what the web does
                        // on blur. A Save button under ten inputs would be a
                        // step between knowing something and recording it —
                        // and a different gesture on this phone than on the
                        // laptop the same crew uses.
                        .onFocusChanged { state ->
                            if (!state.isFocused && !state.hasFocus) {
                                commit(def, drafts[def.key] ?: "")
                            }
                        },
                )
            }
        }
    }
}

/** The two words this surface owns, kept where the parity test can read them. */
const val CUSTOM_FIELD_UNANSWERED = "Not asked"
const val CUSTOM_FIELD_UNSET = "Not set"
