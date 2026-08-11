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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import kotlinx.serialization.json.JsonObject
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
import com.loonext.android.features.compose.usSendApproved
import com.loonext.android.features.compose.usTextingOff
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
            t("settings.callingHostedOnly"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
        )
    }
    TextBackCard(scope, company, onCompanyUpdated)
    VoicemailCard(scope, company, onCompanyUpdated)
    // #309: directly under the written greeting, because it answers the
    // same question in a better way. The written one stays as the
    // zero-setup default and the runtime fallback.
    VoiceGreetingCard(scope, canEdit = SettingsRoleGate.canEditWorkspace(scope.role))
    // #278: how they ring first, then the exception — "this is how a call
    // reaches you… except after hours" reads in that order.
    RingCard(scope, company, onCompanyUpdated)
    // #278: after the voicemail cards, before screening — it is a routing
    // decision about the SAME calls those describe, so it reads as a qualifier
    // on them rather than a new subject.
    AfterHoursCard(scope, company, onCompanyUpdated)
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
    var error by remember { mutableStateOf<String?>(null) }
    // #192 autosave: null = idle, false = saving, true = saved.
    var savedState by remember { mutableStateOf<Boolean?>(null) }
    var lastSavedMessage by remember(company.mctb_message) {
        mutableStateOf(company.mctb_message.orEmpty().trim())
    }
    var saveJob by remember { mutableStateOf<Job?>(null) }
    val coroutines = rememberCoroutineScope()

    val trimmed = message.trim()
    // The server sends this with NO contact name (a missed call is usually a
    // brand-new caller) — the preview drops {first_name} exactly as the wire does.
    val preview = applyMergeFields(
        text = trimmed.ifEmpty { DEFAULT_MCTB_MESSAGE },
        contactName = null,
        businessName = company.name,
    )

    fun patchMessage(value: String) {
        saveJob?.cancel()
        saveJob = coroutines.launch {
            delay(800)
            if (value == lastSavedMessage) return@launch
            savedState = false
            try {
                val body = buildJsonObject {
                    if (value.isEmpty()) put("mctb_message", JsonNull)
                    else put("mctb_message", value)
                }
                val updated = scope.repo.updateCompany(scope.companyId, body)
                lastSavedMessage = value
                error = null
                savedState = true
                onCompanyUpdated(updated)
            } catch (cause: Exception) {
                savedState = null
                error = cause.userMessage()
            }
        }
    }

    SettingsCard(
        title = t("settings.textBackTitle"),
        description = t("settings.textBackIntro"),
    ) {
        LabeledSwitchRow(
            label = t("settings.textBackSwitch"),
            supporting = t("settings.textBackSwitchHelp"),
            checked = enabled,
            onCheckedChange = { next ->
                // The toggle alone decides WHETHER the text-back fires; a
                // blank message means the default ships. Flip is optimistic,
                // reverted with the cause if the PATCH fails.
                enabled = next
                error = null
                coroutines.launch {
                    try {
                        val body = buildJsonObject { put("mctb_enabled", next) }
                        onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
                    } catch (cause: Exception) {
                        enabled = !next
                        error = cause.userMessage()
                    }
                }
            },
            enabled = canEdit,
        )
        // The send gates refuse a US destination until the campaign is
        // approved, and the text-back is skipped without a trace when they do.
        // A caller who is never texted back is the whole point of the feature.
        if (enabled && !usSendApproved(company)) {
            ReachNote(
                if (usTextingOff(company)) {
                    t("settings.textBackUsTextingOff")
                } else {
                    t("settings.textBackUsPending")
                },
            )
        }
        if (enabled) {
            if (canEdit) {
                OutlinedTextField(
                    value = message,
                    onValueChange = {
                        if (it.length <= 1000) {
                            message = it
                            savedState = null
                            patchMessage(it.trim())
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    minLines = 3,
                    placeholder = { Text(DEFAULT_MCTB_MESSAGE) },
                    supportingText = {
                        // `{business_name}` is a merge field the owner types, not
                        // a catalogue token: it survives interpolation untouched
                        // and reads the same in both languages.
                        val status = when (savedState) {
                            false -> t("settings.textBackStatusSaving")
                            true -> t("settings.textBackStatusSaved")
                            null -> ""
                        }
                        Text(t("settings.textBackHint") + status)
                    },
                )
            }
            PreviewBubble(label = t("settings.textBackPreviewLabel"), text = preview)
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.textBackReadOnly"))
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

    val greetingSaved = t("settings.voicemailSaved")

    SettingsCard(
        title = t("settings.voicemailTitle"),
        description = t("settings.voicemailIntro"),
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
                    Text(t("settings.voicemailCount", "count" to greeting.length.toString()))
                },
            )
        }
        PreviewBubble(label = t("settings.voicemailPreviewLabel"), text = spoken)
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
                                scope.showMessage(greetingSaved)
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) t("common.saving") else t("settings.voicemailSaveAction")) }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.voicemailReadOnly"))
        }
    }
}

/**
 * #228: the choice carries KEYS, not sentences.
 *
 * This list is a top-level `val`, so it is built once at class-init — long
 * before any composition and with no reader's locale anywhere near it. Holding
 * English here and translating at the radio row is the only shape that can say
 * the right thing to both readers; the alternative is a list rebuilt per
 * recomposition, which is worse for a reason that has nothing to do with words.
 */
private data class ScreeningChoice(
    val value: String,
    val labelKey: String,
    /** Null for the option whose label is the whole explanation. */
    val detailKey: String?,
)

private val SCREENING_CHOICES = listOf(
    ScreeningChoice(CallScreening.OFF, "settings.screeningOff", null),
    ScreeningChoice(
        CallScreening.FLAG,
        "settings.screeningFlag",
        "settings.screeningFlagDetail",
    ),
    ScreeningChoice(
        CallScreening.DIVERT,
        "settings.screeningDivert",
        "settings.screeningDivertDetail",
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

    val screeningUpdated = t("settings.screeningUpdated")

    SettingsCard(
        title = t("settings.screeningTitle"),
        description = t("settings.screeningIntro"),
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
                                    scope.showMessage(screeningUpdated)
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
                    Text(t(choice.labelKey), style = MaterialTheme.typography.bodyLarge)
                    if (choice.detailKey != null) {
                        Text(
                            t(choice.detailKey),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.screeningReadOnly"))
        }
    }
}

/**
 * #278 — how the phones ring, and for how long.
 *
 * Hand-port of `apps/web/src/components/settings/ring-card.tsx`, keeping the
 * two readings that make the controls legible together:
 *
 * - **Seconds are shown as rings.** Nobody has an intuition for "30 seconds of
 *   ringing"; everybody has one for "about five rings".
 * - **A short window with "one at a time" says who never rings.** That pairing
 *   is a rota which silently excludes half a crew, and nothing else on the
 *   screen would ever say so.
 */
@Composable
private fun RingCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var secondsMenuOpen by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()

    fun save(patch: JsonObject, message: String) {
        error = null
        saving = true
        coroutines.launch {
            try {
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, patch))
                scope.showMessage(message)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    val ringingUpdated = t("settings.ringUpdated")
    val ringLengthUpdated = t("settings.ringLengthUpdated")

    SettingsCard(
        title = t("settings.ringTitle"),
        description = t("settings.ringIntro"),
    ) {
        RING_CHOICES.forEach { choice ->
            val selected = company.ring_strategy == choice.value
            Row(
                Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = selected,
                        enabled = canEdit && !saving,
                        onClick = {
                            if (selected) return@selectable
                            save(
                                buildJsonObject { put("ring_strategy", choice.value) },
                                ringingUpdated,
                            )
                        },
                    )
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = selected, onClick = null, enabled = canEdit && !saving)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(t(choice.labelKey), style = MaterialTheme.typography.bodyLarge)
                    Text(
                        t(choice.detailKey),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(t("settings.ringHowLong"), style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.weight(1f))
            TextButton(
                enabled = canEdit && !saving,
                onClick = { secondsMenuOpen = true },
            ) { Text(ringSecondsLabel(company.ring_seconds)) }
            DropdownMenu(
                expanded = secondsMenuOpen,
                onDismissRequest = { secondsMenuOpen = false },
            ) {
                // The stored value always appears, even when it is not one of
                // the four — a picker that silently rounds somebody's setting
                // is a picker lying about what their line does.
                val options = (RING_SECOND_CHOICES + company.ring_seconds)
                    .distinct()
                    .sorted()
                options.forEach { value ->
                    DropdownMenuItem(
                        text = { Text(ringSecondsLabel(value)) },
                        onClick = {
                            secondsMenuOpen = false
                            save(
                                buildJsonObject { put("ring_seconds", value) },
                                ringLengthUpdated,
                            )
                        },
                    )
                }
            }
        }
        Text(
            if (company.ring_strategy == "in_turn") {
                val reached = phonesReached(company.ring_seconds)
                // One whole sentence per count: French agrees the verb with the
                // number, so "phone gets"/"phones get" cannot be a swappable tail.
                if (reached == 1) {
                    t(
                        "settings.ringInTurnNoteOne",
                        "seconds" to company.ring_seconds.toString(),
                    )
                } else {
                    t(
                        "settings.ringInTurnNote",
                        "seconds" to company.ring_seconds.toString(),
                        "phones" to reached.toString(),
                    )
                }
            } else {
                t("settings.ringAllNote")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.ringReadOnly"))
        }
    }
}

/** NANP ringing is roughly a six-second cadence. A reading, not a unit. */
internal fun ringsIn(seconds: Int): Int = maxOf(1, Math.round(seconds / 6f))

/** How long before the next phone joins, under "one at a time" — mirrors
 *  RING_STEP_SECS, where the machine reads it. */
private const val RING_STEP_SECS = 12

/** How many phones actually get a turn inside a window of this length. */
internal fun phonesReached(seconds: Int): Int =
    maxOf(1, (seconds - 1) / RING_STEP_SECS + 1)

@Composable
private fun ringSecondsLabel(seconds: Int): String = t(
    "settings.ringSecondsLabel",
    "seconds" to seconds.toString(),
    "rings" to ringsIn(seconds).toString(),
)

/** The same four the web card offers, so the two never disagree about what a
 *  reasonable ring length is. */
private val RING_SECOND_CHOICES = listOf(15, 20, 30, 45)

/** Keys rather than sentences — see [ScreeningChoice]. */
private data class RingChoice(val value: String, val labelKey: String, val detailKey: String)

private val RING_CHOICES = listOf(
    RingChoice("all", "settings.ringAll", "settings.ringAllDetail"),
    RingChoice("in_turn", "settings.ringInTurn", "settings.ringInTurnDetail"),
)

/**
 * #278 — what an inbound call does after hours.
 *
 * Hand-port of `apps/web/src/components/settings/after-hours-calls-card.tsx`,
 * keeping the three rules that shape it:
 *
 * - **The default is the product as it was.** #278's own devil's-advocate
 *   section is right that a badly-built phone tree makes a small business
 *   sound like a call centre, so ring-all stays the recommended shape and is
 *   first in the list.
 * - **Each option states its CONSEQUENCE.** "On-call only" is a label;
 *   "everyone else's phone stays quiet" is the decision being made.
 * - **A setting that cannot fire says so.** With no business hours there is no
 *   after-hours, and an owner who picks "take a message" and watches nothing
 *   happen has been failed silently — which is the worst way to fail somebody.
 */
@Composable
private fun AfterHoursCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val hoursSet = company.business_hours.values.any { it != null }

    val afterHoursUpdated = t("settings.afterHoursUpdated")

    SettingsCard(
        title = t("settings.afterHoursTitle"),
        description = t("settings.afterHoursIntro"),
    ) {
        if (!hoursSet) {
            Text(
                t("settings.afterHoursNoHours"),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        AFTER_HOURS_CHOICES.forEach { choice ->
            val selected = company.after_hours_calls == choice.value
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
                                            put("after_hours_calls", choice.value)
                                        },
                                    )
                                    onCompanyUpdated(updated)
                                    scope.showMessage(afterHoursUpdated)
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
                    Text(t(choice.labelKey), style = MaterialTheme.typography.bodyLarge)
                    Text(
                        t(choice.detailKey),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.afterHoursReadOnly"))
        }
    }
}

/**
 * The three shapes, in the order an owner grows through them.
 *
 * The middle option's second sentence is the one that stops somebody choosing
 * it by mistake: with nobody on call it behaves like the first, because every
 * uncertainty widens.
 */
private data class AfterHoursChoice(
    val value: String,
    val labelKey: String,
    val detailKey: String,
)

private val AFTER_HOURS_CHOICES = listOf(
    AfterHoursChoice(
        "ring_everyone",
        "settings.afterHoursRingEveryone",
        "settings.afterHoursRingEveryoneDetail",
    ),
    AfterHoursChoice(
        "on_call_only",
        "settings.afterHoursOnCallOnly",
        "settings.afterHoursOnCallOnlyDetail",
    ),
    AfterHoursChoice(
        "voicemail",
        "settings.afterHoursVoicemail",
        "settings.afterHoursVoicemailDetail",
    ),
)

/** #193: the change awaiting confirmation — value null = back to the
 *  company-name default. */
private data class CallerIdChange(val value: String?)

/**
 * #193: caller ID defaults to the company name platform-wide. The card shows
 * the server-resolved EFFECTIVE name; changing it is an explicit Change flow
 * with a confirmation step, because CNAM changes crawl through carrier
 * databases for days with no completion signal. The inbound name dip stays a
 * switch that saves on flip.
 */
@Composable
private fun CallerIdCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf<CallerIdChange?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    val usingCompanyName = company.caller_id_source == "company_name"
    val trimmedDraft = draft.trim()
    val draftInvalid = trimmedDraft.isNotEmpty() && !isValidCnam(trimmedDraft)
    // Both are reported from press handlers, so they are read in composition.
    val cnamSubmitted = t("settings.callerIdSubmitted")
    val cnamInvalid = t("settings.callerIdInvalidError")

    fun submit(change: CallerIdChange) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val body = buildJsonObject {
                    if (change.value == null) put("cnam_display_name", JsonNull)
                    else put("cnam_display_name", change.value)
                }
                val updated = scope.repo.updateCompany(scope.companyId, body)
                onCompanyUpdated(updated)
                editing = false
                confirming = null
                scope.showMessage(cnamSubmitted)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    fun saveLookup(next: Boolean) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val updated = scope.repo.updateCompany(
                    scope.companyId,
                    buildJsonObject { put("caller_id_lookup", next) },
                )
                onCompanyUpdated(updated)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = t("settings.callerIdTitle"),
        description = t("settings.callerIdIntro"),
    ) {
        Text(
            t("settings.callerIdOutboundHeading"),
            style = MaterialTheme.typography.labelLarge,
        )
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    company.caller_id_effective ?: t("settings.callerIdNone"),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    if (usingCompanyName) {
                        t("settings.callerIdUsingCompanyName")
                    } else {
                        t("settings.callerIdCustom")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (canEdit && !editing) {
                LinkButton(
                    onClick = {
                        draft = company.cnam_display_name.orEmpty()
                        error = null
                        confirming = null
                        editing = true
                    },
                    enabled = !saving,
                ) { Text(t("settings.callerIdChange")) }
            }
        }
        if (cnamChangePending(company.cnam_submitted_at)) {
            Text(
                t("settings.callerIdPending"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        if (editing && confirming == null) {
            OutlinedTextField(
                value = draft,
                onValueChange = { if (it.length <= 15) draft = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                singleLine = true,
                enabled = !saving,
                isError = draftInvalid,
                label = { Text(t("settings.callerIdNewNameLabel")) },
                placeholder = { Text(cnamFromCompanyName(company.name)) },
                supportingText = {
                    Text(
                        if (draftInvalid) {
                            t("settings.callerIdInvalid")
                        } else {
                            t("settings.callerIdNewNameHelp")
                        },
                    )
                },
            )
            if (!usingCompanyName) {
                LinkButton(
                    onClick = { confirming = CallerIdChange(null) },
                    enabled = !saving,
                ) { Text(t("settings.callerIdUseCompanyName")) }
            }
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = {
                        if (draftInvalid || trimmedDraft.isEmpty()) {
                            error = cnamInvalid
                            return@Button
                        }
                        if (trimmedDraft == company.cnam_display_name) {
                            editing = false
                            return@Button
                        }
                        error = null
                        confirming = CallerIdChange(trimmedDraft)
                    },
                    enabled = !saving,
                ) { Text(t("settings.callerIdReview")) }
                Spacer(Modifier.width(8.dp))
                LinkButton(
                    onClick = { editing = false },
                    enabled = !saving,
                ) { Text(t("common.cancel")) }
            }
        }

        confirming?.let { change ->
            val target = change.value ?: cnamFromCompanyName(company.name)
            Column(Modifier.padding(top = 10.dp)) {
                Text(
                    if (change.value == null) {
                        t("settings.callerIdConfirmCompanyName", "name" to target)
                    } else {
                        t("settings.callerIdConfirm", "name" to target)
                    },
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    t("settings.callerIdConfirmNote"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
                Row(
                    Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = { submit(change) },
                        enabled = !saving,
                    ) {
                        Text(
                            if (saving) {
                                t("settings.callerIdSubmitting")
                            } else {
                                t("settings.callerIdSubmit")
                            },
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    LinkButton(
                        onClick = { confirming = null },
                        enabled = !saving,
                    ) { Text(t("settings.callerIdGoBack")) }
                }
            }
        }

        LabeledSwitchRow(
            label = t("settings.callerIdLookup"),
            supporting = t("settings.callerIdLookupHelp"),
            checked = company.caller_id_lookup,
            onCheckedChange = { saveLookup(it) },
            enabled = canEdit && !saving,
        )
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.callerIdReadOnly"))
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
    val minutes = String.format(Locale.US, "%,d", voice.included_minutes)
    Text(
        // Two whole sentences rather than a clause spliced into the middle of
        // one: the overage sentence sits between the allowance and the pointer,
        // and a French translator cannot place a fragment they never see whole.
        if (voice.overage_billed) {
            t("settings.minutesFooterOverage", "minutes" to minutes)
        } else {
            t("settings.minutesFooter", "minutes" to minutes)
        },
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
}
