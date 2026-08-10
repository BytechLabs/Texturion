package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.MemberRole
import com.loonext.android.features.payments.PayoutAccount
import com.loonext.android.features.payments.PayoutReadiness
import com.loonext.android.features.payments.Payments
import com.loonext.android.features.payments.PaymentsRepository
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.launch

/**
 * #224 — "Getting paid", the owner's side of text-to-pay.
 *
 * ## Evaluation
 *
 * This screen has exactly one job: say where the business stands, and offer the
 * one thing that moves them forward. There are five states and each has a
 * different next action, so the temptation is a status grid. A grid would be
 * wrong — the reader is a plumber who wants to know whether they can take a
 * card, not an operator auditing a Stripe account.
 *
 * ## The decisions
 *
 * - **One sentence, one button.** The state copy is composed on the SERVER, so
 *   web, Android and iOS say the same thing and none of them can drift into
 *   paraphrase. *Applying: Chunking — three or four items is the ceiling, and a
 *   status page that lists nine booleans is nine.*
 *
 * - **No progress bar.** Onboarding progress belongs to Stripe, which owns the
 *   flow and is the only thing that knows how far through it somebody is. A bar
 *   we invented would either start at 0% — which the manual forbids, because it
 *   tells somebody who has already done work that they have done none — or
 *   would be a number we made up. The honest equivalent is what is OUTSTANDING,
 *   listed below. *Applying: the Goal Gradient Effect, honoured by naming the
 *   remaining steps rather than faking a fraction.*
 *
 * - **Outstanding requirements in plain words.** Stripe answers with
 *   `individual.verification.document`. A person reads "Photo ID for the
 *   business owner". *Applying: Outcomes Over Features.*
 *
 * - **Loss aversion is deliberately ABSENT.** There is no "you are losing
 *   payments" framing here. The business has not lost anything; they have not
 *   started. Manufacturing a loss to drive a bank-details form would be the one
 *   place in this product where that lever would be dishonest.
 *
 * - **An honest line, never a button that 403s.** Connecting the account is
 *   owner-only on the server, and this section is visible to anybody with
 *   `billing.manage` — which is the whole reason the bookkeeper role exists
 *   (#315), because the Stripe dashboard is where a refund is issued. So a
 *   non-owner looking at an unconnected workspace gets the sentence rather than
 *   a button that fails. *Applying: Prioritize Intent, and the repo's own
 *   [ReadOnlyLine] idiom.*
 *
 * - **The Stripe dashboard link is the refund path**, and it is the only place
 *   refunds are offered. See docs/TEXT-TO-PAY.md: we deliberately do not build a
 *   thin copy of a back office that already exists and stays compliant.
 *
 * Mirrors apps/web/src/components/settings/payments-card.tsx.
 */
@Composable
fun PaymentsSection(scope: SettingsScope) {
    val repo = remember(scope.graph) { PaymentsRepository(scope.graph.api) }
    var refreshKey by remember { mutableIntStateOf(0) }

    // Stripe flips `charges_enabled` in its own time and there is no realtime
    // event for it, so the only honest trigger is a return to the app — which is
    // exactly what coming back from the hosted onboarding flow looks like. The
    // helper ignores a glance away, so this costs one read after a real absence
    // rather than one per app switch.
    ResyncOnResume(scope.companyId) { refreshKey++ }

    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.payoutAccount(scope.companyId),
        refreshKey = refreshKey,
    ) { repo.account(scope.companyId) }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> PayoutCard(
            scope = scope,
            repo = repo,
            account = current.value,
            onChanged = { refreshKey++ },
        )
    }
}

@Composable
private fun PayoutCard(
    scope: SettingsScope,
    repo: PaymentsRepository,
    account: PayoutAccount,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    var opening by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Two different destinations behind one server-labelled button. Which one
    // is decided by WHERE THE BUSINESS IS, not by the label: "Open Stripe" is
    // the copy for both `restricted` and `ready`, and only one of those has an
    // onboarding flow left to resume.
    val needsOnboarding = account.state == PayoutReadiness.NOT_CONNECTED ||
        account.state == PayoutReadiness.ONBOARDING_INCOMPLETE
    val isOwner = scope.role == MemberRole.OWNER

    SettingsCard(title = "Getting paid", description = account.title) {
        Text(
            account.detail,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (account.requirements_due.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            OutstandingRequirements(account.requirements_due)
        }

        val label = account.action
        if (label != null) {
            Spacer(Modifier.height(14.dp))
            if (needsOnboarding && !isOwner) {
                // Not a disabled button and not a button that answers 403: the
                // person reading this can do everything else on the screen, and
                // the one thing they cannot do is bind a bank account to the
                // business. Saying so is shorter than finding out.
                ReadOnlyLine(
                    "Only the owner can connect the bank account. Once they " +
                        "have, you can open Stripe from here to issue refunds " +
                        "and read payouts.",
                )
            } else {
                Button(
                    onClick = {
                        opening = true
                        error = null
                        coroutines.launch {
                            try {
                                val url = if (needsOnboarding) {
                                    repo.startOnboarding(scope.companyId).url
                                } else {
                                    repo.dashboardLink(scope.companyId).url
                                }
                                openExternal(context, url)
                                // Starting onboarding CREATES the account, so
                                // `connected` is already true and the card is
                                // already stale — before the browser has even
                                // drawn. Refreshing here rather than only on
                                // return covers the reader who bounces straight
                                // back, which is under the resync helper's
                                // away-for-30s floor.
                                onChanged()
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                opening = false
                            }
                        }
                    },
                    enabled = !opening,
                ) {
                    Text(if (opening) "Opening…" else label)
                    Spacer(Modifier.width(6.dp))
                    // A right chevron on a forward action, an out-arrow on one
                    // that leaves the product. The difference tells somebody
                    // whether they are about to leave before they tap.
                    Icon(
                        if (needsOnboarding) {
                            Icons.AutoMirrored.Outlined.KeyboardArrowRight
                        } else {
                            Icons.Outlined.OpenInNew
                        },
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            InlineError(error)
        }

        if (account.state == PayoutReadiness.READY) {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(12.dp))
            Fact(
                "Payouts",
                if (account.payouts_enabled) {
                    "On — money reaches your bank"
                } else {
                    "Stripe has not switched payouts on yet"
                },
            )
            Spacer(Modifier.height(8.dp))
            // The account's own currency, upper-cased — a three-letter code, not
            // an amount, so it is not a price and has no formatter to go
            // through. What the business is PAID in; every figure this feature
            // renders goes through formatMoney in that currency.
            Fact("Charged in", account.billingCurrency.name)
            Spacer(Modifier.height(14.dp))
            Text(
                "Refunds, receipts and payout history all live in your Stripe " +
                    "dashboard. We never hold your money and we take nothing on " +
                    "top of what you charge — Stripe's own card fee is the only " +
                    "deduction.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * What Stripe is still waiting for, in words a tradesperson reads.
 *
 * Amber, which is what this product already means by "needs a human" — the same
 * pair of tokens the settings ReachNote and the held-message strip use, so the
 * colour keeps meaning one thing. Not red: nothing is broken, and colouring an
 * unfinished form as an error teaches people to ignore red on the day it
 * matters.
 */
@Composable
private fun OutstandingRequirements(requirements: List<String>) {
    val dark = isSystemInDarkTheme()
    val bg = if (dark) BrandColor.DarkAmberBg else BrandColor.AmberBg
    val ink = if (dark) BrandColor.DarkAmber else BrandColor.Amber
    Column(
        Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(
            "Stripe still needs:",
            style = MaterialTheme.typography.labelLarge,
            color = ink,
        )
        Spacer(Modifier.height(4.dp))
        requirements.forEach { requirement ->
            Text(
                Payments.requirementCopy(requirement),
                style = MaterialTheme.typography.bodySmall,
                color = ink,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/** One label-over-value pair, the settings screen's quietest unit. */
@Composable
private fun Fact(label: String, value: String) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
