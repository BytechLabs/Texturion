package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.loonext.android.core.model.ReminderRule
import com.loonext.android.core.reminders.AppointmentReminders
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #237 — the text that stops a no-show.
 *
 * Design notes, and the principles behind them:
 *
 * - **OFF is the honest starting state, and it says so.** No workspace sends
 *   reminders until somebody here turns them on, because seeding them would
 *   start texting a live customer base automatically. So the empty card is not
 *   a form waiting to be filled — it is the current, correct answer — and it
 *   reads as an offer. *Applying: Smart Defaults, without applying them.*
 * - **Two offsets, and the ceiling is shown rather than enforced by a
 *   refusal.** The day before, so the customer can still move it, and a couple
 *   of hours out, so somebody is home. A crew that texts five times is a crew
 *   whose customers stop reading.
 * - **Chunking.** One row per rule: when it goes, whether it is on, and the
 *   words. A picker with merge-field chips and a preview pane would be more
 *   product than this decision has.
 * - **Ethical friction where it belongs.** Removing a rule is one tap and
 *   undoable by adding it back; nothing has been sent. The friction is that
 *   nothing saves until Save, so an owner editing a text that reaches every
 *   customer can still walk away from it.
 *
 * Sits at the bottom of the hours section rather than in a section of its own:
 * every card above it answers "what do we send automatically, and in whose
 * words", and the settings list is already long enough that a two-rule form
 * does not earn another row. Mirrors the web card.
 */
@Composable
fun ReminderRulesCard(scope: SettingsScope) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<List<ReminderRule>>(emptyList()) }
    var draft by remember { mutableStateOf<List<ReminderRule>>(emptyList()) }
    var suggested by remember { mutableStateOf<List<ReminderRule>>(emptyList()) }
    var cap by remember { mutableStateOf(AppointmentReminders.RULES_CAP) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(scope.companyId) {
        runCatching { scope.repo.reminderRules(scope.companyId) }
            .onSuccess { response ->
                saved = response.rules
                draft = response.rules
                suggested = response.suggested
                cap = response.cap
                loaded = true
            }
            .onFailure { loaded = true }
    }

    val dirty = draft != saved

    fun commit() {
        if (!canEdit || saving) return
        saving = true
        coroutines.launch {
            try {
                val result = scope.repo.saveReminderRules(scope.companyId, draft)
                saved = result.rules
                draft = result.rules
                scope.showMessage(
                    if (result.rules.isEmpty()) {
                        "Reminders are off. Nothing will go out automatically."
                    } else {
                        "Saved. New jobs will carry these reminders."
                    },
                )
            } catch (cause: Exception) {
                scope.showMessage(cause.userMessage())
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = "Appointment reminders",
        description = "A text before the job, so fewer people forget.",
    ) {
        if (!loaded) {
            Text(
                "Loading…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SettingsCard
        }

        if (draft.isEmpty()) {
            // The honest empty state: off is a state, not a gap.
            Text(
                "Reminders are off. Nothing goes out automatically until you set " +
                    "one up — a job booked for tomorrow gets no text from us today.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (canEdit && suggested.isNotEmpty()) {
                Button(
                    onClick = { draft = suggested.map { it.copy(enabled = true) } },
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text("Set up the usual two") }
            }
            return@SettingsCard
        }

        draft.forEachIndexed { index, rule ->
            ReminderRuleRow(
                rule = rule,
                canEdit = canEdit && !saving,
                takenOffsets = draft.map { it.offset_minutes },
                onChange = { updated ->
                    draft = draft.toMutableList().also { it[index] = updated }
                },
                onRemove = {
                    draft = draft.filterIndexed { i, _ -> i != index }
                },
            )
        }

        if (canEdit && draft.size < cap) {
            OutlinedButton(
                onClick = {
                    val free = AppointmentReminders.OFFSET_CHOICES
                        .firstOrNull { choice ->
                            draft.none { it.offset_minutes == choice }
                        } ?: 120
                    draft = draft + ReminderRule(
                        offset_minutes = free,
                        body = suggested.getOrNull(1)?.body.orEmpty(),
                        enabled = true,
                    )
                },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("Add another") }
        }

        if (draft.size >= cap) {
            // The ceiling, shown rather than enforced by a refusal at save.
            Text(
                "Two is the most we send. Past that, customers stop reading them.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        if (canEdit) {
            Row(
                Modifier.padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(onClick = { commit() }, enabled = dirty && !saving) {
                    Text("Save reminders")
                }
                if (dirty) {
                    TextButton(onClick = { draft = saved }) { Text("Discard") }
                }
            }
        }
    }
}

@Composable
private fun ReminderRuleRow(
    rule: ReminderRule,
    canEdit: Boolean,
    takenOffsets: List<Int>,
    onChange: (ReminderRule) -> Unit,
    onRemove: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // A fixed list rather than a free number field: "how many minutes
            // before?" is a question nobody in a van wants to answer, and the
            // ones that matter are already the industry's.
            OutlinedButton(
                onClick = { if (canEdit) menuOpen = true },
                enabled = canEdit,
            ) {
                Text(AppointmentReminders.offsetLabel(rule.offset_minutes))
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                AppointmentReminders.OFFSET_CHOICES.forEach { minutes ->
                    DropdownMenuItem(
                        text = { Text(AppointmentReminders.offsetLabel(minutes)) },
                        // Two rules at the same offset is the same reminder
                        // arriving twice, which is the failure a customer
                        // notices and blames the business for.
                        enabled = minutes == rule.offset_minutes ||
                            !takenOffsets.contains(minutes),
                        onClick = {
                            menuOpen = false
                            onChange(rule.copy(offset_minutes = minutes))
                        },
                    )
                }
            }
            Switch(
                checked = rule.enabled,
                enabled = canEdit,
                onCheckedChange = { onChange(rule.copy(enabled = it)) },
            )
            if (canEdit) {
                TextButton(onClick = onRemove) { Text("Remove") }
            }
        }
        OutlinedTextField(
            value = rule.body,
            onValueChange = { onChange(rule.copy(body = it)) },
            enabled = canEdit,
            label = { Text("What it says") },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}
