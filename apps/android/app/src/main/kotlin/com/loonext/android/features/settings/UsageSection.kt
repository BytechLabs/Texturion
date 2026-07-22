package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Usage
import com.loonext.android.core.model.UsageMonth
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** #85/#95: meters warn at the SAME 80% the usage-alert emails fire at. */
private const val METER_WARN_RATIO = 0.8

private val PERIOD_FORMAT = DateTimeFormatter.ofPattern("MMM d")

private fun periodRange(usage: Usage): String? {
    val start = usage.period_start ?: return null
    val end = usage.period_end ?: return null
    fun fmt(iso: String): String? = runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).format(PERIOD_FORMAT)
    }.getOrNull()
    val a = fmt(start) ?: return null
    val b = fmt(end) ?: return null
    return "$a to $b"
}

/** "2026-03" → "Mar". */
private fun monthLabel(month: String): String = runCatching {
    LocalDate.parse("$month-01").format(DateTimeFormatter.ofPattern("MMM"))
}.getOrDefault(month)

/**
 * Usage (#157): hero tabular figures, the segments meter (petrol, amber at
 * 80%), the overage projection, voice minutes, the free storage line, the
 * 6-month history bars, and the owner-only overage-cap chips.
 */
@Composable
fun UsageSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    var state by remember(scope.companyId) { mutableStateOf<LoadState<Usage>>(LoadState.Loading) }
    var refreshKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(scope.companyId, refreshKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            LoadState.Ready(scope.repo.usage(scope.companyId))
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading(Modifier.padding(vertical = 48.dp))
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val usage = current.value
            if (company.plan == null || usage.included_segments == 0L) {
                SettingsCard(title = "Usage") {
                    Text(
                        "No usage yet. Finish setup under Billing to pick a plan and " +
                            "get your number.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                return
            }
            MessagesCard(usage)
            if (usage.overage_projection.trending_over) ProjectionCard(usage)
            VoiceCard(usage)
            StorageCard(usage)
            if (usage.history.isNotEmpty()) HistoryCard(usage.history)
            CapCard(scope, company, usage, onCompanyUpdated)
            CountingExplainer()
        }
    }
}

@Composable
private fun MessagesCard(usage: Usage) {
    val ratio =
        if (usage.included_segments > 0) {
            usage.used_segments.toDouble() / usage.included_segments
        } else {
            0.0
        }
    val warning = ratio >= METER_WARN_RATIO

    SettingsCard(title = "Messages") {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                groupDigits(usage.used_segments),
                style = MaterialTheme.typography.displaySmall.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "of ${groupDigits(usage.included_segments)} included messages used",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }
        periodRange(usage)?.let { range ->
            Text(
                range,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(10.dp))
        Meter(ratio = ratio, warning = warning)
        Spacer(Modifier.height(10.dp))
        if (usage.overage_segments > 0) {
            Text(
                "${groupDigits(usage.overage_segments)} over your included amount: " +
                    "${formatCents(usage.projected_overage_cents)} in overage on your " +
                    "next invoice.",
                style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            Text(
                "No overage this period. $0.00 extra so far.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val pausePoint = usage.cap_segments ?: capSegments(usage.included_segments, null)
        Text(
            "Sending pauses at ${groupDigits(pausePoint)} messages" +
                (if (usage.cap_segments == null) {
                    ", the maximum, which is 10 times your included messages."
                } else {
                    "."
                }),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (usage.inbound_segments > 0) {
            Text(
                "${groupDigits(usage.inbound_segments)} messages received this period. " +
                    "Inbound is always free.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Meter(ratio: Double, warning: Boolean, modifier: Modifier = Modifier) {
    val fraction = ratio.coerceIn(0.0, 1.0).toFloat()
    Box(
        modifier
            .fillMaxWidth()
            .height(10.dp)
            .background(
                MaterialTheme.colorScheme.surfaceContainerHigh,
                RoundedCornerShape(percent = 50),
            ),
    ) {
        if (fraction > 0f) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction)
                    .background(
                        if (warning) BrandColor.Amber else MaterialTheme.colorScheme.primary,
                        RoundedCornerShape(percent = 50),
                    ),
            )
        }
    }
}

@Composable
private fun ProjectionCard(usage: Usage) {
    SettingsCard(title = "Heads up") {
        Text(
            "You're on track to go past what your plan covers, about " +
                "${formatCents(usage.overage_projection.projected_overage_cents)} in " +
                "overage by the end of this period at the current pace. Extra messages " +
                "bill at the overage rate until sending pauses at your cap.",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun VoiceCard(usage: Usage) {
    val voice = usage.voice
    if (voice.included_minutes <= 0 && voice.used_minutes <= 0) return
    val ratio =
        if (voice.included_minutes > 0) {
            voice.used_minutes.toDouble() / voice.included_minutes
        } else {
            0.0
        }

    SettingsCard(title = "Calling minutes") {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                groupDigits(voice.used_minutes),
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "of ${groupDigits(voice.included_minutes)} included minutes used",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 3.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Meter(ratio = ratio, warning = ratio >= METER_WARN_RATIO)
        Spacer(Modifier.height(10.dp))
        if (voice.overage_minutes > 0) {
            Text(
                "${groupDigits(voice.overage_minutes)} extra minutes so far: " +
                    "${formatCents(voice.projected_overage_cents)} on your next invoice.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text(
            if (voice.overage_billed) {
                "Past your included minutes, extra minutes bill at 1¢ each. Calling " +
                    "pauses at your spending cap, never mid-call."
            } else {
                "Extra minutes aren't billed on your plan."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StorageCard(usage: Usage) {
    val total = usage.storage.attachments_bytes + usage.storage.mms_bytes
    SettingsCard(title = "Storage") {
        Text(
            "Photos and attachments use ${formatBytes(total)}. Storage is free " +
                "and never adds to your bill.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun HistoryCard(history: List<UsageMonth>) {
    val months = history.takeLast(6)
    val max = months.maxOf { it.segments }.coerceAtLeast(1)

    SettingsCard(
        title = "Last 6 months",
        description = "Outbound messages by calendar month.",
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(120.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            months.forEach { month ->
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Bottom,
                    modifier = Modifier.fillMaxHeight(),
                ) {
                    Text(
                        groupDigits(month.segments),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(2.dp))
                    val fraction = (month.segments.toFloat() / max).coerceIn(0.02f, 1f)
                    Box(
                        Modifier
                            .width(30.dp)
                            .fillMaxHeight(fraction * 0.7f)
                            .background(
                                MaterialTheme.colorScheme.primary.copy(
                                    alpha = if (month == months.last()) 1f else 0.45f,
                                ),
                                RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp),
                            ),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        monthLabel(month.month),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun CapCard(
    scope: SettingsScope,
    company: CompanyView,
    usage: Usage,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val isOwner = SettingsRoleGate.canChangeOverageCap(scope.role)
    val current = normalizeCapMultiplier(company.overageCapMultiplier)
    var proposed by remember { mutableStateOf<Double?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "Overage cap",
        description = "The cap is a multiple of your included messages. When you hit " +
            "it, sending pauses until you raise it. Nothing is billed past it.",
    ) {
        if (!isOwner) {
            ReadOnlyLine(
                "Overage cap: ${capLabel(current)} your included messages. " +
                    "Only the account owner can change it.",
            )
        } else {
            val presets =
                if (CAP_PRESETS.contains(current)) CAP_PRESETS
                else listOf(current) + CAP_PRESETS
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                presets.forEach { preset ->
                    FilterChip(
                        selected = preset == current,
                        onClick = {
                            val change =
                                describeCapChange(current, preset, usage.included_segments)
                            if (change.requiresConfirmation) {
                                error = null
                                proposed = preset
                            }
                        },
                        label = { Text(capLabel(preset)) },
                        enabled = !saving,
                    )
                }
            }
        }
    }

    val next = proposed
    if (next != null) {
        val change = describeCapChange(current, next, usage.included_segments)
        ConfirmDialog(
            title = change.title,
            body = change.summary,
            confirmLabel = "Set the cap",
            pending = saving,
            error = error,
            onDismiss = { proposed = null },
            onConfirm = {
                saving = true
                error = null
                coroutines.launch {
                    try {
                        val updated = scope.repo.updateCompany(
                            scope.companyId,
                            buildJsonObject { put("overage_cap_multiplier", next) },
                        )
                        onCompanyUpdated(updated)
                        proposed = null
                        scope.showMessage("Overage cap set to ${capLabel(next)}.")
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
private fun CountingExplainer() {
    SettingsCard(title = "How messages are counted") {
        Text(
            "A text up to 160 characters counts as one message; longer texts split " +
                "into 160-character segments (70 with emoji or accents). A photo " +
                "message counts as three. Incoming messages are always free.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
