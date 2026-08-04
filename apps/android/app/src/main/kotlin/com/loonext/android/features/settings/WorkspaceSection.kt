package com.loonext.android.features.settings

import androidx.compose.foundation.clickable
import com.loonext.android.core.data.CacheKeys
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.assertAboveIme
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Workspace: company name (O/A, 1-200, dirty save), the business
 * identification read card (full for O/A from the registration wizard data,
 * a redacted line for members), and the searchable IANA timezone picker with
 * a live local-time preview.
 */
@Composable
fun WorkspaceSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
    onLeft: () -> Unit = {},
) {
    NameCard(scope, company, onCompanyUpdated)
    // #393: directly under the name, because it is the name this adds to a
    // first text — the strongest relationship on the screen.
    SignTextsCard(scope, company, onCompanyUpdated)
    BusinessIdentificationCard(scope, company)
    TimezoneCard(scope, company, onCompanyUpdated)
    // #225: directly under the timezone card. Both answer "whose clock are we
    // on", and the pair reads as one idea — yours above, the customer's here.
    QuietHoursCard(scope, company, onCompanyUpdated)
    // #291: below the two clock cards because it is a different question —
    // those are about when we contact people, this is about what we know
    // about them.
    ContactFieldsCard(scope)
    // #406: everyone except the owner can end their own access. An owner
    // leaving would strand a workspace nobody can administer (#332), which is
    // why they are the one person this is not offered to.
    if (scope.role != "owner") {
        LeaveWorkspaceCard(scope, company, onLeft)
    }
}

@Composable
private fun NameCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var name by remember(company.name) { mutableStateOf(company.name) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val trimmed = name.trim()
    val dirty = trimmed != company.name
    val valid = trimmed.length in 1..200

    SettingsCard(
        title = "Workspace name",
        description = "The name your customers know you by, used on your carrier " +
            "registration and available as {business_name} in your texts.",
    ) {
        if (canEdit) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                isError = dirty && !valid,
                supportingText = if (dirty && !valid) {
                    { Text("1 to 200 characters.") }
                } else {
                    null
                },
            )
            InlineError(error)
            if (dirty) {
                Button(
                    onClick = {
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                val updated = scope.repo.updateCompany(
                                    scope.companyId,
                                    buildJsonObject { put("name", trimmed) },
                                )
                                onCompanyUpdated(updated)
                                haptics.confirm()
                                scope.showMessage("Workspace name saved.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                    enabled = valid && !saving,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (saving) "Saving…" else "Save") }
            }
        } else {
            Text(company.name, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can rename the workspace.")
        }
    }
}

@Composable
private fun BusinessIdentificationCard(scope: SettingsScope, company: CompanyView) {
    var refreshKey by remember { mutableStateOf(0) }
    // #176 cache-first. CacheKeys has no workspace entry yet, so the key is
    // built inline and reported to the orchestrator as missing.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.workspace(scope.companyId),
        refreshKey = refreshKey,
    ) { scope.repo.registration(scope.companyId) }

    SettingsCard(
        title = "Business identification",
        description = "What carriers have on file for your business. " +
            "It comes from your texting registration.",
    ) {
        when (val current = state) {
            is LoadState.Loading -> Column {
                SkeletonBlock(224.dp, 11.dp)
                Spacer(Modifier.height(8.dp))
                SkeletonBlock(176.dp, 11.dp)
            }

            is LoadState.Failed -> Column {
                Text(
                    current.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(
                    onClick = { refreshKey++ },
                    modifier = Modifier.padding(top = 8.dp),
                ) { Text("Try again") }
            }

            is LoadState.Ready -> {
                val brand = current.value.brand
                if (brand == null) {
                    Text(
                        if (company.country == "CA" && !company.us_texting_enabled) {
                            "No registration needed. Canadian texting works without one. " +
                                "Enabling US texting adds it."
                        } else {
                            "No registration details on file yet. " +
                                "Manage registration under Numbers."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else if (SettingsRoleGate.canEditWorkspace(scope.role)) {
                    IdentityRows(brand, company.country)
                    Spacer(Modifier.height(8.dp))
                    ReadOnlyLine("Need to change something? Manage registration under Numbers.")
                } else {
                    Text(
                        "Registration is " +
                            (if (brand.status == RegistrationStatus.APPROVED) "approved"
                            else "on file") +
                            ". Owners and admins can see the full details.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun IdentityRows(brand: RegistrationDetail, country: String) {
    fun field(key: String): String =
        brand.data?.get(key)?.jsonPrimitive?.content.orEmpty()

    val legalName =
        if (brand.sole_proprietor) "${field("firstName")} ${field("lastName")}".trim()
        else field("companyName")
    val identifierLabel = when {
        brand.sole_proprietor && country == "US" -> "SSN (last 4)"
        brand.sole_proprietor -> "SIN (last 4)"
        country == "US" -> "EIN"
        else -> "Business number"
    }
    val address = listOf(field("street"), field("city"), field("state"), field("postalCode"))
        .filter { it.isNotEmpty() }
        .joinToString(", ")

    val rows = listOf(
        "Legal name" to legalName,
        identifierLabel to field("ein"),
        "Address" to address,
        "Website" to field("website"),
        "Contact" to field("email"),
    ).filter { it.second.isNotEmpty() }

    if (rows.isEmpty()) {
        Text(
            "Registration details are being prepared.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    Column {
        rows.forEach { (label, value) ->
            Row(Modifier.padding(vertical = 3.dp)) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(110.dp),
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    value,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

private val TIME_FORMAT = DateTimeFormatter.ofPattern("h:mm a")

@Composable
private fun TimezoneCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    var picking by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    // Live "It's 3:42 PM in …" preview — ticks with the clock.
    val now by produceState(initialValue = ZonedDateTime.now(), company.timezone) {
        while (true) {
            value = ZonedDateTime.now()
            delay(15_000)
        }
    }
    val zone = runCatching { ZoneId.of(company.timezone) }.getOrNull()
    val localTime = zone?.let { now.withZoneSameInstant(it).format(TIME_FORMAT) }

    SettingsCard(
        title = "Timezone",
        description = "Dates in emails about your workspace are framed in your " +
            "business's local time.",
    ) {
        Text(company.timezone, style = MaterialTheme.typography.bodyLarge)
        if (localTime != null) {
            Text(
                "It's $localTime in ${company.timezone} right now.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(6.dp))
        ReadOnlyLine(
            "Texting quiet hours use each customer's local time, not this timezone.",
        )
        InlineError(error)
        if (canEdit) {
            OutlinedButton(
                onClick = { picking = true },
                enabled = !saving,
                modifier = Modifier.padding(top = 10.dp),
            ) { Text(if (saving) "Saving…" else "Change timezone") }
        } else {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change the timezone.")
        }
    }

    if (picking) {
        TimezonePickerDialog(
            current = company.timezone,
            now = now,
            onDismiss = { picking = false },
            onPick = { picked ->
                picking = false
                error = null
                saving = true
                coroutines.launch {
                    try {
                        val updated = scope.repo.updateCompany(
                            scope.companyId,
                            buildJsonObject { put("timezone", picked) },
                        )
                        onCompanyUpdated(updated)
                        haptics.confirm()
                        scope.showMessage("Timezone saved.")
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
        )
    }
}

@Composable
internal fun TimezonePickerDialog(
    current: String,
    now: ZonedDateTime,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val allZones = remember { ZoneId.getAvailableZoneIds().sorted() }
    val filtered = remember(query, allZones) {
        val needle = query.trim().replace(' ', '_')
        if (needle.isEmpty()) allZones
        else allZones.filter { it.contains(needle, ignoreCase = true) }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a timezone") },
        text = {
            // #199: platform-positioned dialog window + debug guard on the
            // search field.
            Column(Modifier.assertAboveIme("dialog")) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("Search, e.g. Toronto") },
                )
                Spacer(Modifier.height(8.dp))
                if (filtered.isEmpty()) {
                    Text(
                        "No timezone matches \"$query\".",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    LazyColumn(Modifier.heightIn(max = 340.dp)) {
                        items(filtered, key = { it }) { zoneId ->
                            val zoneTime = runCatching {
                                now.withZoneSameInstant(ZoneId.of(zoneId)).format(TIME_FORMAT)
                            }.getOrNull()
                            Column(Modifier.animateItem()) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { onPick(zoneId) }
                                        .padding(vertical = 10.dp),
                                ) {
                                    Text(
                                        zoneId,
                                        style = if (zoneId == current) {
                                            MaterialTheme.typography.bodyMedium.copy(
                                                color = MaterialTheme.colorScheme.primary,
                                            )
                                        } else {
                                            MaterialTheme.typography.bodyMedium
                                        },
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (zoneTime != null) {
                                        Text(
                                            zoneTime,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                HorizontalDivider(
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { LinkButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * #393: sign the first text to a new customer with the business name.
 *
 * Deliberately NOT titled "identification" — the card below uses that word for
 * carrier registration data, and two cards saying it would read as one thing.
 * The part cost is disclosed because it is real: the signature can push a long
 * first text into a second part, and the customer pays per part.
 */
@Composable
private fun SignTextsCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    SettingsCard(
        title = "Sign your texts",
        description = "Add your business name to the first text you send " +
            "someone, so a message from an unknown number says who it is from.",
    ) {
        LabeledSwitchRow(
            label = "Sign the first text to a new customer",
            supporting = "Once per customer. Replies and later texts are never signed.",
            checked = company.first_message_identification,
            enabled = canEdit && !saving,
            onCheckedChange = { next ->
                error = null
                saving = true
                coroutines.launch {
                    try {
                        val body = buildJsonObject {
                            put("first_message_identification", next)
                        }
                        onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
        )
        // Server-resolved, and only shown once the server confirms — composing
        // the signature here could drift from what actually sends and bills.
        val signature = company.first_message_identification_suffix?.trim()
        if (company.first_message_identification && !signature.isNullOrEmpty()) {
            PreviewBubble(label = "What gets added", text = signature)
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(
                "That is ${signature.length} characters, so a long first text " +
                    "can be sent in two parts instead of one.",
            )
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change how texts are signed.")
        }
    }
}

/**
 * #225 ask 5 — the quiet-hours confirmation, for the trade that works nights.
 *
 * COPY DISCIPLINE, AND IT IS THE WHOLE DESIGN. This must never read as "turn off
 * quiet hours". Automated texts are held to the customer's window no matter what
 * this says, and an owner who believed otherwise would be relying on a permission
 * we did not grant. Every sentence names the PROMPT, and the consequence block
 * says out loud what the switch does not do. Copy is identical to the web and iOS
 * cards on purpose.
 */
@Composable
private fun QuietHoursCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    SettingsCard(
        title = "Texting a new customer at night",
        description = "Starting a brand-new conversation between 8pm and 8am " +
            "the customer's time asks you to confirm first.",
    ) {
        LabeledSwitchRow(
            label = "Ask me to confirm",
            supporting = "Only when you start the conversation. Replying to a " +
                "customer who texted or called you is never interrupted.",
            checked = company.quiet_hours_confirm_enabled,
            enabled = canEdit && !saving,
            onCheckedChange = { next ->
                error = null
                saving = true
                coroutines.launch {
                    try {
                        val body = buildJsonObject {
                            put("quiet_hours_confirm_enabled", next)
                        }
                        onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
        )
        // The consequence, inline and at the moment of the decision. The second
        // line is the one that matters: it forecloses the reading that this
        // permits automated night texts.
        if (!company.quiet_hours_confirm_enabled) {
            PreviewBubble(
                label = "With this off",
                text = "You will not be asked. A text you start at 2am goes " +
                    "straight out, and it is on you that the customer wanted to " +
                    "hear from you then.",
            )
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(
                "This does not change automated texts. Reminders and anything " +
                    "else we send on your behalf still wait for the customer's " +
                    "morning, whatever this is set to.",
            )
        }
        InlineError(error)
        if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine("Only owners and admins can change this.")
        }
    }
}
