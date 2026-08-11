package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.OnCallShift
import com.loonext.android.core.model.OnCallShiftBody
import com.loonext.android.core.oncall.OnCall
import com.loonext.android.ui.common.userMessage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.launch

/**
 * #244 — who is holding the phone tonight.
 *
 * Design notes, and the principles behind them:
 *
 * - **The empty state is the default, and it states the CONSEQUENCE.** Every
 *   existing workspace has no rota, so a blank card would read as a gap
 *   somebody forgot to fill. What an owner needs to know is what "nobody on
 *   call" costs them — everyone gets woken. *Applying: Loss Aversion — frame
 *   the choice around what the crew is currently losing, their nights.*
 * - **Three presets, not a datetime builder.** The real decision is "Dana has
 *   tonight". *Applying: Chunking & Smart Defaults.*
 * - **The escalation promise is on the card.** Putting one person on call is
 *   only a good decision if the owner knows what happens when that person
 *   sleeps through it.
 * - **Ending a shift takes one tap and no confirmation.** It is instantly
 *   reversible and it FAILS SAFE — with nobody on call everyone is woken,
 *   which is the pre-#244 behaviour. *Applying: Ethical Friction, on the
 *   irreversible edge only, and this edge is the opposite of that.*
 *
 * Mirrors the web card; `OnCallCopyTest` keeps the sentences identical.
 */
@Composable
fun OnCallCard(scope: SettingsScope) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    // Read here because `nameOf` and the confirmations below run outside
    // composition — a shift is created from a coroutine, not from a redraw.
    val locale = LocalAppLocale.current
    val coroutines = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var shifts by remember { mutableStateOf<List<OnCallShift>>(emptyList()) }
    var roster by remember { mutableStateOf<List<Member>>(emptyList()) }
    var chosen by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    suspend fun reload() {
        runCatching { scope.repo.onCallShifts(scope.companyId) }
            .onSuccess { shifts = it.data }
        loaded = true
    }

    LaunchedEffect(scope.companyId) {
        runCatching { scope.repo.members(scope.companyId) }
            .onSuccess { roster = it.data }
        reload()
    }

    fun nameOf(userId: String): String =
        roster.firstOrNull { it.user_id == userId }?.display_name
            ?: AppStrings.translate(locale, "settingsMore.someone")

    val now = System.currentTimeMillis()
    val live = shifts.firstOrNull {
        parseIso(it.starts_at) <= now && parseIso(it.ends_at) > now
    }
    val upcoming = shifts.filter { it !== live }

    fun put(preset: String) {
        val target = chosen ?: roster.firstOrNull()?.user_id ?: return
        if (busy) return
        busy = true
        coroutines.launch {
            try {
                // getOffset(instant), NOT rawOffset. `rawOffset` is the
                // zone's standard offset and ignores daylight saving, so all
                // summer it would put every shift out by an hour — a "6pm"
                // window that starts at 5pm, silently, and only for half the
                // year.
                val at = Date()
                val offset = TimeZone.getDefault().getOffset(at.time) / 60_000
                val window = OnCall.window(preset, at, offset)
                scope.repo.createOnCallShift(
                    scope.companyId,
                    OnCallShiftBody(
                        user_id = target,
                        starts_at = window.startsAt,
                        ends_at = window.endsAt,
                    ),
                )
                reload()
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        "settingsMore.onCallNowOn",
                        mapOf("name" to nameOf(target)),
                    ),
                )
            } catch (cause: Exception) {
                scope.showMessage(cause.userMessage())
            } finally {
                busy = false
            }
        }
    }

    fun end(id: String) {
        if (busy) return
        busy = true
        coroutines.launch {
            try {
                scope.repo.endOnCallShift(scope.companyId, id)
                reload()
            } catch (cause: Exception) {
                scope.showMessage(cause.userMessage())
            } finally {
                busy = false
            }
        }
    }

    SettingsCard(title = t("settingsMore.onCallTitle"), description = OnCall.ESCALATION) {
        when {
            !loaded ->
                Text(
                    t("settingsMore.onCallChecking"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

            live != null ->
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        OnCall.line(nameOf(live.user_id), until(live.ends_at)),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    if (canEdit) {
                        TextButton(onClick = { end(live.id) }, enabled = !busy) {
                            Text(t("settingsMore.onCallEndShift"))
                        }
                    }
                }

            // Not "no shifts". The sentence says what the current state costs.
            else ->
                Text(
                    OnCall.NOBODY,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }

        if (upcoming.isNotEmpty()) {
            HorizontalDivider(
                Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
            )
            for (shift in upcoming) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${nameOf(shift.user_id)} · ${until(shift.starts_at)} → " +
                            until(shift.ends_at),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    if (canEdit) {
                        TextButton(onClick = { end(shift.id) }, enabled = !busy) {
                            Text(t("settingsMore.remove"))
                        }
                    }
                }
            }
        }

        if (!canEdit) {
            Text(
                OnCall.READ_ONLY,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            return@SettingsCard
        }

        HorizontalDivider(
            Modifier.padding(vertical = 10.dp),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
        )
        Text(
            t("settingsMore.onCallPut"),
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        Column {
            OutlinedButton(onClick = { picking = true }, enabled = roster.isNotEmpty()) {
                Text(
                    nameOf(chosen ?: roster.firstOrNull()?.user_id.orEmpty()),
                )
            }
            DropdownMenu(expanded = picking, onDismissRequest = { picking = false }) {
                for (member in roster) {
                    DropdownMenuItem(
                        text = { Text(member.display_name) },
                        onClick = {
                            chosen = member.user_id
                            picking = false
                        },
                    )
                }
            }
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for (preset in OnCall.PRESETS) {
                OutlinedButton(
                    onClick = { put(preset.key) },
                    enabled = !busy && roster.isNotEmpty(),
                ) {
                    Text(preset.label)
                }
            }
        }
        Text(
            OnCall.PRESETS.joinToString(" · ") { "${it.label}: ${it.detail}" },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

private fun parseIso(value: String): Long =
    runCatching {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.parse(value.substring(0, 19))?.time ?: 0L
    }.getOrDefault(0L)

/** "Sat 8:00 AM" — the crew's own clock, because that is when they wake up. */
private fun until(iso: String): String =
    SimpleDateFormat("EEE h:mm a", Locale.getDefault())
        .format(Date(parseIso(iso)))
