package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.AiFeatureUsage
import com.loonext.android.core.model.UsageStorage
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Usage
import com.loonext.android.core.model.UsageMonth
import com.loonext.android.core.model.UsageStatus
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.material3.Button
import androidx.compose.material3.Slider
import kotlin.math.roundToInt

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
 * Usage (#157, re-rendered for #178): the fair-use section. The server's
 * `status` decides everything the customer sees, so product and marketing say
 * the same thing:
 *
 *  - 'quiet' (the overwhelming default): one calm line and the fair-use
 *    policy link. No meters, no "X of Y", no progress bars anywhere.
 *  - 'pacing': the early, specific heads-up naming what runs hot and the
 *    projected extra, with the spending cap framed as the protection it is.
 *  - 'capped': how close the owner-set cap is and what pauses there.
 *
 * The raw numbers, 6-month history, and storage live behind the owner-only
 * "Details" affordance, collapsed by default in every status. The owner cap
 * control stays reachable in all three.
 */
@Composable
fun UsageSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    var refreshKey by remember { mutableIntStateOf(0) }
    // #176 cache-first: paints instantly from StoreCache after the first
    // in-process fetch; refreshKey bumps revalidate silently.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.usage(scope.companyId),
        refreshKey = refreshKey,
    ) { scope.repo.usage(scope.companyId) }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 3)
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
            val isOwner = SettingsRoleGate.canChangeOverageCap(scope.role)
            when (usage.status) {
                UsageStatus.CAPPED -> CappedCard(usage)
                UsageStatus.PACING -> PacingCard(usage)
                else -> QuietCard()
            }
            // #426: the question that comes before cancelling. Above the cap
            // because "are my texts landing" outranks "what will this cost"
            // for somebody who is already worried.
            DeliveryCard(usage)
            // Reachable in every status, for every role, as on the web. #178
            // says usage is never a wall, and this is not one: it is a plain
            // line saying what the cap is and who can change it. Hiding it from
            // members until they were already pacing meant the one question a
            // member has about the bill had no answer on the calm day.
            run {
                CapCard(scope, company, usage) { updated ->
                    onCompanyUpdated(updated)
                    // The cap lives in both views. Revalidate the cached usage
                    // silently so the pause point reflects the new multiplier.
                    refreshKey++
                }
            }
            if (isOwner) DetailsCard(usage)
        }
    }
}

/** 'quiet': the calm fair-use line, echoing the marketing promise verbatim. */
@Composable
private fun QuietCard() {
    val context = LocalContext.current
    SettingsCard(title = "Usage") {
        Text(
            "Well within fair use this month. Almost every crew stays inside " +
                "what their plan covers, and we reach out early if usage ever " +
                "paces past it.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = { openExternal(context, FAIR_USE_URL) }) {
            Text("See the fair use policy")
        }
    }
}

/** 'pacing': the early heads-up. Specific about what and how much, never alarmed. */
@Composable
private fun PacingCard(usage: Usage) {
    val projected = usage.overage_projection.projected_overage_cents
    SettingsCard(title = "Heads up") {
        Text(
            "${pacingSubject(usage)} are pacing past what your plan includes " +
                "this period." +
                if (projected > 0) {
                    " At the current pace, that adds about ${formatCents(projected)} " +
                        "in overage to your next invoice."
                } else {
                    ""
                },
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "This is the early flag, not a surprise bill. Your spending cap " +
                "below is the backstop: sending and calling pause there, and " +
                "nothing bills past it.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** 'capped': the owner-set cap is close or reached. Plain about what pauses. */
@Composable
private fun CappedCard(usage: Usage) {
    val reached = capUseRatio(usage) >= 1.0
    SettingsCard(
        title = if (reached) "At your spending cap" else "Approaching your spending cap",
    ) {
        Text(
            if (reached) {
                "You've reached the spending cap you set. Sending and calling " +
                    "are paused until you raise the cap. Nothing bills past it."
            } else {
                "You've used ${capUsePercent(usage)}% of the spending cap you " +
                    "set. At the cap, sending and calling pause until you " +
                    "raise it. Nothing bills past it."
            },
            style = MaterialTheme.typography.bodyMedium,
        )
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
    val haptics = rememberHaptics()

    SettingsCard(
        title = "Spending cap",
        description = "Your protection against surprise bills. The cap is a " +
            "multiple of your included usage. At the cap, sending and calling " +
            "pause until you raise it. Nothing bills past it.",
    ) {
        if (!isOwner) {
            ReadOnlyLine(
                "Spending cap: ${capLabel(current)} your included usage. " +
                    "Only the account owner can change it.",
            )
        } else {
            // A slider, matching the web: the multiple is the mechanism but the
            // pause point is the decision, so it reads largest and counts as
            // you drag. Presets could not express 4.5x at all, which is the
            // parity gap this closes.
            var pending by remember(current) { mutableStateOf(current) }
            val pauseAt = capSegments(usage.included_segments, pending)
            val dirty = pending != current

            Column {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text(
                            "SENDING PAUSES AT",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            groupDigits(pauseAt),
                            style = MaterialTheme.typography.headlineSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            "messages this period",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        capLabel(pending),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }

                Slider(
                    value = pending.toFloat(),
                    onValueChange = { value -> pending = Math.round(value * 2.0) / 2.0 },
                    valueRange = 1f..MAX_CAP_MULTIPLIER.toFloat(),
                    // Half-multiples: fine enough to land where you want,
                    // coarse enough to aim at with a thumb.
                    steps = ((MAX_CAP_MULTIPLIER - 1.0) * 2).toInt() - 1,
                    enabled = !saving,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "1x included",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${capLabel(MAX_CAP_MULTIPLIER)} max",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                // Dragging proposes; it never saves. Money changes on purpose.
                if (dirty) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        describeCapChange(current, pending, usage.included_segments).summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                haptics.tap()
                                error = null
                                proposed = pending
                            },
                            enabled = !saving,
                        ) { Text(if (saving) "Saving…" else "Save cap") }
                        TextButton(
                            onClick = { pending = current },
                            enabled = !saving,
                        ) { Text("Cancel") }
                    }
                }
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
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
                        haptics.confirm()
                        scope.showMessage("Spending cap set to ${capLabel(next)}.")
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

/**
 * What the workspace is storing, named by kind.
 *
 * The old line added two figures together and called the result "photos and
 * attachments", which left voicemail recordings out of the total entirely and
 * called an audio message a photo. Every kind is listed now, including a
 * catch-all that only appears when something is unaccounted for, so the parts
 * can never quietly add up to less than what is really held.
 *
 * Deliberately NOT a meter: storage is free and capless, so there is no maximum
 * to fill and no remaining to run out of.
 */
/**
 * What Lou has done this month, per feature.
 *
 * These limits were enforced server-side and shown nowhere: a crew reached one
 * mid-sentence, got a message saying that one thing had stopped, and had no way
 * to have seen it coming. Unlike storage this IS a meter, because an AI limit
 * is a hard stop rather than a fair-use line.
 */
@Composable
private fun AiUsageBars(features: List<AiFeatureUsage>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (feature in features) {
            val pct =
                if (feature.cap > 0) {
                    ((feature.used.toDouble() / feature.cap) * 100).toInt().coerceIn(0, 100)
                } else {
                    0
                }
            // Say it before it bites, where the number already lives.
            val nearCap = feature.enabled && pct >= 80
            Column {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        feature.label.replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        if (feature.enabled) "${feature.used} of ${feature.cap}" else "Off",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(if (feature.enabled) pct / 100f else 0f)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(3.dp))
                            .background(
                                if (nearCap) {
                                    MaterialTheme.colorScheme.tertiary
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                            ),
                    )
                }
                if (nearCap) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Close to this month's limit. It resets on the 1st.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }
        }
    }
}

@Composable
private fun StorageBreakdown(storage: UsageStorage) {
    val rows = listOf(
        "Attachments received" to storage.received_media_bytes,
        "Attachments sent" to storage.sent_media_bytes,
        "Files on notes" to storage.attachments_bytes,
        "Voicemail recordings" to storage.voicemail_bytes,
        "Other files" to storage.other_bytes,
    ).filter { (label, bytes) -> bytes > 0 || label != "Other files" }

    DetailLine(
        "${formatBytes(storage.totalStored)} stored. Free on every plan, no caps.",
    )
    Spacer(Modifier.height(6.dp))
    rows.forEach { (label, bytes) ->
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                formatBytes(bytes),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The owner-only "Details" affordance (#178): a quiet expandable row,
 * collapsed by default in every status, holding the raw numbers, the 6-month
 * history bars, storage, and the counting explainer. Explicitly opened, so
 * "X of Y" is welcome inside.
 */
@Composable
private fun DetailsCard(usage: Usage) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val haptics = rememberHaptics()

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(12.dp),
            ),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable {
                    haptics.tap()
                    expanded = !expanded
                }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Details", style = MaterialTheme.typography.titleMedium)
                Text(
                    "The raw numbers, month by month, if you want them.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "Hide the numbers" else "Show the numbers",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                MessagesDetail(usage)
                Spacer(Modifier.height(14.dp))
                VoiceDetail(usage)
                Spacer(Modifier.height(14.dp))
                DetailHeader("Storage")
                StorageBreakdown(usage.storage)
                if (usage.ai.isNotEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    DetailHeader("Lou this month")
                    DetailLine(
                        "What Lou has drafted, filled in, and written down. " +
                            "Each resets on the 1st.",
                    )
                    Spacer(Modifier.height(8.dp))
                    AiUsageBars(usage.ai)
                }
                if (usage.history.isNotEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    DetailHeader("Last 6 months")
                    DetailLine("Outbound messages by calendar month.")
                    Spacer(Modifier.height(8.dp))
                    HistoryBars(usage.history)
                }
                Spacer(Modifier.height(14.dp))
                DetailHeader("How messages are counted")
                DetailLine(
                    "A text up to 160 characters counts as one message; longer texts " +
                        "split into 160-character segments (70 with emoji or accents). " +
                        "A photo message counts as three. Incoming messages are always " +
                        "free.",
                )
            }
        }
    }
}

@Composable
private fun MessagesDetail(usage: Usage) {
    DetailHeader("Messages")
    val range = periodRange(usage)
    DetailLine(
        "${groupDigits(usage.used_segments)} of " +
            "${groupDigits(usage.included_segments)} included messages used" +
            (range?.let { ", $it" } ?: "") + ".",
    )
    if (usage.overage_segments > 0) {
        DetailLine(
            "${groupDigits(usage.overage_segments)} over your included amount: " +
                "${formatCents(usage.projected_overage_cents)} in overage on your " +
                "next invoice.",
        )
    } else {
        DetailLine("No overage this period. $0.00 extra so far.")
    }
    val pausePoint = usage.cap_segments ?: capSegments(usage.included_segments, null)
    DetailLine(
        "Sending pauses at ${groupDigits(pausePoint)} messages" +
            (if (usage.cap_segments == null) {
                ", the maximum, which is 10 times your included messages."
            } else {
                "."
            }),
    )
    if (usage.inbound_segments > 0) {
        DetailLine(
            "${groupDigits(usage.inbound_segments)} messages received this period. " +
                "Inbound is always free.",
        )
    }
}

@Composable
private fun VoiceDetail(usage: Usage) {
    val voice = usage.voice
    if (voice.included_minutes <= 0 && voice.used_minutes <= 0) return
    DetailHeader("Calling minutes")
    DetailLine(
        "${groupDigits(voice.used_minutes)} of " +
            "${groupDigits(voice.included_minutes)} included minutes used.",
    )
    if (voice.overage_minutes > 0) {
        DetailLine(
            "${groupDigits(voice.overage_minutes)} extra minutes so far: " +
                "${formatCents(voice.projected_overage_cents)} on your next invoice.",
        )
    }
    DetailLine(
        if (voice.overage_billed) {
            "Past your included minutes, extra minutes bill at 1¢ each. Calling " +
                "pauses at your spending cap, never mid-call."
        } else {
            "Extra minutes aren't billed on your plan."
        },
    )
}

@Composable
private fun DetailHeader(label: String) {
    Text(label, style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun DetailLine(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = 1.dp),
    )
}

@Composable
private fun HistoryBars(history: List<UsageMonth>) {
    val months = history.takeLast(6)
    val max = months.maxOf { it.segments }.coerceAtLeast(1)

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

/** Human name for a destination bucket. */
private fun countryLabel(code: String): String = when (code) {
    "US" -> "United States"
    "CA" -> "Canada"
    else -> "Elsewhere"
}

/**
 * #426 — "are my texts arriving?"
 *
 * The largest single reason buyers leave a texting provider is the suspicion
 * that messages are not landing, and a customer had no way to check. The
 * suspicion is what moves them, and it was unfalsifiable, so it won by default.
 *
 * SMALL NUMBERS LIE, so below the sample floor the API sends a null rate and
 * this shows COUNTS. One failure out of forty reads as 2.5%, which looks
 * alarming and usually means a disconnected number — manufacturing the exact
 * worry the figure exists to remove.
 *
 * CARRIER-REPORTED is the honest name: a receipt means a carrier acknowledged
 * handoff, not that a person read it.
 */
@Composable
private fun DeliveryCard(usage: Usage) {
    val delivery = usage.delivery ?: return
    if (delivery.delivered + delivery.failed + delivery.pending == 0L) return

    val countries = delivery.by_country.filter {
        it.delivered + it.failed + it.pending > 0L
    }

    SettingsCard(
        title = "Are your texts arriving?",
        description = "Carrier-reported delivery this period. A carrier confirming it " +
            "took the message is not the same as someone reading it, so this is the " +
            "most we can honestly tell you.",
    ) {
        Text(
            buildString {
                append("${delivery.delivered} confirmed delivered")
                if (delivery.failed > 0) append(" · ${delivery.failed} didn't get through")
                if (delivery.pending > 0) append(" · ${delivery.pending} still on their way")
            },
            style = MaterialTheme.typography.bodyMedium,
        )
        // Only split when there IS more than one destination — a single-country
        // shop does not need a table telling it every text went to Canada.
        if (countries.size > 1) {
            Spacer(Modifier.height(8.dp))
            countries.forEach { row ->
                ReadOnlyLine(
                    "${countryLabel(row.country)}: " +
                        if (row.rate == null) {
                            "${row.delivered} of ${row.delivered + row.failed}"
                        } else {
                            "${(row.rate * 100).roundToInt()}%"
                        },
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        ReadOnlyLine(
            if (delivery.failed > 0) {
                "A text that doesn't get through is usually a disconnected number " +
                    "or a handset that has been off for days. Open the conversation " +
                    "and the message itself says what the carrier reported."
            } else {
                "Nothing has bounced this period."
            },
        )
    }
}
