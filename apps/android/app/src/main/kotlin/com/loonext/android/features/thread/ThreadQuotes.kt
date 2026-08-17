package com.loonext.android.features.thread

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.features.quotes.QUOTE_STATUS_KEYS
import com.loonext.android.features.quotes.Quote
import com.loonext.android.features.quotes.QuoteStatus
import com.loonext.android.features.quotes.Quotes
import com.loonext.android.features.quotes.QuotesRepository
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #287 — what this thread has been quoted, and the way to quote it.
 *
 * ## Why a strip beside the composer rather than a bubble
 *
 * The same reasoning #224's payment strip settled, and it applies harder here.
 * The message carrying the quote link is already in the transcript exactly as
 * the customer received it. What is NOT in the transcript is the STATE — sent,
 * opened, accepted, lapsed — and three of those four change with nobody in the
 * workspace doing anything. A bubble would have to mutate after the fact, which
 * is the one thing a transcript must never do.
 *
 * ## The status it renders
 *
 * [Quote.shownStatus], never the stored column and never the wire's
 * `effective_status`. Nothing writes `expired`, and a derived string is only as
 * fresh as the read that brought it — see QuotesData.kt.
 *
 * ## The form
 *
 * *Smart Defaults*: the expiry is pre-filled at 14 days. It is the one field
 * whose answer a crew member does not care about and cannot leave blank, so
 * asking them to type it is pure friction; the amount and the work are theirs
 * and are deliberately empty, because a default price is a wrong price.
 *
 * *Ethical Friction, calibrated*: creating is not sending. A draft costs
 * nothing and is invisible to the customer, so it needs no ceremony. SEND is
 * the customer-visible act that binds a price, so the button carries the amount
 * rather than saying "Send" — you cannot press it without the figure in your
 * eye.
 *
 * Mirrors apps/web/src/components/thread/quote-strip.tsx.
 */

/** Rows worth keeping above the composer: live, or decided in the last week. */
private const val RECENT_DECISION_MS = 7L * 24 * 60 * 60 * 1000

/** The expiry a crew member does not have to think about. */
private const val DEFAULT_EXPIRY_DAYS = 14L

private fun isWorthShowing(quote: Quote, now: Long): Boolean {
    if (!Quotes.isDecided(quote.shownStatus(now))) return true
    val decided = quote.decided_at?.let {
        runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
    } ?: return false
    return now - decided < RECENT_DECISION_MS
}

@Composable
fun ThreadQuotes(
    graph: AppGraph,
    companyId: String,
    conversationId: String,
    /**
     * May this reader act? A view-only observer (#315) still SEES what the
     * thread was quoted — that is a fact about the conversation they are here
     * to read — and is offered no way to add or send one.
     */
    canAct: Boolean,
    onNotice: (String) -> Unit,
    /** A sent quote goes out as an ordinary text the timeline does not know of. */
    onSent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { QuotesRepository(graph.api) }
    var refreshKey by remember { mutableIntStateOf(0) }
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.quotes(companyId, conversationId),
        refreshKey = refreshKey,
    ) { repo.forConversation(companyId, conversationId).data }

    val rows = (state as? LoadState.Ready)?.value ?: emptyList()

    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    var open by remember { mutableStateOf(false) }
    var amount by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var sendingId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val now = System.currentTimeMillis()
    val shown = rows.filter { isWorthShowing(it, now) }

    // Absent entirely when there is nothing to say and nothing to offer. A
    // strip reserving space on every thread for something almost no thread has
    // is a permanent cost paid for a rare event.
    if (shown.isEmpty() && !canAct) return

    fun create() {
        val dollars = amount.replace(Regex("[^0-9.]"), "").toDoubleOrNull()
        if (dollars == null || dollars <= 0) {
            onNotice(AppStrings.translate(locale, "quotes.needAmount"))
            return
        }
        if (description.isBlank()) {
            onNotice(AppStrings.translate(locale, "quotes.needDescription"))
            return
        }
        busy = true
        coroutines.launch {
            try {
                repo.create(
                    companyId = companyId,
                    conversationId = conversationId,
                    amountCents = Math.round(dollars * 100).toInt(),
                    description = description.trim(),
                    expiresAt = java.time.Instant
                        .ofEpochMilli(now + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
                        .toString(),
                )
                amount = ""
                description = ""
                open = false
                refreshKey++
            } catch (cause: Exception) {
                onNotice(cause.userMessage(locale))
            } finally {
                busy = false
            }
        }
    }

    fun send(id: String) {
        sendingId = id
        coroutines.launch {
            try {
                repo.send(companyId, id)
                haptics.confirm()
                refreshKey++
                onSent()
            } catch (cause: Exception) {
                onNotice(cause.userMessage(locale))
            } finally {
                sendingId = null
            }
        }
    }

    Column(modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        shown.forEach { quote ->
            QuoteRow(
                quote = quote,
                now = now,
                canSend = canAct,
                sending = sendingId == quote.id,
                onSend = { send(quote.id) },
            )
        }

        if (canAct && !open) {
            TextButton(onClick = { open = true }) {
                Icon(
                    Icons.Outlined.Description,
                    contentDescription = null,
                    modifier = Modifier.padding(end = 4.dp),
                )
                Text(t("quotes.newQuote"), fontSize = 13.sp)
            }
        }

        if (canAct && open) {
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text(t("quotes.amountLabel")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(0.4f),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text(t("quotes.descriptionLabel")) },
                    singleLine = true,
                    modifier = Modifier.weight(0.6f),
                )
            }
            // The default, said out loud rather than hidden in a field nobody
            // filled in. A price with no expiry binds the business forever.
            Text(
                t("quotes.expiresInDays", "days" to DEFAULT_EXPIRY_DAYS.toString()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = ::create, enabled = !busy) {
                    Text(
                        if (busy) t("quotes.saving") else t("quotes.saveDraft"),
                        fontSize = 13.sp,
                    )
                }
                TextButton(onClick = { open = false }) {
                    Text(t("common.cancel"), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun QuoteRow(
    quote: Quote,
    now: Long,
    canSend: Boolean,
    sending: Boolean,
    onSend: () -> Unit,
) {
    val status = quote.shownStatus(now)
    // The row carries its own currency, the way a payment request does: a quote
    // is denominated when it is written, and a workspace that later changes
    // billing currency must not restate old prices.
    val money = formatMoney(quote.amount_cents, quote.money)

    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.Outlined.Description,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(money, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(
            quote.description,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            t(QUOTE_STATUS_KEYS[status] ?: "quotes.statusDraft"),
            fontSize = 13.sp,
            color = when (status) {
                QuoteStatus.ACCEPTED -> MaterialTheme.colorScheme.primary
                QuoteStatus.EXPIRED, QuoteStatus.DECLINED ->
                    MaterialTheme.colorScheme.onSurfaceVariant
                else -> MaterialTheme.colorScheme.onSurface
            },
        )
        if (status == QuoteStatus.DRAFT && canSend) {
            // The amount rides on the button: this is the act the customer
            // sees, and it binds a price.
            TextButton(onClick = onSend, enabled = !sending) {
                Icon(
                    Icons.Outlined.Send,
                    contentDescription = null,
                    modifier = Modifier.padding(end = 4.dp),
                )
                Text(
                    if (sending) t("quotes.sending") else t("quotes.sendFor", "amount" to money),
                    fontSize = 13.sp,
                )
            }
        }
    }
}
