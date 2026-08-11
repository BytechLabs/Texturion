package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import java.time.ZonedDateTime
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * #307 — "When this line is open".
 *
 * Hand-port of `apps/web/src/components/settings/number-hours-dialog.tsx`.
 * A Vancouver line and a Toronto line in one workspace shared a clock, so the
 * away reply was wrong for one of them and no screen could fix it.
 *
 * A SECOND dialog rather than five more rows in "How this line answers". That
 * one is already five fields; a timezone picker and a seven-row week would
 * double it, and the two questions get asked at different times.
 *
 * Inheritance is stated for the WEEK, not per day. `business_hours` is one
 * column, so a line either keeps its own week or follows the workspace's. A
 * per-day badge would imply you can take Tuesday from the workspace and keep
 * Monday, which the storage cannot express and the resolver would not honour.
 */
@Composable
internal fun NumberHoursDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    var loaded by remember { mutableStateOf<LoadState<NumberIdentity>>(LoadState.Loading) }
    var zone by remember { mutableStateOf("") }
    var days by remember { mutableStateOf(emptyList<DayForm>()) }
    var initialDays by remember { mutableStateOf(emptyList<DayForm>()) }
    var picking by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    fun seed(identity: NumberIdentity) {
        zone = identity.timezone.value.orEmpty()
        val week = toFormState(identity.business_hours.value ?: emptyMap())
        days = week
        initialDays = week
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

    /** Send JsonNull for one setting: that is what "use the workspace's" means. */
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
     * Posting the resolved week back would turn an inherited clock into an
     * override just by opening this, and the line would stop following the
     * workspace with nothing looking wrong until somebody changed the
     * workspace hours and one number ignored them.
     */
    fun patchBody(current: NumberIdentity): JsonObject = buildJsonObject {
        if (zone != current.timezone.value.orEmpty()) put("timezone", zone)
        if (days != initialDays) {
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
    }

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(t("settingsMore.numberHoursTitle")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    t("settingsMore.numberHoursIntro"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when (val state = loaded) {
                    is LoadState.Loading -> Text(
                        t("settingsMore.loading"),
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
                        InheritHeader(
                            title = t("settingsMore.timezone"),
                            inherited = state.value.timezone.inherited,
                            enabled = !pending,
                            onUseWorkspace = { clear("timezone") },
                        )
                        val chooseTimezone = t("settingsMore.chooseTimezone")
                        TextButton(enabled = !pending, onClick = { picking = true }) {
                            Text(zone.ifEmpty { chooseTimezone })
                        }
                        InheritHeader(
                            title = t("settingsMore.openHours"),
                            inherited = state.value.business_hours.inherited,
                            enabled = !pending,
                            onUseWorkspace = { clear("business_hours") },
                        )
                        days.forEach { day ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                WeekdayRow(
                                    day = day,
                                    enabled = !pending,
                                    onChange = { updated ->
                                        days = days.map {
                                            if (it.weekday == updated.weekday) updated else it
                                        }
                                    },
                                )
                            }
                        }
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
            ) { Text(t("common.save")) }
        },
        dismissButton = {
            TextButton(enabled = !pending, onClick = onDismiss) { Text(t("common.cancel")) }
        },
    )

    if (picking) {
        TimezonePickerDialog(
            current = zone,
            now = ZonedDateTime.now(),
            onDismiss = { picking = false },
            onPick = {
                zone = it
                picking = false
            },
        )
    }
}

/** One setting's name, and whether this line follows the workspace for it. */
@Composable
private fun InheritHeader(
    title: String,
    inherited: Boolean,
    enabled: Boolean,
    onUseWorkspace: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.weight(1f))
        if (inherited) {
            Text(
                t("settingsMore.inheritSame"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            TextButton(enabled = enabled, onClick = onUseWorkspace) {
                Text(
                    t("settingsMore.inheritUse"),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
