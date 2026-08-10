package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.RequestQuote
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.features.payments.PayoutAccount
import com.loonext.android.features.payments.Payments
import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.ui.common.rememberHaptics
import java.util.UUID
import kotlinx.coroutines.launch

/**
 * The stand-in for the real payment URL, shown inside the preview.
 *
 * The link is minted by the SERVER — it does not exist until the request does —
 * so the preview cannot show the real one. It is the same shape and roughly the
 * same length as the real thing so the preview does not lie about how long the
 * text is, which is the one thing a preview of an SMS has to be honest about.
 */
internal const val PREVIEW_URL = "https://app.loonext.com/pay/…"

/**
 * One ask, as the form composed it.
 *
 * Carries the CURRENCY as well as the amount, so whoever confirms the send
 * reports the same money the field was labelled in. A caller that resolved the
 * currency again from the account would be a second answer to a question this
 * form has already answered — and the two would agree until the day the account
 * reloaded mid-form.
 */
data class PaymentAsk(
    val amountCents: Int,
    val description: String,
    val idempotencyKey: String,
    val currency: BillingCurrency,
)

/**
 * #224 — "that'll be $250 for the deposit", asked in the thread.
 *
 * ## Evaluation, and the constraints that bound the design
 *
 * This is the only control near the composer that asks somebody else for money,
 * and it is used by a tech standing in a driveway on a phone. So:
 *
 * - **Absent unless the workspace can actually take a payment.** Same rule as
 *   #520's on-my-way button: a control that is present and inert costs every
 *   reader the moment it takes to work out why it does nothing, on every thread,
 *   forever. A workspace that has not connected Stripe sees nothing here — the
 *   setup lives in Settings, where the owner is, and a tech cannot action it
 *   anyway. *Applying: Zen of Clarity, and Prioritize Intent.*
 *
 * - **Never an empty form.** The description arrives pre-filled with "Deposit",
 *   which is the ask this feature exists for and the one most likely to be
 *   right. *Applying: Smart Defaults.*
 *
 * - **The preview IS the ethical friction.** Sending a bill to a customer is
 *   customer-visible and cannot be unsent, so the exact text that will arrive is
 *   shown before the button that sends it — not a summary of it, the message
 *   itself, composed by the same shared function the server uses. A confirm
 *   dialog would add a step without adding information; this adds the
 *   information. *Applying: Ethical Friction, at the only edge that has any.*
 *
 * - **The amount is in the ACCOUNT's currency**, which is what the business will
 *   receive and is not necessarily what its own plan is billed in. Named on the
 *   field rather than assumed. *Applying: the money-literal rule — a price with
 *   no currency is a price in a currency nobody chose.*
 *
 * Mirrors apps/web/src/components/thread/ask-for-payment.tsx.
 */
@Composable
fun AskForPayment(
    account: PayoutAccount?,
    businessName: String?,
    /**
     * Returns true when the ask actually went out. False keeps the form open
     * with everything still typed in it: a refusal here is almost always a RULE
     * (the customer opted out, the plan lapsed, Stripe is still verifying) and
     * clearing the form would make the crew type it all again to find out.
     */
    onAsk: suspend (PaymentAsk) -> Boolean,
    modifier: Modifier = Modifier,
) {
    // Not a disabled button. A workspace that cannot charge sees no control at
    // all, and the owner is told why on the settings screen that can fix it.
    if (account == null || !account.canCharge) return

    val currency = account.billingCurrency
    val haptics = rememberHaptics()
    val coroutines = rememberCoroutineScope()

    var open by remember { mutableStateOf(false) }
    var amount by remember { mutableStateOf("") }
    // Smart Defaults: the ask this feature was built for, editable in one tap.
    var description by remember { mutableStateOf("Deposit") }
    var sending by remember { mutableStateOf(false) }
    // Minted once per ASK, not per tap. A tap that timed out on a cell
    // connection and the tap the person makes again are the same request, and
    // the server dedupes them on this key; a fresh key per tap would send the
    // customer two bills.
    var idempotencyKey by remember { mutableStateOf(UUID.randomUUID().toString()) }

    if (!open) {
        TextButton(
            onClick = {
                haptics.tap()
                open = true
            },
            modifier = modifier.padding(start = 8.dp, top = 2.dp),
        ) {
            Icon(
                Icons.Outlined.RequestQuote,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text("Ask for payment")
        }
        return
    }

    val cents = Payments.parseAmountToCents(amount)
    val problem = cents?.let { Payments.amountProblem(it) }
    // Spelled out rather than read from a `ready` flag: the null check is what
    // smart-casts `cents` for the composer below, and a boolean does not.
    val preview = if (cents != null && problem == null && description.isNotBlank()) {
        Payments.requestSms(
            // A workspace whose name has not loaded yet still gets an honest
            // preview: the customer will see the real name, and a blank first
            // word would read as a broken message rather than a pending fetch.
            businessName = businessName?.takeIf { it.isNotBlank() } ?: "Your business",
            amountCents = cents,
            currency = currency,
            description = description,
            url = PREVIEW_URL,
        )
    } else {
        null
    }
    val ready = preview != null

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(12.dp),
            )
            .border(
                1.dp,
                MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(12.dp),
            )
            .padding(12.dp),
    ) {
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            // Named rather than symbolised. The account settles in ONE currency
            // and it is not always the one this workspace's plan is billed in;
            // "Amount" alone would let a Canadian crew read a US figure as
            // theirs.
            label = { Text("Amount in ${currency.name}") },
            // The phone keyboard a number belongs on, and the one this is typed
            // on nine times out of ten.
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            isError = problem != null,
            // The if-else spelling rather than `?.let`, because the expected
            // type here is a @Composable lambda and only this form lets the
            // annotation reach it.
            supportingText = if (problem != null) {
                { Text(Payments.amountProblemCopy(problem, currency)) }
            } else {
                null
            },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = description,
            // Clamped at the source rather than validated after the fact: the
            // description rides in the SMS and onto a card statement, and a
            // 422 for a field somebody has already finished typing is a refusal
            // they cannot act on without deleting work.
            onValueChange = { description = it.take(Payments.DESCRIPTION_MAX) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("What for") },
        )

        if (preview != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                "They will receive:",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            // The message itself, not a description of it.
            Text(
                preview,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.surface,
                        RoundedCornerShape(10.dp),
                    )
                    .padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }

        Spacer(Modifier.height(12.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Button(
                onClick = {
                    val chargeable = cents ?: return@Button
                    haptics.tap()
                    sending = true
                    coroutines.launch {
                        val sent = onAsk(
                            PaymentAsk(
                                amountCents = chargeable,
                                description = description.trim(),
                                idempotencyKey = idempotencyKey,
                                currency = currency,
                            ),
                        )
                        sending = false
                        if (sent) {
                            open = false
                            amount = ""
                            description = "Deposit"
                            // A new key for the next ask: reusing it would let
                            // the server dedupe a genuinely different request as
                            // a retry of this one.
                            idempotencyKey = UUID.randomUUID().toString()
                        }
                    }
                },
                enabled = ready && !sending,
            ) {
                Text(
                    when {
                        sending -> "Sending…"
                        // The button says the figure, so the last thing read
                        // before the tap is the amount rather than the verb.
                        cents != null && problem == null ->
                            "Ask for ${formatMoney(cents, currency)}"

                        else -> "Ask for payment"
                    },
                    fontWeight = FontWeight.Medium,
                )
            }
            TextButton(onClick = { open = false }, enabled = !sending) { Text("Cancel") }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "Goes out as a text with a secure payment link. The money lands in " +
                "your bank account — we take nothing on top.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
    }
}
