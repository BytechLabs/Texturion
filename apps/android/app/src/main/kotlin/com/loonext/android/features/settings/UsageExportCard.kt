package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * #595 — the bookkeeper's usage export, on this phone.
 *
 * The reader is whoever does the books, reconciling against the Stripe invoice.
 * The web card (#304) has shipped this for a while; this client had no export
 * surface of ANY kind — `grep "v1/exports"` over this source tree returned
 * nothing — so a bookkeeper holding the phone could see the meters and had no
 * way to get the detail behind them out.
 *
 * That absence is why this file carries both halves. A request with nowhere to
 * collect from is not a feature: the file is built in the background and, on
 * web, lands on a Data export screen this app does not have. So the card asks
 * for the file AND lists what has been asked for, under the one heading the
 * shared caveat names.
 *
 * Design notes, and the principles behind them:
 *
 *  - **Defaulted to last complete month, never empty.** `from` is REQUIRED by
 *    the API, so an empty pair is a form that cannot be submitted until
 *    somebody works out what to type. *Applying: Smart Defaults.*
 *
 *  - **Collapsed until asked for.** The Usage section is already the fair-use
 *    line, delivery, the spending cap and the owner's detail block. Pulling a
 *    file is occasional and does not earn permanent space above them.
 *    *Applying: Zen of Clarity.*
 *
 *  - **One card, not two.** [EXPORT_USAGE_NOTE] promises the file "appears
 *    under Data export", and here it appears in the card that offered it —
 *    there is no second screen to send somebody to, and inventing one for a
 *    list that holds five rows would be more structure than the feature.
 *
 *  - **The caveat before the decision.** "Not a copy of your Stripe invoice"
 *    sits above the start button, not in the finished file where it would only
 *    arrive after the wait. *Applying: Ethical Friction.*
 *
 *  - **Absent, not disabled, for anybody without the capability.** Asked as
 *    `billing.manage` (#315 made roles capability SETS, so a future role
 *    holding it gets this for free) and deliberately not `contacts.bulk`,
 *    which guards the exports carrying customer data. This document names no
 *    customer, and gating it that way would lock out the person it is for.
 */

// ---------------------------------------------------------------------------
// The shared rule, hand-ported.
// ---------------------------------------------------------------------------

/** The period the card opens on: two `yyyy-mm-dd` days, as the shared rule states them. */
data class UsageExportPeriod(val from: String, val to: String)

/**
 * Hand-port of `lastCompleteMonth` in `packages/shared/src/usage-export.ts`,
 * held to it by `ParityVectorsTest`.
 *
 * TAKES YEAR AND MONTH, NOT A DATE, and that is the portable part. The web
 * original subtracted 86_400_000ms from local midnight — a rule expressed in
 * milliseconds, which every port has to re-derive rather than translate. With
 * integers in and strings out there is nothing about a time zone crossing the
 * boundary, so the three clients can only agree.
 *
 * COMPLETE, not the current one: a bookkeeper reconciles a month that has
 * finished, and defaulting to a period still accruing produces a file that is
 * out of date before it finishes building.
 *
 * [YearMonth.lengthOfMonth] carries the full Gregorian leap rule, including the
 * century cases the shared vectors pin (2100 is not a leap year, 2000 is) — so
 * this port does not restate the rule, it asks the same question of the
 * platform calendar.
 */
fun lastCompleteMonth(year: Int, month: Int): UsageExportPeriod {
    // December rolls back to the previous year. Written out rather than reached
    // by modulo, because these two lines are what a reader checks first.
    val prevYear = if (month == 1) year - 1 else year
    val prevMonth = if (month == 1) 12 else month - 1
    val lastDay = YearMonth.of(prevYear, prevMonth).lengthOfMonth()
    // Locale.ROOT, not the reader's: `%02d` under a locale with its own digits
    // renders Arabic-Indic numerals, and the API is being handed a date rather
    // than a sentence.
    return UsageExportPeriod(
        from = String.format(Locale.ROOT, "%04d-%02d-01", prevYear, prevMonth),
        to = String.format(Locale.ROOT, "%04d-%02d-%02d", prevYear, prevMonth, lastDay),
    )
}

/** The words, from `packages/shared/src/usage-export.ts`. Pinned by `UsageExportCardTest`. */
const val EXPORT_USAGE_ACTION = "Export usage"

const val EXPORT_USAGE_BLURB =
    "Your texts, calls and storage for a period, as a file for whoever does " +
        "your books."

const val EXPORT_USAGE_NOTE =
    "It counts what we measured — it is not a copy of your Stripe invoice, and " +
        "nothing on it is priced. It is put together in the background and appears " +
        "under Data export."

/**
 * A picked day, as the instant the API is asking for.
 *
 * A date control gives a DAY; `POST /v1/exports/usage` takes an ISO-8601
 * instant. Which instant is the whole question: `from` is the start of its day
 * and `to` is the END of its day, so a period typed "the 1st to the 30th"
 * includes the 30th — which is what anybody means by it, and what a month is.
 * Web resolves it exactly here (`T00:00:00` / `T23:59:59.999`), and matching it
 * is not a detail: the same period asked for from two clients has to export the
 * same data.
 *
 * The day is read in [zone] — the reader's own, as on web — and sent as UTC.
 */
internal fun usageExportFromInstant(day: String, zone: ZoneId): String =
    LocalDate.parse(day).atStartOfDay(zone).toInstant().isoUtc()

internal fun usageExportToInstant(day: String, zone: ZoneId): String =
    LocalDate.parse(day)
        .atTime(23, 59, 59, 999_000_000)
        .atZone(zone)
        .toInstant()
        .isoUtc()

private fun Instant.isoUtc(): String =
    DateTimeFormatter.ISO_INSTANT.format(this.atZone(ZoneOffset.UTC).toInstant())

/**
 * How often the list re-asks WHILE something is being built.
 *
 * Fifteen seconds, matching web. The number matters less than the stopping
 * rule beside it: the loop ends the moment nothing is in flight, because a
 * screen that keeps asking forever is a cost with no reader.
 */
private const val POLL_MILLIS = 15_000L

/** The statuses that mean the server is still working. */
private val IN_FLIGHT = setOf("pending", "running")

/** Is the server still building any of these? The whole stopping rule, in one place. */
internal fun anyInFlight(rows: List<DataExport>): Boolean =
    rows.any { it.status in IN_FLIGHT }

/**
 * Read the list, and keep reading ONLY while something is being built.
 *
 * Lifted out of the composable so the stopping rule can be tested at speed —
 * the interval is a parameter here and fifteen seconds in the card. What is
 * being guarded is not the number, it is the three ways out: nothing in flight,
 * a failed read, and cancellation. A loop that keeps asking forever is a cost
 * with no reader, on a phone, on somebody's battery and data.
 *
 * A failed read ENDS it rather than retrying. A server that just refused is not
 * more likely to agree in fifteen seconds, and a screen left open overnight
 * would turn one failure into thousands.
 */
internal suspend fun pollExports(
    pollMillis: Long = POLL_MILLIS,
    fetch: suspend () -> List<DataExport>,
    onRows: (List<DataExport>) -> Unit,
    onFailed: (Throwable) -> Unit,
) {
    while (true) {
        val rows = try {
            fetch()
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            onFailed(cause)
            return
        }
        onRows(rows)
        if (!anyInFlight(rows)) return
        delay(pollMillis)
    }
}

private val REQUESTED_FORMAT = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.getDefault())

// ---------------------------------------------------------------------------
// The card.
// ---------------------------------------------------------------------------

@Composable
fun UsageExportCard(scope: SettingsScope) {
    // Asked as a CAPABILITY, never re-derived as a rank and never a hardcoded
    // role list. Absent rather than disabled: a control somebody may not use is
    // a question with no answer on it.
    if (!MemberRole.has(scope.role, Capability.BILLING_MANAGE)) return

    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var open by rememberSaveable { mutableStateOf(false) }
    val initial = remember {
        val today = LocalDate.now()
        lastCompleteMonth(today.year, today.monthValue)
    }
    var from by rememberSaveable { mutableStateOf(initial.from) }
    var to by rememberSaveable { mutableStateOf(initial.to) }
    var starting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf<PickTarget?>(null) }

    var exports by remember { mutableStateOf<List<DataExport>?>(null) }
    var listError by remember { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }

    // The list, and the poll that STOPS. Restarted by [refreshKey] after a
    // successful start, because there is then something in flight to watch.
    LaunchedEffect(scope.companyId, refreshKey) {
        pollExports(
            fetch = { scope.repo.dataExports(scope.companyId).data },
            onRows = {
                exports = it
                listError = null
            },
            onFailed = { listError = it.userMessage() },
        )
    }

    SettingsCard(
        title = "Data export",
        description = if (open) null else EXPORT_USAGE_BLURB,
    ) {
        if (!open) {
            LinkButton(onClick = { open = true }) {
                Icon(
                    Icons.Outlined.Description,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(EXPORT_USAGE_ACTION)
            }
        } else {
            Text(EXPORT_USAGE_BLURB, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(10.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                DayField(
                    label = "From",
                    day = from,
                    modifier = Modifier.weight(1f),
                    onClick = { picking = PickTarget.FROM },
                )
                DayField(
                    label = "To",
                    day = to,
                    modifier = Modifier.weight(1f),
                    onClick = { picking = PickTarget.TO },
                )
            }
            Spacer(Modifier.height(8.dp))
            // The honest caveat where the DECISION is made, not where the
            // disappointment would be.
            ReadOnlyLine(EXPORT_USAGE_NOTE)
            InlineError(error)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 10.dp),
            ) {
                OutlinedButton(
                    enabled = !starting,
                    onClick = {
                        error = null
                        starting = true
                        coroutines.launch {
                            try {
                                val zone = ZoneId.systemDefault()
                                val started = scope.repo.startUsageExport(
                                    companyId = scope.companyId,
                                    from = usageExportFromInstant(from, zone),
                                    to = usageExportToInstant(to, zone),
                                )
                                open = false
                                haptics.confirm()
                                scope.showMessage(
                                    if (started.already_building) {
                                        "One is already being put together. It will " +
                                            "appear under Data export."
                                    } else {
                                        "Being put together now. It will appear under " +
                                            "Data export."
                                    },
                                )
                                // Re-read, which also restarts the poll: there is
                                // now something in flight to watch.
                                refreshKey++
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                starting = false
                            }
                        }
                    },
                ) { Text(if (starting) "Starting…" else "Start it") }
                LinkButton(onClick = { open = false }) { Text("Cancel") }
            }
        }

        val rows = exports
        if (listError != null) {
            InlineError(listError)
        } else if (rows != null && rows.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            for (row in rows) {
                ExportRow(row) { url -> openExternal(context, url) }
            }
        }
    }

    when (picking) {
        null -> Unit
        PickTarget.FROM -> DayPicker(
            day = from,
            onDismiss = { picking = null },
            onPick = {
                from = it
                picking = null
            },
        )

        PickTarget.TO -> DayPicker(
            day = to,
            onDismiss = { picking = null },
            onPick = {
                to = it
                picking = null
            },
        )
    }
}

private enum class PickTarget { FROM, TO }

/**
 * One asked-for file.
 *
 * `GET /v1/exports` already returns only the kinds the caller may collect
 * (#581), so there is no role logic here — a second opinion about who may see
 * what is a second place for it to be wrong.
 */
@Composable
private fun ExportRow(row: DataExport, onDownload: (String) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                requestedLabel(row) ?: "Export",
                style = MaterialTheme.typography.bodyMedium,
            )
            ReadOnlyLine(statusLine(row))
        }
        // A download appears only when there is something to download. A ready
        // export whose files have expired lists none, and the server says so by
        // sending an empty list rather than a link that 404s.
        val file = row.files.firstOrNull()
        if (file != null) {
            TextButton(onClick = { onDownload(file.url) }) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text("Download")
            }
        }
    }
}

/** What the server is doing with this row, in the reader's words rather than the column's. */
internal fun statusLine(row: DataExport): String = when (row.status) {
    "pending" -> "Queued."
    "running" -> "Being put together…"
    // The server's own sentence first: it knows what went wrong and this app
    // does not.
    "failed" -> row.error ?: "That one could not be built."
    "ready" -> if (row.files.isEmpty()) "Ready, but the file has expired." else "Ready."
    else -> row.status
}

private fun requestedLabel(row: DataExport): String? {
    val requested = row.requested_at ?: return null
    return runCatching {
        Instant.parse(requested).atZone(ZoneId.systemDefault()).format(REQUESTED_FORMAT)
    }.getOrNull()
}

/**
 * A day, as a control that opens the picker this app already uses everywhere
 * else (tasks, send-later, snooze). Not a new idiom, and not a free-text field:
 * a typed date is a validation problem the platform already solved.
 */
@Composable
private fun DayField(
    label: String,
    day: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        ReadOnlyLine(label)
        OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(day) }
    }
}

@Composable
private fun DayPicker(day: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    // The picker works in UTC millis, so the day travels through it as a day
    // rather than as an instant that could land on either side of midnight.
    val initialMillis = runCatching {
        LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    }.getOrNull()
    val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = state.selectedDateMillis != null,
                onClick = {
                    val millis = state.selectedDateMillis ?: return@TextButton
                    onPick(
                        Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC)
                            .toLocalDate()
                            .toString(),
                    )
                },
            ) { Text("Use this day") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) { DatePicker(state = state) }
}
