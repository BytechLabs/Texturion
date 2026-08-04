package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #307 — "How this line answers".
 *
 * Hand-port of `apps/web/src/components/settings/number-identity-dialog.tsx`.
 * A workspace running a service line and a sales line had one identity across
 * both, so somebody who bought a second number BECAUSE it is a different
 * business found the product quietly making it the same one.
 *
 * The three rules the web version establishes, kept identical here because
 * three clients describing one model three ways is the #437 failure:
 *
 * - **Every box starts at what a caller ACTUALLY gets**, never blank. An empty
 *   field cannot tell an owner what the line does today, and showing that
 *   before it changes is this screen's whole job.
 * - **Inherited is stated per field.** Without it, somebody editing a box
 *   cannot tell whether they are fixing a sales greeting or rewriting the one
 *   every customer already knows.
 * - **The way back is worded as its outcome** — "Use the workspace's", not
 *   "Clear". Clear implies empty, and empty is the one thing this cannot mean:
 *   a cleared greeting restores the workspace's rather than silencing the line.
 */
@Composable
internal fun NumberIdentityDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    var loaded by remember { mutableStateOf<LoadState<NumberIdentity>>(LoadState.Loading) }
    var label by remember { mutableStateOf("") }
    var greeting by remember { mutableStateOf("") }
    var away by remember { mutableStateOf("") }
    var mctbMessage by remember { mutableStateOf("") }
    var mctbEnabled by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    // #309: only to put NAMES on the id the identity already carries. An empty
    // list is every workspace until somebody records something, and it hides
    // the picker entirely.
    var greetings by remember { mutableStateOf(emptyList<VoicemailGreeting>()) }
    var greetingMenuOpen by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    fun seed(identity: NumberIdentity) {
        label = identity.label.value.orEmpty()
        greeting = identity.voicemail_greeting.value.orEmpty()
        away = identity.away_message.value.orEmpty()
        mctbMessage = identity.mctb_message.value.orEmpty()
        // Starts at what a missed caller gets TODAY, never off — an owner who
        // flipped a wrongly-off switch ON would change nothing visible and
        // silently stop this line following the workspace from then on.
        mctbEnabled = identity.mctb_enabled.value
    }

    LaunchedEffect(scope.companyId) {
        greetings = try {
            scope.repo.voicemailGreetings(scope.companyId)
        } catch (_: Exception) {
            // A greeting list that will not load hides the picker rather than
            // failing the dialog: the other five fields are still editable, and
            // this one has a safe default already in force.
            emptyList()
        }
    }

    LaunchedEffect(number.id) {
        loaded = LoadState.Loading
        loaded = try {
            val identity = scope.repo.numberIdentity(scope.companyId, number.id)
            seed(identity)
            LoadState.Ready(identity)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    /** #309: choose a recording, or null for the written words. */
    fun selectGreeting(id: String?) {
        coroutines.launch {
            pending = true
            error = null
            try {
                val next = scope.repo.setNumberIdentity(
                    scope.companyId,
                    number.id,
                    buildJsonObject {
                        if (id == null) {
                            put("voicemail_greeting_id", JsonNull)
                        } else {
                            put("voicemail_greeting_id", id)
                        }
                    },
                )
                seed(next)
                loaded = LoadState.Ready(next)
                onChanged()
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                pending = false
            }
        }
    }

    /** Send JsonNull for one field: that is what "use the workspace's" means. */
    fun clear(field: String) {
        coroutines.launch {
            pending = true
            error = null
            try {
                val next = scope.repo.setNumberIdentity(
                    scope.companyId,
                    number.id,
                    buildJsonObject { put(field, JsonNull) },
                )
                seed(next)
                loaded = LoadState.Ready(next)
                onChanged()
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                pending = false
            }
        }
    }

    /**
     * Only what CHANGED.
     *
     * A field left alone must not be sent: posting the resolved value back
     * would turn an inherited field into an override just by opening this, and
     * the line would stop following the workspace with nothing looking wrong
     * until somebody edited the workspace greeting and one line ignored it.
     */
    fun patchBody(current: NumberIdentity): JsonObject = buildJsonObject {
        if (label != current.label.value.orEmpty()) put("label", label)
        if (greeting != current.voicemail_greeting.value.orEmpty()) {
            put("voicemail_greeting", greeting)
        }
        if (away != current.away_message.value.orEmpty()) put("away_message", away)
        if (mctbMessage != current.mctb_message.value.orEmpty()) {
            put("mctb_message", mctbMessage)
        }
        // The switch, by the same rule: flipping it to the value it already
        // shows is not a change, and sending it anyway would turn an inherited
        // toggle into an override just by opening this.
        if (mctbEnabled != current.mctb_enabled.value) put("mctb_enabled", mctbEnabled)
    }

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("How this line answers") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    "Anything you leave alone follows your workspace. Change one " +
                        "here and it only affects this number.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when (val state = loaded) {
                    is LoadState.Loading -> Text(
                        "Loading…",
                        modifier = Modifier.padding(top = 12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )

                    is LoadState.Failed -> Text(
                        state.message,
                        modifier = Modifier.padding(top = 12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )

                    is LoadState.Ready -> {
                        if (greetings.isNotEmpty()) {
                            val selectedId = state.value.voicemail_greeting_id.value
                            val selectedName = greetings
                                .firstOrNull { it.id == selectedId }?.name
                                ?: WRITTEN_GREETING_LABEL
                            Row(
                                Modifier.fillMaxWidth().padding(top = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Voicemail voice",
                                    style = MaterialTheme.typography.labelLarge,
                                )
                                Spacer(Modifier.weight(1f))
                                if (state.value.voicemail_greeting_id.inherited) {
                                    Text(
                                        "Same as your workspace",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                } else {
                                    TextButton(
                                        enabled = !pending,
                                        onClick = { clear("voicemail_greeting_id") },
                                    ) {
                                        Text(
                                            "Use the workspace's",
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                    }
                                }
                            }
                            TextButton(
                                enabled = !pending,
                                onClick = { greetingMenuOpen = true },
                            ) { Text(selectedName) }
                            DropdownMenu(
                                expanded = greetingMenuOpen,
                                onDismissRequest = { greetingMenuOpen = false },
                            ) {
                                // The written words FIRST: the only option
                                // guaranteed to exist, what every line does
                                // until somebody chooses otherwise, and what
                                // the runtime falls back to anyway.
                                DropdownMenuItem(
                                    text = { Text(WRITTEN_GREETING_LABEL) },
                                    onClick = {
                                        greetingMenuOpen = false
                                        selectGreeting(null)
                                    },
                                )
                                greetings.forEach { row ->
                                    DropdownMenuItem(
                                        text = { Text(row.name) },
                                        onClick = {
                                            greetingMenuOpen = false
                                            selectGreeting(row.id)
                                        },
                                    )
                                }
                            }
                            Text(
                                "A recording that will not play falls back to the " +
                                    "words below, so a caller never hears silence.",
                                modifier = Modifier.padding(top = 4.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IdentityField(
                            title = "Name for this line",
                            hint = "Used in the greeting, on missed-call texts, and " +
                                "wherever this line introduces itself.",
                            value = label,
                            inherited = state.value.label.inherited,
                            enabled = !pending,
                            singleLine = true,
                            onValueChange = { label = it },
                            onUseWorkspace = { clear("label") },
                        )
                        IdentityField(
                            title = "Voicemail greeting",
                            hint = "What a caller hears when nobody picks up.",
                            value = greeting,
                            inherited = state.value.voicemail_greeting.inherited,
                            enabled = !pending,
                            singleLine = false,
                            onValueChange = { greeting = it },
                            onUseWorkspace = { clear("voicemail_greeting") },
                        )
                        IdentityField(
                            title = "After-hours reply",
                            hint = "The text sent when somebody messages this line " +
                                "outside your hours.",
                            value = away,
                            inherited = state.value.away_message.inherited,
                            enabled = !pending,
                            singleLine = false,
                            onValueChange = { away = it },
                            onUseWorkspace = { clear("away_message") },
                        )
                        IdentityToggle(
                            title = "Text back a missed caller",
                            hint = "Sent from this line when a call goes unanswered.",
                            checked = mctbEnabled,
                            inherited = state.value.mctb_enabled.inherited,
                            enabled = !pending,
                            onCheckedChange = { mctbEnabled = it },
                            onUseWorkspace = { clear("mctb_enabled") },
                        )
                        IdentityField(
                            title = "Missed-call text",
                            hint = "What a caller gets when nobody picks up and " +
                                "they hang up.",
                            value = mctbMessage,
                            inherited = state.value.mctb_message.inherited,
                            enabled = !pending,
                            singleLine = false,
                            onValueChange = { mctbMessage = it },
                            onUseWorkspace = { clear("mctb_message") },
                        )
                    }
                }
                error?.let {
                    Text(
                        it,
                        modifier = Modifier.padding(top = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !pending && loaded is LoadState.Ready,
                onClick = {
                    val current = (loaded as? LoadState.Ready)?.value ?: return@TextButton
                    coroutines.launch {
                        pending = true
                        error = null
                        try {
                            scope.repo.setNumberIdentity(
                                scope.companyId,
                                number.id,
                                patchBody(current),
                            )
                            onChanged()
                            onDismiss()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            pending = false
                        }
                    }
                },
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(enabled = !pending, onClick = onDismiss) { Text("Cancel") }
        },
    )
}

/** One field, saying whether it is this line's own or the workspace's. */
@Composable
private fun IdentityField(
    title: String,
    hint: String,
    value: String,
    inherited: Boolean,
    enabled: Boolean,
    singleLine: Boolean,
    onValueChange: (String) -> Unit,
    onUseWorkspace: () -> Unit,
) {
    Column(Modifier.padding(top = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.weight(1f))
            if (inherited) {
                Text(
                    "Same as your workspace",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                TextButton(enabled = enabled, onClick = onUseWorkspace) {
                    Text("Use the workspace's", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
            singleLine = singleLine,
        )
        Text(
            hint,
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The one control here that is not a box.
 *
 * A switch is two-state and the setting is three — on, off, and follow the
 * workspace. Rather than invent a third position nobody would recognise, the
 * third state is carried by the same per-field affordance every other row
 * already uses. One model across the dialog beats a second one learned for a
 * single line.
 */
@Composable
private fun IdentityToggle(
    title: String,
    hint: String,
    checked: Boolean,
    inherited: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onUseWorkspace: () -> Unit,
) {
    Column(Modifier.padding(top = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.weight(1f))
            if (inherited) {
                Text(
                    "Same as your workspace",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                TextButton(enabled = enabled, onClick = onUseWorkspace) {
                    Text("Use the workspace's", style = MaterialTheme.typography.bodySmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
        }
        Text(
            hint,
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * What a line plays when no recording is chosen.
 *
 * Worded as the outcome rather than as "None": a caller still hears a greeting,
 * spoken aloud from the written words, and "None" would suggest silence.
 */
private const val WRITTEN_GREETING_LABEL = "The written greeting, read aloud"
