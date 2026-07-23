package com.loonext.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.loonext.android.core.model.BillingModule
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val FULL_DATE = DateTimeFormatter.ofPattern("MMMM d, yyyy")

private fun fullDate(iso: String?): String? = iso?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.systemDefault()).format(FULL_DATE) }
        .getOrNull()
}

/**
 * Billing (#157): plan card (calling is INCLUDED on every plan — never an
 * add-on), honest status banners, in-app plan change, the add-on modules card,
 * and hosted Stripe surfaces which ALWAYS open in the external browser
 * (store rules — never a webview or custom tab).
 */
@Composable
fun BillingSection(
    scope: SettingsScope,
    company: CompanyView,
    onRefreshCompany: () -> Unit,
) {
    val canManage = SettingsRoleGate.canManageBilling(scope.role)

    StatusNotices(scope, company, canManage)
    PlanCard(scope, company, canManage, onRefreshCompany)
    if (canManage && company.plan != null && company.subscriptionActive) {
        ModulesCard(scope)
    }
    if (canManage) {
        SettingsCard(
            title = "Payment & invoices",
            description = "Cards, receipts, and billing details live in the secure " +
                "Stripe portal. It opens in your browser.",
        ) {
            PortalButton(scope, label = "Manage payment & invoices")
        }
        if (company.subscriptionActive) {
            SettingsCard(title = "Cancel") {
                Text(
                    "Cancel anytime from the payment portal. Texting stops at the end " +
                        "of your billing period, and we hold your number for 30 days in " +
                        "case you change your mind. After that it's released for good.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    } else {
        SettingsCard(title = "Billing") {
            ReadOnlyLine("Only owners and admins can change billing.")
        }
    }
}

/** Open the hosted Stripe Billing Portal in the EXTERNAL browser. */
@Composable
private fun PortalButton(
    scope: SettingsScope,
    label: String,
    solid: Boolean = false,
) {
    val context = LocalContext.current
    var opening by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    Column {
        val onClick: () -> Unit = {
            opening = true
            error = null
            coroutines.launch {
                try {
                    val hosted = scope.repo.billingPortal(scope.companyId)
                    openExternal(context, hosted.url)
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    opening = false
                }
            }
        }
        if (solid) {
            Button(onClick = onClick, enabled = !opening) {
                Text(if (opening) "Opening…" else label)
            }
        } else {
            OutlinedButton(onClick = onClick, enabled = !opening) {
                Text(if (opening) "Opening…" else label)
            }
        }
        InlineError(error)
    }
}

@Composable
private fun StatusNotices(scope: SettingsScope, company: CompanyView, canManage: Boolean) {
    val notice = when {
        company.subscription_status == SubscriptionStatus.PAST_DUE ->
            "Your last payment didn't go through. Update your payment method to keep " +
                "sending messages." to "Update payment method"

        company.subscription_status == SubscriptionStatus.UNPAID ->
            "Sending is paused until your payment method is updated." to
                "Update payment method"

        company.subscriptionActive && company.cancel_at_period_end -> {
            val date = fullDate(company.current_period_end)
            ("Your plan is set to cancel" +
                (if (date != null) " on $date" else " at the end of this period") +
                ". Texting stops then; we hold your number for 30 days in case you come " +
                "back. You can undo this from the payment portal.") to "Keep my plan"
        }

        else -> null
    } ?: return

    val dark = isSystemInDarkTheme()
    val amberBg = if (dark) BrandColor.DarkAmberBg else BrandColor.AmberBg
    val amberInk = if (dark) BrandColor.DarkAmber else BrandColor.Amber
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .background(amberBg, RoundedCornerShape(12.dp))
            .padding(14.dp),
    ) {
        Text(
            notice.first,
            style = MaterialTheme.typography.bodyMedium,
            color = amberInk,
        )
        if (canManage) {
            Spacer(Modifier.height(8.dp))
            PortalButton(scope, label = notice.second, solid = true)
        }
    }
}

@Composable
private fun PlanCard(
    scope: SettingsScope,
    company: CompanyView,
    canManage: Boolean,
    onRefreshCompany: () -> Unit,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()

    if (company.subscription_status == SubscriptionStatus.CANCELED) {
        var opening by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        SettingsCard(title = "Subscription") {
            Text(
                "Your subscription is canceled. We hold your number for 30 days after " +
                    "your last period. Resubscribe before then and everything picks up " +
                    "where it left off.",
                style = MaterialTheme.typography.bodyMedium,
            )
            InlineError(error)
            if (canManage) {
                Button(
                    onClick = {
                        opening = true
                        error = null
                        coroutines.launch {
                            try {
                                val hosted = scope.repo.checkout(
                                    scope.companyId,
                                    company.plan ?: "starter",
                                )
                                openExternal(context, hosted.url)
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                opening = false
                            }
                        }
                    },
                    enabled = !opening,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (opening) "Opening…" else "Resubscribe") }
            }
        }
        return
    }

    val facts = planFacts(company.plan)
    if (facts == null) {
        SettingsCard(title = "Plan") {
            Text(
                "No plan yet. Finish setup on the web to pick one and get your number.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    SettingsCard(title = "Plan") {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(
                "${facts.name} · ${facts.price}",
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.width(10.dp))
            if (company.subscriptionActive && !company.cancel_at_period_end) {
                StatusPill("Active", PillTone.Positive)
            }
        }
        Spacer(Modifier.height(8.dp))
        listOf(
            "Texting for your crew, bound by fair use",
            "Calling included on every plan, never an add-on",
            "Extra texts bill under fair use, up to a cap you control",
            "${facts.seats} team members",
            "${facts.numbers} phone number" + if (facts.numbers == 1) "" else "s",
        ).forEach { line ->
            Text(
                "· $line",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 1.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        TextButton(onClick = { openExternal(context, FAIR_USE_URL) }) {
            Text("Allowances reflect fair use. See the policy")
        }
        fullDate(company.current_period_end)?.let { date ->
            Text(
                "Current period ends $date.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (canManage && company.subscriptionActive) {
            ChangePlanControl(scope, company, onRefreshCompany)
        }
    }
}

@Composable
private fun ChangePlanControl(
    scope: SettingsScope,
    company: CompanyView,
    onRefreshCompany: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    OutlinedButton(
        onClick = { open = true },
        modifier = Modifier.padding(top = 10.dp),
    ) { Text(if (company.plan == "pro") "Switch to Starter" else "Upgrade to Pro") }

    if (open) {
        ChangePlanDialog(
            scope = scope,
            company = company,
            onDismiss = { open = false },
            onChanged = {
                open = false
                onRefreshCompany()
            },
        )
    }
}

@Composable
private fun ChangePlanDialog(
    scope: SettingsScope,
    company: CompanyView,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    val upgrading = company.plan != "pro"
    val targetPlan = if (upgrading) "pro" else "starter"
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    // Downgrade requirements from LIVE counts: numbers from the company view,
    // active members fetched fresh.
    var activeMembers by remember { mutableStateOf<Int?>(null) }
    var membersFailed by remember { mutableStateOf(false) }
    LaunchedEffect(upgrading) {
        if (!upgrading) {
            try {
                activeMembers = scope.repo.members(scope.companyId)
                    .data.count { it.deactivated_at == null }
            } catch (_: Exception) {
                membersFailed = true
            }
        }
    }

    val activeNumbers = company.numbers.count { it.status != NumberStatus.RELEASED }
    val numbersOk = activeNumbers <= 1
    val seatsOk = (activeMembers ?: Int.MAX_VALUE) <= 3
    val downgradeBlocked = !upgrading && (!numbersOk || !seatsOk || membersFailed)

    ConfirmDialog(
        title = if (upgrading) "Upgrade to Pro?" else "Switch to Starter?",
        body = if (upgrading) {
            "The upgrade happens right away. You're charged the prorated difference " +
                "for the rest of this period, and your allowances go up immediately."
        } else {
            "Starter is smaller, so your workspace has to fit it first."
        },
        confirmLabel = if (upgrading) "Upgrade now" else "Schedule the switch",
        confirmEnabled = !downgradeBlocked,
        pending = pending,
        error = error,
        onDismiss = onDismiss,
        onConfirm = {
            pending = true
            error = null
            coroutines.launch {
                try {
                    val result = scope.repo.changePlan(scope.companyId, targetPlan)
                    scope.showMessage(
                        if (result.effective == "now") "You're on Pro now."
                        else "Switch to Starter scheduled for the end of this period.",
                    )
                    onChanged()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
        extraContent = if (upgrading) {
            null
        } else {
            {
                Spacer(Modifier.height(10.dp))
                Text(
                    (if (numbersOk) "✓" else "✗") +
                        if (numbersOk) " 1 phone number. You're set."
                        else " Starter includes 1 phone number; you have $activeNumbers. " +
                            "Release under Settings › Numbers first.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    when {
                        membersFailed -> "✗ Couldn't check your member count. Try again."
                        activeMembers == null -> "Checking your member count…"
                        seatsOk -> "✓ Up to 3 members; you have $activeMembers."
                        else -> "✗ Starter includes 3 members; you have $activeMembers " +
                            "active. Deactivate ${activeMembers!! - 3} under Settings › " +
                            "Team first."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "The change happens at the end of your current period. You keep Pro " +
                        "until then, and nothing is refunded mid-period.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
    )
}

@Composable
private fun ModulesCard(scope: SettingsScope) {
    var refreshKey by remember { mutableIntStateOf(0) }
    var confirming by remember { mutableStateOf<BillingModule?>(null) }
    var pending by remember { mutableStateOf(false) }
    var dialogError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    // #176 cache-first: the add-ons catalog paints instantly from StoreCache
    // after the first in-process fetch; the setModule mutation bumps
    // refreshKey for a silent revalidate.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.billing(scope.companyId),
        refreshKey = refreshKey,
    ) {
        scope.repo.modules(scope.companyId)
            .modules.filter { it.available || it.enabled }
    }

    when (val current = state) {
        // Loading quietly and hiding an empty catalog are both correct: the
        // card only exists when there is something sellable (web parity).
        is LoadState.Loading -> Unit
        is LoadState.Failed -> Unit
        is LoadState.Ready -> {
            val modules = current.value
            if (modules.isEmpty()) return
            SettingsCard(
                title = "Add-ons",
                description = "Optional extras billed with your plan.",
            ) {
                modules.forEach { module ->
                    LabeledSwitchRow(
                        label = "${module.label} · ${formatMonthlyCents(module.monthly_cents)}/mo",
                        supporting = module.blurb,
                        checked = module.enabled,
                        onCheckedChange = {
                            dialogError = null
                            confirming = module
                        },
                        enabled = module.available || module.enabled,
                    )
                }
            }
        }
    }

    val module = confirming
    if (module != null) {
        val enabling = !module.enabled
        ConfirmDialog(
            title = if (enabling) "Add ${module.label}?" else "Remove ${module.label}?",
            body = if (enabling) {
                "${formatMonthlyCents(module.monthly_cents)}/mo is added to your plan. " +
                    "You're charged a prorated amount for the rest of this period today, " +
                    "then the full price each month."
            } else {
                "${module.label} comes off your plan now, with a prorated credit for " +
                    "the unused part of this period on your next invoice."
            },
            confirmLabel = if (enabling) "Add it" else "Remove it",
            pending = pending,
            error = dialogError,
            onDismiss = { confirming = null },
            onConfirm = {
                pending = true
                dialogError = null
                coroutines.launch {
                    try {
                        scope.repo.setModule(scope.companyId, module.id, enabling)
                        confirming = null
                        scope.showMessage(
                            if (enabling) "${module.label} added." else "${module.label} removed.",
                        )
                        refreshKey++
                    } catch (cause: Exception) {
                        dialogError = cause.userMessage()
                    } finally {
                        pending = false
                    }
                }
            },
        )
    }
}
