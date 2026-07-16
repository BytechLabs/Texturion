package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale

/** The default missed-call text-back shown as the placeholder (web parity). */
private const val DEFAULT_MCTB_MESSAGE =
    "Sorry we missed your call! This is {business_name}. Reply here with your address " +
        "and what you need, and we'll get you booked in."

/** Call-screening values PATCH /v1/company accepts. */
private object CallScreening {
    const val OFF = "off"
    const val FLAG = "flag"
    const val DIVERT = "divert"
}

/** All live numbers are text-enabled landlines — in-app calling won't apply. */
private fun onlyHostedNumbers(company: CompanyView): Boolean {
    val live = company.numbers.filter { it.status != NumberStatus.RELEASED }
    return live.isNotEmpty() && live.all { it.source == "hosted" }
}

/**
 * Calling (#157): missed-call text-back, voicemail greeting, carrier call
 * screening, and caller ID — the D36..D43 voice surface, role-gated to O/A.
 */
@Composable
fun CallingSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    if (onlyHostedNumbers(company)) {
        Text(
            "In-app calling needs a number whose calls come through Loonext. Calls to " +
                "your text-enabled landline stay with your existing carrier, so these " +
                "settings won't apply until you add or transfer a Loonext number.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
        )
    }
    TextBackCard(scope, company, onCompanyUpdated)
    VoicemailCard(scope, company, onCompanyUpdated)
    ScreeningCard(scope, company, onCompanyUpdated)
    CallerIdCard(scope, company, onCompanyUpdated)
    MinutesFooter(scope)
}

@Composable
private fun TextBackCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var enabled by remember(company.mctb_enabled) { mutableStateOf(company.mctb_enabled) }
    var message by remember(company.mctb_message) {
        mutableStateOf(company.mctb_message.orEmpty())
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val trimmed = message.trim()
    val dirty = enabled != company.mctb_enabled ||
        trimmed != company.mctb_message.orEmpty().trim()
    // The server sends this with NO contact name (a missed call is usually a
    // brand-new caller) — the preview drops {first_name} exactly as the wire does.
    val preview = applyMergeFields(
        text = trimmed.ifEmpty { DEFAULT_MCTB_MESSAGE },
        contactName = null,
        businessName = company.name,
    )

    SettingsCard(
        title = "Text back a missed call",
        description = "When a call to your business number goes unanswered, we send the " +
            "caller one text so they can book by reply, instead of calling the next " +
            "number on their list.",
    ) {
        LabeledSwitchRow(
            label = "Text back missed calls",
            supporting = "Fires once per caller when a call goes unanswered.",
            checked = enabled,
            onCheckedChange = { enabled = it },
            enabled = canEdit && !saving,
        )
        if (canEdit) {
            OutlinedTextField(
                value = message,
                onValueChange = { if (it.length <= 1000) message = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                minLines = 3,
                enabled = !saving,
                placeholder = { Text(DEFAULT_MCTB_MESSAGE) },
                supportingText = {
                    Text("${message.length}/1000 · {business_name} fills in automatically.")
                },
            )
        }
        PreviewBubble(label = "What the caller receives", text = preview)
        InlineError(error)
        if (canEdit) {
            if (dirty) {
                Button(
                    onClick = {
                        if (enabled && trimmed.isEmpty()) {
                            error = "Write your text-back message before turning it on."
                            return@Button
                        }
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                val body = buildJsonObject {
                                    put("mctb_enabled", enabled)
                                    if (trimmed.isEmpty()) put("mctb_message", JsonNull)
                                    else put("mctb_message", trimmed)
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage("Missed-call text-back saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save text-back") }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change the missed-call text-back.")
        }
    }
}

@Composable
private fun VoicemailCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var greeting by remember(company.voicemail_greeting) {
        mutableStateOf(company.voicemail_greeting.orEmpty())
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val trimmed = greeting.trim()
    val dirty = trimmed != company.voicemail_greeting.orEmpty().trim()
    val spoken = trimmed.ifEmpty { defaultVoicemailGreeting(company.name) }

    SettingsCard(
        title = "Voicemail greeting",
        description = "When nobody answers in the app, the caller hears this greeting " +
            "and can leave a message up to two minutes. Voicemails land in the call " +
            "log and the caller's conversation, ready to play.",
    ) {
        if (canEdit) {
            OutlinedTextField(
                value = greeting,
                onValueChange = { if (it.length <= 500) greeting = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                enabled = !saving,
                placeholder = { Text(defaultVoicemailGreeting(company.name)) },
                supportingText = {
                    Text(
                        "${greeting.length}/500 · Spoken aloud to the caller. " +
                            "Leave it empty to use the default.",
                    )
                },
            )
        }
        PreviewBubble(label = "What callers hear", text = spoken)
        InlineError(error)
        if (canEdit) {
            if (dirty) {
                Button(
                    onClick = {
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                val body = buildJsonObject {
                                    if (trimmed.isEmpty()) put("voicemail_greeting", JsonNull)
                                    else put("voicemail_greeting", trimmed)
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage("Voicemail greeting saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save greeting") }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change the voicemail greeting.")
        }
    }
}

private data class ScreeningChoice(val value: String, val label: String, val detail: String)

private val SCREENING_CHOICES = listOf(
    ScreeningChoice(
        CallScreening.OFF,
        "Off",
        "Every call rings the team, no carrier verdict shown.",
    ),
    ScreeningChoice(
        CallScreening.FLAG,
        "Label suspicious calls",
        "The carrier's verdict shows on the call — “Spam likely” — but every " +
            "call still rings the team.",
    ),
    ScreeningChoice(
        CallScreening.DIVERT,
        "Send suspicious calls to voicemail",
        "Flagged callers skip the ring and go straight to voicemail. A real customer " +
            "who gets misflagged can still leave a message.",
    ),
)

@Composable
private fun ScreeningCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "Call screening",
        description = "What happens when the carrier thinks an incoming call is spam.",
    ) {
        SCREENING_CHOICES.forEach { choice ->
            val selected = company.call_screening == choice.value
            Row(
                Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = selected,
                        enabled = canEdit && !saving,
                        onClick = {
                            if (selected) return@selectable
                            error = null
                            saving = true
                            coroutines.launch {
                                try {
                                    val updated = scope.repo.updateCompany(
                                        scope.companyId,
                                        buildJsonObject {
                                            put("call_screening", choice.value)
                                        },
                                    )
                                    onCompanyUpdated(updated)
                                    scope.showMessage("Call screening updated.")
                                } catch (cause: Exception) {
                                    error = cause.userMessage()
                                } finally {
                                    saving = false
                                }
                            }
                        },
                    )
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(
                    selected = selected,
                    onClick = null,
                    enabled = canEdit && !saving,
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(choice.label, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        choice.detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change call screening.")
        }
    }
}

@Composable
private fun CallerIdCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var display by remember(company.cnam_display_name) {
        mutableStateOf(company.cnam_display_name.orEmpty())
    }
    var lookup by remember(company.caller_id_lookup) {
        mutableStateOf(company.caller_id_lookup)
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val trimmed = display.trim()
    val dirty = trimmed != company.cnam_display_name.orEmpty().trim() ||
        lookup != company.caller_id_lookup
    val cnamInvalid = trimmed.isNotEmpty() && !isValidCnam(trimmed)

    SettingsCard(
        title = "Caller ID",
        description = "What people see when you call them, and what you see when " +
            "they call you.",
    ) {
        if (canEdit) {
            OutlinedTextField(
                value = display,
                onValueChange = { if (it.length <= 15) display = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = !saving,
                isError = cnamInvalid,
                label = { Text("Your outbound display name") },
                placeholder = {
                    Text(company.name.filter { it.isLetterOrDigit() || it == ' ' }.take(15))
                },
                supportingText = {
                    Text(
                        if (cnamInvalid) "1 to 15 letters, digits, or spaces."
                        else "Shown on US caller ID when you call customers — letters, " +
                            "digits, and spaces, 15 characters max. Carriers take 1–3 " +
                            "days to pick up a change, and Canadian display names are set " +
                            "by the receiving carrier, so this mainly helps your US calls.",
                    )
                },
            )
        } else {
            Text(
                trimmed.ifEmpty { "No display name set." },
                style = MaterialTheme.typography.bodyLarge,
            )
        }
        LabeledSwitchRow(
            label = "Look up who's calling",
            supporting = "Shows the caller's network-registered name on incoming calls " +
                "when they aren't in your contacts yet.",
            checked = lookup,
            onCheckedChange = { lookup = it },
            enabled = canEdit && !saving,
        )
        InlineError(error)
        if (canEdit) {
            if (dirty) {
                Button(
                    onClick = {
                        if (cnamInvalid) {
                            error = "The display name must be 1 to 15 letters, digits, or spaces."
                            return@Button
                        }
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                val body = buildJsonObject {
                                    if (trimmed.isEmpty()) put("cnam_display_name", JsonNull)
                                    else put("cnam_display_name", trimmed)
                                    put("caller_id_lookup", lookup)
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage("Caller ID saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save caller ID") }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change caller ID settings.")
        }
    }
}

/** The quiet fair-use line — live figures from GET /v1/usage, hidden if it fails. */
@Composable
private fun MinutesFooter(scope: SettingsScope) {
    var usage by remember(scope.companyId) { mutableStateOf<Usage?>(null) }
    LaunchedEffect(scope.companyId) {
        usage = try {
            scope.repo.usage(scope.companyId)
        } catch (_: Exception) {
            null
        }
    }
    val voice = usage?.voice ?: return
    if (voice.included_minutes <= 0) return
    Text(
        "Your plan includes ${String.format(Locale.US, "%,d", voice.included_minutes)} " +
            "calling minutes a month, both directions." +
            (if (voice.overage_billed) {
                " Past that, extra minutes bill at 1¢ each up to your spending cap."
            } else {
                ""
            }) + " Details live in Settings › Usage.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
}
