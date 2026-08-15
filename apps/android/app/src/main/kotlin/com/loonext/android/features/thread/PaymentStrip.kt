package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RequestQuote
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t
import com.loonext.android.features.payments.PaymentRequest
import com.loonext.android.features.payments.PaymentState
import com.loonext.android.features.payments.Payments
import com.loonext.android.features.compose.NoteAmber
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.ui.common.rememberHaptics

/**
 * #224 — what this thread is owed, and what it was paid.
 *
 * ## Why a strip beside the composer rather than a bubble in the transcript
 *
 * Same reasoning #233 settled for scheduled sends. A payment request is not a
 * message: the message that carried it is already in the transcript, in the
 * customer's own thread, exactly as they received it. What is NOT in the
 * transcript is the state — whether it was paid, refunded, or has expired — and
 * that state changes without anybody in the workspace doing anything. A bubble
 * would have to mutate after the fact, which is the one thing a transcript must
 * never do.
 *
 * ## What it shows, and what it hides
 *
 * Only requests that are still LIVE or were settled recently. A thread with two
 * years of paid deposits would otherwise grow a permanent wall of history above
 * the composer, and history is what the timeline is for. *Applying: Zen of
 * Clarity — the strip is absent entirely on almost every thread.*
 *
 * Cancel is an X on the row, not a menu: it is reversible in the only sense
 * that counts (ask again), and it is only offered while the request is
 * genuinely cancellable. *Applying: Ethical Friction, calibrated — friction
 * belongs on the ask, which is customer-visible, not on calling it off.*
 *
 * Mirrors apps/web/src/components/thread/payment-strip.tsx.
 */
@Composable
fun PaymentStrip(
    rows: List<PaymentRequest>,
    /**
     * Null for a reader who may not act on this thread (#315's view-only
     * observer). They still SEE the money — the strip is a fact about the
     * conversation, and hiding facts from an observer is not what that role
     * means — but no row grows an X they would be refused for pressing.
     */
    onCancel: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
    /** The row a cancel is in flight for; its X is held down until it lands. */
    cancellingId: String? = null,
) {
    // No skeleton and no empty state: reserving space on every thread for
    // something almost every thread does not have is a permanent cost paid for
    // a rare event.
    if (rows.isEmpty()) return

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        rows.forEach { row ->
            PaymentRow(
                row = row,
                onCancel = onCancel?.let { cancel -> { cancel(row.id) } },
                cancelling = cancellingId == row.id,
            )
        }
    }
}

/**
 * The rows worth putting above a composer, newest first.
 *
 * Kept out of the composable so the rule is a function with vectors on it
 * rather than a filter buried in a layout — this is the half of the strip that
 * can be wrong without looking wrong.
 */
fun paymentRowsToShow(
    rows: List<PaymentRequest>,
    now: Long = System.currentTimeMillis(),
): List<PaymentRequest> = rows.filter {
    Payments.isWorthShowing(it.state, it.created_at, it.paid_at, now)
}

/** Three tones, because there are three things a reader has to do about a row. */
enum class PaymentTone { ATTENTION, SETTLED, QUIET }

fun toneFor(state: PaymentState): PaymentTone = when (state) {
    PaymentState.DISPUTED, PaymentState.REFUNDED -> PaymentTone.ATTENTION
    PaymentState.PAID -> PaymentTone.SETTLED
    PaymentState.REQUESTED, PaymentState.CANCELLED, PaymentState.EXPIRED -> PaymentTone.QUIET
}

@Composable
private fun PaymentRow(row: PaymentRequest, onCancel: (() -> Unit)?, cancelling: Boolean) {
    val haptics = rememberHaptics()
    val state = row.state
    val tone = toneFor(state)
    // D100: each token is a FILL or a LABEL, never both. Amber is what this
    // product already means by "needs a human" (the held-message strip uses the
    // same pair), the lime container is what it means by settled, and the inset
    // is what it means by "on the record, nothing to do".
    val (fill, line, accent) = when (tone) {
        PaymentTone.ATTENTION -> Triple(NoteAmber.bg(), NoteAmber.line(), NoteAmber.ink())
        PaymentTone.SETTLED -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.outlineVariant,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )

        PaymentTone.QUIET -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.outlineVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    // Through the money formatter, never typed: this figure is in the STRIPE
    // ACCOUNT's currency, which is not necessarily the one the workspace is
    // billed in, and a bare "$" at the wrong reader is #522 with a new figure.
    val amount = formatMoney(row.amount_cents, row.money)

    Row(
        Modifier
            .fillMaxWidth()
            .background(fill, RoundedCornerShape(10.dp))
            .border(1.dp, line, RoundedCornerShape(10.dp))
            .padding(start = 10.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            when (tone) {
                PaymentTone.SETTLED -> Icons.Outlined.CheckCircle
                PaymentTone.ATTENTION -> Icons.Outlined.WarningAmber
                PaymentTone.QUIET -> Icons.Outlined.RequestQuote
            },
            contentDescription = null,
            tint = accent,
            modifier = Modifier
                .padding(top = 1.dp)
                .size(15.dp),
        )
        // Said before the builder rather than inside it: `t` is
        // @ReadOnlyComposable and `buildString`'s lambda is a place a reader
        // has to reason about inlining to know whether that is legal.
        val stateLabel = t(Payments.label(state))
        Column(Modifier.weight(1f)) {
            Text(
                // "Paid · $250 — Deposit". The state and the amount lead
                // because they are what somebody scanning the thread is
                // checking; the description is what it was for, and it is the
                // part that can be truncated without losing the answer.
                buildString {
                    append(stateLabel)
                    append(" · ")
                    append(amount)
                    if (row.description.isNotBlank()) {
                        append(" — ")
                        append(row.description)
                    }
                },
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            val refunded = row.amount_refunded_cents
            if (state == PaymentState.REFUNDED && refunded != null) {
                // How much went back, because a PARTIAL refund is a real event
                // and "Refunded" alone would let a crew believe the whole
                // deposit had gone back when half of it had.
                Text(
                    t(
                        "payments.refundedBack",
                        "amount" to formatMoney(refunded, row.money),
                    ),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (state == PaymentState.DISPUTED) {
                Text(
                    t("payments.disputedNote"),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = accent,
                )
            }
        }
        if (onCancel != null && Payments.cancellable(state)) {
            IconButton(
                onClick = {
                    haptics.tap()
                    onCancel()
                },
                enabled = !cancelling,
            ) {
                Icon(
                    Icons.Filled.Close,
                    // Spelled out for TalkBack: an unlabelled X on a row that
                    // is one of several is a control nobody can aim.
                    contentDescription = t(
                        "payments.cancelAria",
                        "amount" to amount,
                        "description" to row.description,
                    ),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(15.dp),
                )
            }
        }
    }
}
