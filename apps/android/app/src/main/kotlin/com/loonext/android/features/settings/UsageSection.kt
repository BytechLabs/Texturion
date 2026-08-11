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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
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
                SettingsCard(title = t("settingsMore.usageTitle")) {
                    Text(
                        t("settingsMore.usageNone"),
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
            // #595: the file behind the meters, for whoever does the books.
            // Gates itself on `billing.manage` — the section already needs that
            // capability to be reachable, and the card asking again is what
            // keeps the answer in one place rather than at the call site.
            UsageExportCard(scope)
        }
    }
}

/** 'quiet': the calm fair-use line, echoing the marketing promise verbatim. */
@Composable
private fun QuietCard() {
    val context = LocalContext.current
    SettingsCard(title = t("settingsMore.usageTitle")) {
        Text(
            t("settingsMore.usageQuiet"),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(4.dp))
        LinkButton(onClick = { openExternal(context, FAIR_USE_URL) }) {
            Text(t("settingsMore.seeFairUse"))
        }
    }
}

/** 'pacing': the early heads-up. Specific about what and how much, never alarmed. */
@Composable
private fun PacingCard(usage: Usage) {
    val projected = usage.overage_projection.projected_overage_cents
    SettingsCard(title = t("settingsMore.headsUp")) {
        Text(
            t(
                "settingsMore.pacingBody",
                "subject" to t(pacingSubjectKey(usage)),
            ) + if (projected > 0) {
                t("settingsMore.pacingProjection", "amount" to formatCents(projected))
            } else {
                ""
            },
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            t("settingsMore.pacingReassurance"),
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
        title = if (reached) {
            t("settingsMore.atCapTitle")
        } else {
            t("settingsMore.nearCapTitle")
        },
    ) {
        Text(
            if (reached) {
                t("settingsMore.atCapBody")
            } else {
                t("settingsMore.nearCapBody", "percent" to "${capUsePercent(usage)}")
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
    val locale = LocalAppLocale.current

    SettingsCard(
        title = t("settingsMore.spendingCap"),
        description = t("settingsMore.spendingCapDesc"),
    ) {
        if (!isOwner) {
            ReadOnlyLine(
                t("settingsMore.capReadOnly", "cap" to capLabel(current)),
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
                            t("settingsMore.sendingPausesAt"),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            groupDigits(pauseAt),
                            style = MaterialTheme.typography.headlineSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            t("settingsMore.messagesThisPeriod"),
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
                        t("settingsMore.oneTimesIncluded"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        t("settingsMore.capMax", "cap" to capLabel(MAX_CAP_MULTIPLIER)),
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
                        ) {
                            Text(
                                if (saving) {
                                    t("common.saving")
                                } else {
                                    t("settingsMore.saveCap")
                                },
                            )
                        }
                        LinkButton(
                            onClick = { pending = current },
                            enabled = !saving,
                        ) { Text(t("common.cancel")) }
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
            confirmLabel = t("settingsMore.setTheCap"),
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
                        scope.showMessage(
                            AppStrings.translate(
                                locale,
                                "settingsMore.capSetTo",
                                mapOf("cap" to capLabel(next)),
                            ),
                        )
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
                        if (feature.enabled) {
                            t(
                                "settingsMore.usedOfCap",
                                "used" to "${feature.used}",
                                "cap" to "${feature.cap}",
                            )
                        } else {
                            t("settingsMore.off")
                        },
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
                        t("settingsMore.aiNearLimit"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
                // #431 ask 3: what it bought, under what it cost. An empty list
                // is NOT zeroes — a feature used 40 times with nothing recorded
                // is an instrumentation gap, and "0 sent as written" would
                // report that gap as a verdict on the quality.
                val outcomeLine =
                    if (feature.enabled && feature.outcomesRecorded > 0) {
                        feature.outcomes.joinToString(" · ") { "${it.count} ${it.label}" }
                    } else if (feature.enabled && feature.used > 0) {
                        t("settingsMore.aiNoOutcomes")
                    } else {
                        null
                    }
                if (outcomeLine != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        outcomeLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun StorageBreakdown(storage: UsageStorage) {
    // The CATCH-ALL is filtered on its key rather than on its words: comparing
    // two translated labels is a test that quietly stops matching in French.
    val rows = listOf(
        "settingsMore.storageReceived" to storage.received_media_bytes,
        "settingsMore.storageSent" to storage.sent_media_bytes,
        "settingsMore.storageNotes" to storage.attachments_bytes,
        "settingsMore.storageVoicemail" to storage.voicemail_bytes,
        "settingsMore.storageOther" to storage.other_bytes,
    ).filter { (key, bytes) -> bytes > 0 || key != "settingsMore.storageOther" }

    DetailLine(
        t("settingsMore.storedFree", "size" to formatBytes(storage.totalStored)),
    )
    Spacer(Modifier.height(6.dp))
    rows.forEach { (key, bytes) ->
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                t(key),
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
                Text(
                    t("settingsMore.details"),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    t("settingsMore.detailsBlurb"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) {
                    t("settingsMore.hideNumbers")
                } else {
                    t("settingsMore.showNumbers")
                },
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                MessagesDetail(usage)
                Spacer(Modifier.height(14.dp))
                VoiceDetail(usage)
                Spacer(Modifier.height(14.dp))
                DetailHeader(t("settingsMore.storage"))
                StorageBreakdown(usage.storage)
                if (usage.ai.isNotEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    DetailHeader(t("settingsMore.louThisMonth"))
                    DetailLine(t("settingsMore.louThisMonthLine"))
                    Spacer(Modifier.height(8.dp))
                    AiUsageBars(usage.ai)
                }
                if (usage.history.isNotEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    DetailHeader(t("settingsMore.lastSixMonths"))
                    DetailLine(t("settingsMore.lastSixMonthsLine"))
                    Spacer(Modifier.height(8.dp))
                    HistoryBars(usage.history)
                }
                Spacer(Modifier.height(14.dp))
                DetailHeader(t("settingsMore.howCounted"))
                DetailLine(t("settingsMore.howCountedLine"))
            }
        }
    }
}

@Composable
private fun MessagesDetail(usage: Usage) {
    DetailHeader(t("settingsMore.messages"))
    val range = periodRange(usage)
    DetailLine(
        t(
            "settingsMore.messagesUsed",
            "used" to groupDigits(usage.used_segments),
            "included" to groupDigits(usage.included_segments),
            "range" to (range?.let { t("settingsMore.commaRange", "range" to it) } ?: ""),
        ),
    )
    if (usage.overage_segments > 0) {
        DetailLine(
            t(
                "settingsMore.messagesOverage",
                "over" to groupDigits(usage.overage_segments),
                "amount" to formatCents(usage.projected_overage_cents),
            ),
        )
    } else {
        DetailLine(t("settingsMore.messagesNoOverage"))
    }
    val pausePoint = usage.cap_segments ?: capSegments(usage.included_segments, null)
    DetailLine(
        t("settingsMore.messagesPauseAt", "count" to groupDigits(pausePoint)) +
            if (usage.cap_segments == null) {
                t("settingsMore.messagesPauseMax")
            } else {
                t("settingsMore.fullStop")
            },
    )
    if (usage.inbound_segments > 0) {
        DetailLine(
            t(
                "settingsMore.messagesInbound",
                "count" to groupDigits(usage.inbound_segments),
            ),
        )
    }
}

@Composable
private fun VoiceDetail(usage: Usage) {
    val voice = usage.voice
    if (voice.included_minutes <= 0 && voice.used_minutes <= 0) return
    DetailHeader(t("settingsMore.callingMinutes"))
    DetailLine(
        t(
            "settingsMore.minutesUsed",
            "used" to groupDigits(voice.used_minutes),
            "included" to groupDigits(voice.included_minutes),
        ),
    )
    if (voice.overage_minutes > 0) {
        DetailLine(
            t(
                "settingsMore.minutesOverage",
                "extra" to groupDigits(voice.overage_minutes),
                "amount" to formatCents(voice.projected_overage_cents),
            ),
        )
    }
    DetailLine(
        if (voice.overage_billed) {
            t("settingsMore.minutesBilled")
        } else {
            t("settingsMore.minutesNotBilled")
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
@Composable
private fun countryLabel(code: String): String = when (code) {
    "US" -> t("settingsMore.countryUs")
    "CA" -> t("settingsMore.countryCa")
    else -> t("settingsMore.countryElsewhere")
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
        title = t("settingsMore.deliveryTitle"),
        description = t("settingsMore.deliveryDesc"),
    ) {
        val deliveredPart =
            t("settingsMore.deliveryDelivered", "count" to "${delivery.delivered}")
        val failedPart = if (delivery.failed > 0) {
            t("settingsMore.deliveryFailed", "count" to "${delivery.failed}")
        } else {
            ""
        }
        val pendingPart = if (delivery.pending > 0) {
            t("settingsMore.deliveryPending", "count" to "${delivery.pending}")
        } else {
            ""
        }
        Text(
            deliveredPart + failedPart + pendingPart,
            style = MaterialTheme.typography.bodyMedium,
        )
        // Only split when there IS more than one destination — a single-country
        // shop does not need a table telling it every text went to Canada.
        if (countries.size > 1) {
            Spacer(Modifier.height(8.dp))
            countries.forEach { row ->
                ReadOnlyLine(
                    t(
                        "settingsMore.deliveryByCountry",
                        "country" to countryLabel(row.country),
                        "figure" to if (row.rate == null) {
                            t(
                                "settingsMore.deliveryCounts",
                                "delivered" to "${row.delivered}",
                                "total" to "${row.delivered + row.failed}",
                            )
                        } else {
                            t(
                                "settingsMore.deliveryPercent",
                                "percent" to "${(row.rate * 100).roundToInt()}",
                            )
                        },
                    ),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        ReadOnlyLine(
            if (delivery.failed > 0) {
                t("settingsMore.deliveryFailureNote")
            } else {
                t("settingsMore.deliveryNothingBounced")
            },
        )
    }
}
