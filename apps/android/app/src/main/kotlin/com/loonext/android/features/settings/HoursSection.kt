package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.DayHours
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** The default owner-authored away text shown as the placeholder (web parity). */
private const val DEFAULT_AWAY_MESSAGE =
    "Thanks for texting us. We're out of the office right now and will reply first thing. " +
        "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."

/** One weekday row's editable state. */
private data class DayForm(val weekday: String, val enabled: Boolean, val open: String, val close: String)

private fun toFormState(hours: Map<String, DayHours?>): List<DayForm> =
    WEEKDAY_KEYS.map { key ->
        val window = hours[key]
        DayForm(
            weekday = key,
            enabled = window != null,
            open = window?.open ?: "09:00",
            close = window?.close ?: "17:00",
        )
    }

/**
 * Business hours & away reply (#157): the per-weekday open/close grid with
 * enable switches, and the after-hours auto-reply with merge fields and a live
 * preview that matches the wire byte-for-byte.
 */
@Composable
fun HoursSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    BusinessHoursCard(scope, company, onCompanyUpdated)
    AwayReplyCard(scope, company, onCompanyUpdated)
}

@Composable
private fun BusinessHoursCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val initial = remember(company.business_hours) { toFormState(company.business_hours) }
    var days by remember(initial) { mutableStateOf(initial) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val dirty = days != initial
    val allValid = days.all { !it.enabled || isValidDayWindow(it.open, it.close) }

    fun patchDay(weekday: String, transform: (DayForm) -> DayForm) {
        days = days.map { if (it.weekday == weekday) transform(it) else it }
    }

    SettingsCard(
        title = "Business hours",
        description = "When you're open, in ${company.timezone.replace('_', ' ')}. " +
            "Texts that arrive outside these hours can get your away reply. This is " +
            "separate from each customer's texting quiet hours.",
    ) {
        days.forEach { day ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Switch(
                    checked = day.enabled,
                    onCheckedChange = { enabled ->
                        patchDay(day.weekday) { it.copy(enabled = enabled) }
                    },
                    enabled = canEdit && !saving,
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    WEEKDAY_LABELS[day.weekday] ?: day.weekday,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.width(86.dp),
                )
                if (day.enabled) {
                    TimeField(
                        value = day.open,
                        onValueChange = { patchDay(day.weekday) { d -> d.copy(open = it) } },
                        label = "Open",
                        enabled = canEdit && !saving,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "to",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 6.dp),
                    )
                    TimeField(
                        value = day.close,
                        onValueChange = { patchDay(day.weekday) { d -> d.copy(close = it) } },
                        label = "Close",
                        enabled = canEdit && !saving,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Text(
                        "Closed",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (!allValid) {
            ReadOnlyLine("Times are 24-hour HH:MM, and open and close can't match.")
        }
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
                                    putJsonObject("business_hours") {
                                        days.forEach { day ->
                                            if (day.enabled) {
                                                putJsonObject(day.weekday) {
                                                    put("open", day.open)
                                                    put("close", day.close)
                                                }
                                            }
                                        }
                                    }
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage("Business hours saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = allValid && !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save hours") }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change business hours.")
        }
    }
}

@Composable
private fun TimeField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { next -> if (next.length <= 5) onValueChange(next) },
        modifier = modifier,
        singleLine = true,
        enabled = enabled,
        isError = !isValidHhmm(value),
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        placeholder = { Text("09:00") },
        textStyle = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun AwayReplyCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var enabled by remember(company.away_enabled) { mutableStateOf(company.away_enabled) }
    var message by remember(company.away_message) {
        mutableStateOf(company.away_message.orEmpty())
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val trimmed = message.trim()
    val dirty = enabled != company.away_enabled ||
        trimmed != company.away_message.orEmpty().trim()
    // The preview reuses the wire's drop-empty semantics: {first_name} resolves
    // to a sample name here because the away reply DOES carry the contact.
    val preview = applyMergeFields(
        text = trimmed.ifEmpty { DEFAULT_AWAY_MESSAGE },
        contactName = SAMPLE_FIRST_NAME,
        businessName = company.name,
    )

    SettingsCard(
        title = "Away reply",
        description = "One automatic text back when someone reaches you outside your " +
            "business hours, in your words, so you never lose an after-hours emergency.",
    ) {
        LabeledSwitchRow(
            label = "Reply automatically after hours",
            supporting = "Fires once per conversation when a customer first texts " +
                "outside your hours.",
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
                placeholder = { Text(DEFAULT_AWAY_MESSAGE) },
                supportingText = { Text("${message.length}/1000 · {first_name} and {business_name} fill in automatically.") },
            )
        }
        PreviewBubble(label = "Preview", text = preview)
        InlineError(error)
        if (canEdit) {
            if (dirty) {
                Button(
                    onClick = {
                        if (enabled && trimmed.isEmpty()) {
                            error = "Write your away message before turning it on."
                            return@Button
                        }
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                val body = buildJsonObject {
                                    put("away_enabled", enabled)
                                    if (trimmed.isEmpty()) put("away_message", JsonNull)
                                    else put("away_message", trimmed)
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage("Away reply saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save away reply") }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change the away reply.")
        }
    }
}

/** A quiet message-bubble preview: exactly what the customer receives. */
@Composable
fun PreviewBubble(label: String, text: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(top = 10.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    MaterialTheme.colorScheme.surfaceContainerHigh,
                    RoundedCornerShape(12.dp),
                )
                .padding(12.dp),
        )
    }
}
