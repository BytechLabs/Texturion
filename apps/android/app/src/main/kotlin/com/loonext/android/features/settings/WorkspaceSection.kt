package com.loonext.android.features.settings

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
) {
    NameCard(scope, company, onCompanyUpdated)
    BusinessIdentificationCard(scope, company)
    TimezoneCard(scope, company, onCompanyUpdated)
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
    var state by remember(scope.companyId) {
        mutableStateOf<LoadState<RegistrationDetailPair>>(LoadState.Loading)
    }
    var refreshKey by remember { mutableStateOf(0) }
    LaunchedEffect(scope.companyId, refreshKey) {
        state = try {
            LoadState.Ready(scope.repo.registration(scope.companyId))
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    SettingsCard(
        title = "Business identification",
        description = "What carriers have on file for your business. " +
            "It comes from your texting registration.",
    ) {
        when (val current = state) {
            is LoadState.Loading -> Text(
                "Loading…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

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
private fun TimezonePickerDialog(
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
            Column {
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
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
