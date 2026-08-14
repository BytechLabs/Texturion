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
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
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
    // #228: the save failure is written from a coroutine, outside composition.
    val locale = LocalAppLocale.current
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    val existing = company.business_hours_exceptions

    // Read in composition and used from the press handlers below. `t` is a
    // @Composable read of the reader's locale, and an onClick lambda runs long
    // after composition has finished — so the words are resolved here, where the
    // locale is actually in scope.
    val removedMessage = t("settings.closedDatesRemoved")
    val addedMessage = t("settings.closedDatesAdded")
    val needsDate = t("settings.closedDatesNeedDate")
    val backwardsRange = t("settings.closedDatesBackwards")

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
                error = cause.userMessage(locale)
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = t("settings.closedDatesTitle"),
        description = t("settings.closedDatesIntro"),
    ) {
        if (existing.isEmpty()) {
            Text(
                t("settings.closedDatesEmpty"),
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
                                    removedMessage,
                                )
                            },
                        ) { Text(t("settings.closedDatesRemove")) }
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
                    label = { Text(t("settings.closedDatesFirstDay")) },
                    placeholder = { Text("2026-12-25") },
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = to,
                    onValueChange = { to = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    enabled = !saving,
                    label = { Text(t("settings.closedDatesLastDay")) },
                    // Empty means one day, which is what most of these are.
                    placeholder = { Text(t("settings.closedDatesSameDay")) },
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = note,
                onValueChange = { if (it.length <= 200) note = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = !saving,
                label = { Text(t("settings.closedDatesNoteLabel")) },
                placeholder = { Text(t("settings.closedDatesNotePlaceholder")) },
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
                        start.isEmpty() -> error = needsDate
                        end < start -> error = backwardsRange
                        else -> {
                            commit(
                                existing + HoursException(
                                    from = start,
                                    to = end,
                                    hours = null,
                                    note = note.trim().ifEmpty { null },
                                ),
                                addedMessage,
                            )
                            from = ""
                            to = ""
                            note = ""
                        }
                    }
                },
            ) { Text(t("settings.closedDatesAdd")) }
        }
        InlineError(error)
    }
}

/** "2026-12-25" alone, or "2026-12-25 — 2026-12-26" for a range. */
internal fun closedDatesLabel(entry: HoursException): String =
    if (entry.from == entry.to) entry.from else "${entry.from} — ${entry.to}"
