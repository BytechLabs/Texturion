package com.loonext.android.features.thread

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.loonext.android.core.model.allows
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.features.payments.Payments
import com.loonext.android.features.quotes.QUOTE_STATUS_KEYS
import com.loonext.android.features.quotes.Quote
import com.loonext.android.features.quotes.QuoteStatus
import com.loonext.android.features.quotes.Quotes
import com.loonext.android.features.quotes.QuotesRepository
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.ui.common.ConfirmDialog
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

private enum class QuoteDecision(val path: String, val label: String, val detail: String) {
    Withdraw("withdraw", "quotes.withdraw", "quotes.withdrawDetail"),
    Decline("decline", "quotes.markDeclined", "quotes.declineCrewDetail"),
    Undo("undo-acceptance", "quotes.undoAcceptance", "quotes.undoAcceptanceDetail"),
}

private data class PendingQuoteDecision(val id: String, val action: QuoteDecision)

private fun canUndoAcceptance(quote: Quote, now: Long): Boolean =
    quote.allowed_actions?.contains("undo_acceptance") == true &&
        (quote.expires_at?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L) > now

private fun isWorthShowing(quote: Quote, now: Long): Boolean {
    if (canUndoAcceptance(quote, now)) return true
    val status = quote.shownStatus(now)
    if (status != QuoteStatus.WITHDRAWN && !Quotes.isDecided(status)) return true
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
    quoteChangedTick: Int,
    /**
     * May this reader act? A view-only observer (#315) still SEES what the
     * thread was quoted — that is a fact about the conversation they are here
     * to read — and is offered no way to add or send one.
     */
    canAct: Boolean,
    draftOpen: Boolean,
    onCloseDraft: () -> Unit,
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
        refreshKey = refreshKey + quoteChangedTick,
    ) { repo.forConversation(companyId, conversationId).data }

    val rows = (state as? LoadState.Ready)?.value ?: emptyList()

    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    var amount by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var sendingId by remember { mutableStateOf<String?>(null) }
    var decision by remember { mutableStateOf<PendingQuoteDecision?>(null) }
    var deciding by remember { mutableStateOf(false) }
    var decisionError by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var editId by remember { mutableStateOf<String?>(null) }
    var deleteId by remember { mutableStateOf<String?>(null) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val now = System.currentTimeMillis()
    val shown = rows.filter { isWorthShowing(it, now) }
    val showForm = canAct && (draftOpen || editId != null)

    if (shown.isEmpty() && !showForm) return

    fun closeForm() {
        editId = null
        amount = ""
        description = ""
        onCloseDraft()
    }

    fun save() {
        val cents = Payments.parseAmountToCents(amount, locale)
        if (cents == null || cents <= 0) {
            onNotice(AppStrings.translate(locale, "quotes.needAmount"))
            return
        }
        if (description.isBlank()) {
            onNotice(AppStrings.translate(locale, "quotes.needDescription"))
            return
        }
        val quoteId = editId
        val work = description.trim()
        val expiry = java.time.Instant
            .ofEpochMilli(now + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
            .toString()
        busy = true
        coroutines.launch {
            try {
                if (quoteId == null) {
                    repo.create(companyId, conversationId, cents, work, expiry)
                } else {
                    repo.edit(companyId, quoteId, cents, work, expiry)
                }
                closeForm()
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

    fun decide(pending: PendingQuoteDecision) {
        val declineReason = reason.trim().takeIf { pending.action == QuoteDecision.Decline }
        deciding = true
        decisionError = null
        coroutines.launch {
            try {
                repo.decide(companyId, pending.id, pending.action.path, declineReason)
                haptics.confirm()
                decision = null
                refreshKey++
            } catch (cause: Exception) {
                decisionError = cause.userMessage(locale)
            } finally {
                deciding = false
            }
        }
    }

    decision?.let { pending ->
        val action = pending.action
        ConfirmDialog(
            title = t(if (action == QuoteDecision.Withdraw) "quotes.withdrawTitle" else action.label),
            body = t(action.detail),
            confirmLabel = t(action.label),
            onConfirm = { decide(pending) },
            onDismiss = { if (!deciding) decision = null },
            destructive = true,
            pending = deciding,
            error = decisionError,
            confirmEnabled = action != QuoteDecision.Decline || reason.isNotBlank(),
            extraContent = if (action == QuoteDecision.Decline) {
                {
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it.take(500) },
                        label = { Text(t("quotes.declineReason")) },
                        enabled = !deciding,
                    )
                }
            } else null,
        )
    }

    deleteId?.let { id ->
        ConfirmDialog(
            title = t("quotes.deleteDraft"),
            body = t("quotes.deleteDraftDetail"),
            confirmLabel = t("quotes.deleteDraft"),
            onConfirm = {
                busy = true
                deleteError = null
                coroutines.launch {
                    try {
                        repo.deleteDraft(companyId, id)
                        if (editId == id) closeForm()
                        deleteId = null
                        refreshKey++
                    } catch (cause: Exception) {
                        deleteError = cause.userMessage(locale)
                    } finally {
                        busy = false
                    }
                }
            },
            onDismiss = { if (!busy) deleteId = null },
            destructive = true,
            pending = busy,
            error = deleteError,
        )
    }

    Column(modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        shown.forEach { quote ->
            QuoteRow(
                quote = quote,
                now = now,
                canSend = canAct && quote.allowed_actions.allows("send"),
                canWithdraw = canAct && quote.allowed_actions?.contains("withdraw") == true,
                canDecline = canAct && quote.allowed_actions?.contains("decline") == true,
                canUndo = canUndoAcceptance(quote, now),
                canEdit = canAct && quote.allowed_actions?.contains("edit") == true,
                canDelete = canAct && quote.allowed_actions?.contains("delete") == true,
                sending = sendingId == quote.id,
                onSend = { send(quote.id) },
                onDecision = { action ->
                    reason = ""
                    decisionError = null
                    decision = PendingQuoteDecision(quote.id, action)
                },
                onEdit = {
                    editId = quote.id
                    amount = (quote.amount_cents / 100.0).toString()
                    description = quote.description
                },
                onDelete = {
                    deleteError = null
                    deleteId = quote.id
                },
            )
        }

        if (showForm) {
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
                TextButton(onClick = ::save, enabled = !busy) {
                    Text(
                        if (busy) t("quotes.saving") else t("quotes.saveDraft"),
                        fontSize = 13.sp,
                    )
                }
                TextButton(onClick = { if (editId != null) closeForm() else onCloseDraft() }) {
                    Text(t("common.cancel"), fontSize = 13.sp)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuoteRow(
    quote: Quote,
    now: Long,
    canSend: Boolean,
    canWithdraw: Boolean,
    canDecline: Boolean,
    canUndo: Boolean,
    canEdit: Boolean,
    canDelete: Boolean,
    sending: Boolean,
    onSend: () -> Unit,
    onDecision: (QuoteDecision) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val status = quote.shownStatus(now)
    // The row carries its own currency, the way a payment request does: a quote
    // is denominated when it is written, and a workspace that later changes
    // billing currency must not restate old prices.
    val money = formatMoney(quote.amount_cents, quote.money, locale = LocalAppLocale.current)

    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
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
                    QuoteStatus.EXPIRED, QuoteStatus.DECLINED, QuoteStatus.WITHDRAWN ->
                        MaterialTheme.colorScheme.onSurfaceVariant
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
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
            if (canWithdraw) {
                TextButton(onClick = { onDecision(QuoteDecision.Withdraw) }) {
                    Text(t("quotes.withdraw"), fontSize = 13.sp)
                }
            }
            if (canDecline) {
                TextButton(onClick = { onDecision(QuoteDecision.Decline) }) {
                    Text(t("quotes.markDeclined"), fontSize = 13.sp)
                }
            }
            if (canUndo) {
                TextButton(onClick = { onDecision(QuoteDecision.Undo) }) {
                    Text(t("quotes.undoAcceptance"), fontSize = 13.sp)
                }
            }
            if (canEdit) {
                IconButton(onClick = onEdit) {
                    Icon(Icons.Outlined.Edit, contentDescription = t("quotes.editDraft"))
                }
            }
            if (canDelete) {
                IconButton(onClick = onDelete) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = t("quotes.deleteDraft"))
                }
            }
        }
    }
}
