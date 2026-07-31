package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import com.loonext.android.core.model.HoursException
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #402 — the dates the weekly schedule cannot know about.
 *
 * Christmas Day falls on a Thursday. The schedule says Thursday 08:00-17:00,
 * so the product believed the shop was open and a homeowner with a burst pipe
 * got silence. An auto-reply matters MORE on a holiday than on an ordinary
 * evening: at 9pm on a Tuesday the customer knows why nobody replied, but on
 * Christmas Day silence is ambiguous, and they resolve that by calling
 * somebody else.
 *
 * Sits directly under the weekly hours it overrides — these dates only mean
 * anything as an exception to that schedule, and an owner looking for "we're
 * shut on Boxing Day" looks where they set their hours.
 *
 * Same copy as web and iOS, deliberately: a rule worded three ways is three
 * rules.
 */
@Composable
fun ClosedDatesCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = scope.role == "owner" || scope.role == "admin"
    val coroutines = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    val existing = company.business_hours_exceptions

    fun commit(next: List<HoursException>, message: String) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val body = buildJsonObject {
                    put(
                        "business_hours_exceptions",
                        buildJsonArray {
                            next.forEach { entry ->
                                addJsonObject {
                                    put("from", entry.from)
                                    put("to", entry.to)
                                    // Closed all day. The weekly schedule
                                    // already handles the shape of a short day.
                                    put("hours", JsonNull)
                                    entry.note?.let { put("note", it) }
                                }
                            }
                        },
                    )
                }
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
                scope.showMessage(message)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = "Closed dates",
        description = "Holidays, a week off, a day for a funeral. On these dates your " +
            "away reply goes out even if the weekly schedule says you're open — so a " +
            "customer texting on Christmas morning hears something back instead of " +
            "nothing.",
    ) {
        if (existing.isEmpty()) {
            Text(
                "No closed dates yet. Your weekly hours apply every week.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            existing.forEachIndexed { index, entry ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            closedDatesLabel(entry),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        entry.note?.takeIf { it.isNotBlank() }?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (canEdit) {
                        LinkButton(
                            enabled = !saving,
                            onClick = {
                                commit(
                                    existing.filterIndexed { i, _ -> i != index },
                                    "Closed date removed.",
                                )
                            },
                        ) { Text("Remove") }
                    }
                }
            }
        }

        if (canEdit) {
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = from,
                    onValueChange = { from = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    enabled = !saving,
                    label = { Text("First day") },
                    placeholder = { Text("2026-12-25") },
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = to,
                    onValueChange = { to = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    enabled = !saving,
                    label = { Text("Last day") },
                    // Empty means one day, which is what most of these are.
                    placeholder = { Text("Same day") },
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = note,
                onValueChange = { if (it.length <= 200) note = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = !saving,
                label = { Text("What to tell customers (optional)") },
                placeholder = { Text("Closed for the holiday, back Monday") },
            )
            Spacer(Modifier.height(10.dp))
            Button(
                enabled = !saving,
                onClick = {
                    val start = from.trim()
                    // Only the first box filled means one day. Making somebody
                    // type the same date twice is busywork on the common case.
                    val end = to.trim().ifEmpty { start }
                    when {
                        start.isEmpty() -> error = "Pick the date you're closed."
                        end < start -> error = "The last day can't be before the first day."
                        else -> {
                            commit(
                                existing + HoursException(
                                    from = start,
                                    to = end,
                                    hours = null,
                                    note = note.trim().ifEmpty { null },
                                ),
                                "Closed date added.",
                            )
                            from = ""
                            to = ""
                            note = ""
                        }
                    }
                },
            ) { Text("Add closed date") }
        }
        InlineError(error)
    }
}

/** "2026-12-25" alone, or "2026-12-25 — 2026-12-26" for a range. */
internal fun closedDatesLabel(entry: HoursException): String =
    if (entry.from == entry.to) entry.from else "${entry.from} — ${entry.to}"
