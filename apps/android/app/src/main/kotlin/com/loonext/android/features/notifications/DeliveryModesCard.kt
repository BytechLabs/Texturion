package com.loonext.android.features.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.NotificationPrefs
import com.loonext.android.core.oncall.OnCall

/**
 * #297 — how loud each kind of notification is.
 *
 * Design notes, and the principles behind them:
 *
 * - **The promise comes first, above every control.** "An emergency always
 *   arrives straight away, whatever you choose here." Without that sentence
 *   nobody picks a quieter setting, because the fear is missing the call that
 *   mattered — and they go back to turning notifications off entirely, which is
 *   the failure this feature exists to prevent.
 *   *Applying: Loss Aversion, read the right way round.*
 * - **One row per category, one decision each.** Six categories times three
 *   modes is eighteen controls; as six rows each holding one three-way choice
 *   it is six small decisions. *Applying: Chunking.*
 * - **The window appears only when something is grouped.** *Applying: Zen of
 *   Clarity, and progressive disclosure rather than a settings wall.*
 *
 * Mirrors the web and iOS cards; `OnCallCopyTest` keeps the words identical.
 */
@Composable
fun DeliveryModesCard(
    prefs: NotificationPrefs,
    onSave: (NotificationPrefs) -> Unit,
) {
    var pickingWindow by remember { mutableStateOf(false) }

    // An absent key means immediate — the SERVER's rule, restated here rather
    // than reinvented, so the two cannot drift.
    fun modeOf(category: String): String = prefs.delivery[category] ?: "immediate"

    fun setMode(category: String, mode: String) {
        val next = prefs.delivery.toMutableMap()
        // Immediate is stored as ABSENCE. Writing it would make a member who
        // chose the default look different from one who never touched this,
        // and they are the same thing.
        if (mode == "immediate") next.remove(category) else next[category] = mode
        onSave(
            prefs.copy(
                delivery = next,
                batch_window_minutes = if (next.containsValue("batched")) {
                    prefs.batch_window_minutes ?: OnCall.DEFAULT_BATCH_WINDOW
                } else {
                    null
                },
            ),
        )
    }

    val anyBatched = OnCall.CATEGORY_LABELS.keys.any { modeOf(it) == "batched" }
    val anySummary = OnCall.CATEGORY_LABELS.keys.any { modeOf(it) == "summary" }

    Column(Modifier.padding(top = 12.dp)) {
        Text(
            OnCall.DELIVERY_HEADING,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(bottom = 2.dp),
        )
        Text(
            OnCall.DELIVERY_URGENT_ALWAYS,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )

        for ((category, label) in OnCall.CATEGORY_LABELS) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (mode in OnCall.DELIVERY_MODES) {
                        val selected = modeOf(category) == mode
                        Text(
                            when (mode) {
                                "batched" -> OnCall.DELIVERY_BATCHED
                                "summary" -> OnCall.DELIVERY_SUMMARY
                                else -> OnCall.DELIVERY_IMMEDIATE
                            },
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = if (selected) {
                                MaterialTheme.colorScheme.onSecondary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(
                                    if (selected) {
                                        MaterialTheme.colorScheme.secondary
                                    } else {
                                        MaterialTheme.colorScheme.surface
                                    },
                                )
                                .minimumInteractiveComponentSize()
                                .clickable { setMode(category, mode) }
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }
        }

        if (anySummary) {
            Text(
                OnCall.DELIVERY_SUMMARY_DETAIL,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        if (anyBatched) {
            HorizontalDivider(
                Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Group them every",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(end = 8.dp),
                )
                Column {
                    OutlinedButton(
                        onClick = { pickingWindow = true },
                    ) {
                        Text(
                            "${prefs.batch_window_minutes ?: OnCall.DEFAULT_BATCH_WINDOW} minutes",
                        )
                    }
                    DropdownMenu(
                        expanded = pickingWindow,
                        onDismissRequest = { pickingWindow = false },
                    ) {
                        for (minutes in OnCall.BATCH_WINDOW_CHOICES) {
                            DropdownMenuItem(
                                text = { Text("$minutes minutes") },
                                onClick = {
                                    pickingWindow = false
                                    onSave(prefs.copy(batch_window_minutes = minutes))
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
