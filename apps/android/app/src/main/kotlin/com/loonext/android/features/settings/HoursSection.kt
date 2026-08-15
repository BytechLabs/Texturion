package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import com.loonext.android.features.compose.usSendApproved
import com.loonext.android.features.compose.usTextingOff
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.DayHours
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * One weekday row's editable state.
 *
 * `internal`, not private: #307 gives a single NUMBER its own week, and a
 * second copy of this would have drifted from the workspace's the first time
 * either was touched.
 */
internal data class DayForm(
    val weekday: String,
    val enabled: Boolean,
    val open: String,
    val close: String,
)

internal fun toFormState(hours: Map<String, DayHours?>): List<DayForm> =
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
    // #402: directly under the weekly schedule it overrides. These dates only
    // mean anything as an exception to it, and an owner looking for "we're
    // shut on Boxing Day" looks where they set their hours.
    ClosedDatesCard(scope, company, onCompanyUpdated)
    AwayReplyCard(scope, company, onCompanyUpdated)
    // #460: directly beneath the away message, which is the sentence that
    // TELLS a customer the word. An owner changing the word has to see the
    // offer in the same scroll.
    EmergencyCard(scope, company, onCompanyUpdated)
    // #237: last, and on this screen rather than a section of its own. Every
    // card above answers "what do we send automatically, and in whose words" —
    // the away reply, the closed dates, the emergency reply. A reminder is the
    // same question with a different trigger, and the settings list is already
    // long enough that a two-rule form does not earn another row.
    ReminderRulesCard(scope)
    // #244: with the reminder card and everything above it — every card on
    // this screen answers "what happens outside working hours". The away reply
    // is what the CUSTOMER gets; this is who on the crew is woken.
    OnCallCard(scope)
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
    // #228: the save failure is written from a coroutine, outside composition.
    val locale = LocalAppLocale.current

    val dirty = days != initial
    val allValid = days.all { !it.enabled || isValidDayWindow(it.open, it.close) }
    // Reported from the coroutine the Save press starts, so it is read here.
    val savedMessage = t("settings.hoursSaved")

    fun patchDay(weekday: String, transform: (DayForm) -> DayForm) {
        days = days.map { if (it.weekday == weekday) transform(it) else it }
    }

    SettingsCard(
        title = t("settings.hoursTitle"),
        description = t(
            "settings.hoursIntro",
            "timezone" to company.timezone.replace('_', ' '),
        ),
    ) {
        days.forEach { day ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WeekdayRow(
                    day = day,
                    enabled = canEdit && !saving,
                    onChange = { updated -> patchDay(day.weekday) { updated } },
                )
            }
        }
        if (!allValid) {
            ReadOnlyLine(t("settings.hoursInvalid"))
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
                                scope.showMessage(savedMessage)
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = allValid && !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) t("common.saving") else t("settings.hoursSaveAction")) }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.hoursReadOnly"))
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
    var emergency by remember(company.emergency_keyword_enabled) {
        mutableStateOf(company.emergency_keyword_enabled)
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // #228: the save failure is written from a coroutine, outside composition.
    val locale = LocalAppLocale.current
    val coroutines = rememberCoroutineScope()

    val trimmed = message.trim()
    val dirty = enabled != company.away_enabled ||
        trimmed != company.away_message.orEmpty().trim() ||
        emergency != company.emergency_keyword_enabled
    // What actually goes out — the owner's text if they wrote one, else the
    // product default. The preview and the #414 emergency check both read
    // THIS, so the screen can never approve of a message that isn't sending.
    // #414 ask 5: the SERVER says what will actually send.
    val effectiveMessage = trimmed.ifEmpty { company.away_effective_message }
    // The preview reuses the wire's drop-empty semantics: {first_name} resolves
    // to a sample name here because the away reply DOES carry the contact.
    val preview = applyMergeFields(
        text = effectiveMessage,
        contactName = SAMPLE_FIRST_NAME,
        businessName = company.name,
    )
    val emergencyNotice = awayEmergencyNotice(
        emergencyEnabled = emergency,
        awayMessage = effectiveMessage,
        locale = locale,
        // #460: THIS workspace's words, resolved by the server. Warning against
        // the product list when the owner watches for their own would be the
        // product arguing with a setting it offers.
        keywords = company.effectiveEmergencyWords,
    )

    SettingsCard(
        title = t("settings.awayTitle"),
        description = t("settings.awayIntro"),
    ) {
        LabeledSwitchRow(
            label = t("settings.awayEnable"),
            supporting = t("settings.awayEnableHelp"),
            checked = enabled,
            onCheckedChange = { enabled = it },
            enabled = canEdit && !saving,
        )
        // The send gates refuse a US destination until the campaign is
        // approved, and the away reply is best-effort: a refusal is swallowed
        // so it never breaks inbound ingest. A switch reading ON while every
        // US customer gets silence is the first week of every US workspace.
        if (enabled && !usSendApproved(company)) {
            ReachNote(
                if (usTextingOff(company)) {
                    t("settings.awayUsTextingOff")
                } else {
                    t("settings.awayUsPending")
                },
            )
        }
        if (canEdit) {
            OutlinedTextField(
                value = message,
                onValueChange = { if (it.length <= 1000) message = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                minLines = 3,
                enabled = !saving,
                placeholder = { Text(company.away_effective_message) },
                // `{first_name}` and `{business_name}` survive the catalogue's
                // interpolation untouched — an unknown token is left visible on
                // purpose — and they are NOT translated in either language: they
                // are the literal merge fields an owner types into the box.
                supportingText = {
                    Text(t("settings.awayCount", "count" to message.length.toString()))
                },
            )
        }
        // #414: the switch sits with the message that makes the offer, not on
        // a separate notifications screen. They are one decision — a message
        // inviting URGENT with the mechanism off is the exact defect this
        // issue is about, and an owner can only see it if both are together.
        LabeledSwitchRow(
            label = t("settings.awayEmergencySwitch"),
            // #460: names the words THIS workspace watches for. Hardcoding the
            // product's four was fine until an owner could change them, at
            // which point a switch naming words nothing matches is the #414
            // defect in a different place.
            supporting = t(
                "settings.awayEmergencySwitchHelp",
                "words" to emergencyWordList(company.effectiveEmergencyWords, locale),
            ),
            checked = emergency,
            onCheckedChange = { emergency = it },
            enabled = canEdit && !saving,
        )
        // #453: which sentence appears is decided in SettingsLogic, mirroring
        // shared, so this screen, web and iOS cannot drift into three wordings
        // of the same warning. Only the tone-to-colour mapping is ours.
        emergencyNotice?.let { notice ->
            ReachNote(
                notice.text,
                tone = when (notice.tone) {
                    AwayNoticeTone.Warn -> NoteTone.Warn
                    AwayNoticeTone.Hint -> NoteTone.Neutral
                },
            )
        }
        PreviewBubble(label = t("settings.awayPreviewLabel"), text = preview)
        InlineError(error)
        if (canEdit) {
            if (dirty) {
                val needsMessage = t("settings.awayNeedsMessage")
                val awaySaved = t("settings.awaySaved")
                Button(
                    onClick = {
                        if (enabled && trimmed.isEmpty()) {
                            error = needsMessage
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
                                    put("emergency_keyword_enabled", emergency)
                                }
                                val updated = scope.repo.updateCompany(scope.companyId, body)
                                onCompanyUpdated(updated)
                                scope.showMessage(awaySaved)
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) t("common.saving") else t("settings.awaySaveAction")) }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.awayReadOnly"))
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

/**
 * One weekday, shared by the workspace's hours and a single line's (#307).
 *
 * Stateless on purpose: the caller owns the list and decides what saving
 * means, because the workspace saves through the company route and a line
 * saves through its own. This only knows how to show a day.
 */
@Composable
internal fun RowScope.WeekdayRow(
    day: DayForm,
    enabled: Boolean,
    onChange: (DayForm) -> Unit,
) {
    Switch(
        checked = day.enabled,
        onCheckedChange = { onChange(day.copy(enabled = it)) },
        enabled = enabled,
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
            onValueChange = { onChange(day.copy(open = it)) },
            label = t("settings.hoursOpen"),
            enabled = enabled,
            modifier = Modifier.weight(1f),
        )
        Text(
            t("settings.hoursTo"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 6.dp),
        )
        TimeField(
            value = day.close,
            onValueChange = { onChange(day.copy(close = it)) },
            label = t("settings.hoursClose"),
            enabled = enabled,
            modifier = Modifier.weight(1f),
        )
    } else {
        Text(
            t("settings.hoursClosed"),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
