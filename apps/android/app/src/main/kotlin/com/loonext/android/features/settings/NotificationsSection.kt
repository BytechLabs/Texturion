package com.loonext.android.features.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.features.notifications.NotificationPrefsCard
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #388: the wording is deliberately the SAME sentence as web and iOS. Three
 * hand-written descriptions of one behaviour is how three clients end up
 * explaining a feature three different ways, and this one is about when a
 * customer's phone is answered — the copy has to be exact.
 *
 * Two minutes and five minutes mirror LEAD_CHASE_NUDGE_MINUTES and
 * LEAD_CHASE_WIDEN_MINUTES in packages/shared/src/lead-chase.ts, which the
 * server reads. Kotlin cannot import them; if they ever change, this string
 * and the iOS one change with them.
 */
private const val NUDGE_MINUTES = 2
private const val WIDEN_MINUTES = 5

/**
 * Notifications (#157): hosts #156's embeddable card — per-user email/push
 * toggles plus this device's push-permission state — and states the one
 * exception plainly: billing and registration emails always reach owners
 * and admins.
 *
 * #388 adds the workspace-wide lead-chasing card BELOW the personal one, in
 * its own card and labelled with its scope. The card above is about this
 * person and this device; silently mixing the two would leave a member
 * thinking they had turned something off for themselves.
 */
@Composable
fun NotificationsSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    // #386. ABOVE the toggles, because it contradicts the one directly below
    // it: an Email switch reading ON while every message bounces is the screen
    // telling a comfortable lie. Renders nothing when email is working.
    EmailReachabilityCard(scope)

    NotificationPrefsCard(
        graph = scope.graph,
        companyId = scope.companyId,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )

    LeadChaseCard(scope, company, onCompanyUpdated)

    Text(
        "Billing, usage, and registration emails always go to owners and admins. " +
            "They can't be turned off.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
    )
}

@Composable
private fun LeadChaseCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = scope.role == "owner" || scope.role == "admin"
    val coroutines = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Saves on toggle rather than behind a Save button, unlike the away
    // message next door: there is no text to get wrong and no preview to
    // check, so a two-step commit would be ceremony around a switch.
    fun save(chase: Boolean, crew: Boolean) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val body = buildJsonObject {
                    put("lead_chase_enabled", chase)
                    put("lead_chase_crew_enabled", crew)
                }
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = "Chasing unanswered leads",
        description = "Applies to everyone in the workspace. Only owners and admins can change it.",
    ) {
        LabeledSwitchRow(
            label = "Buzz again after $NUDGE_MINUTES minutes",
            supporting = "When a new customer texts and nobody has replied, send the same " +
                "people one more notification. A phone in a pocket misses the first one, " +
                "and the job usually goes to whoever answers first.",
            checked = company.lead_chase_enabled,
            enabled = canEdit && !saving,
            onCheckedChange = { save(it, company.lead_chase_crew_enabled) },
        )
        LabeledSwitchRow(
            label = "Tell the whole crew after $WIDEN_MINUTES minutes",
            supporting = "If a conversation is assigned to one person and they still haven't " +
                "replied, notify everyone who can see it. This one reaches people who " +
                "weren't told the first time, so it's off unless you turn it on.",
            checked = company.lead_chase_crew_enabled,
            // Off entirely when chasing is off: the second rung is only ever
            // reached through the first, so leaving it live would let an owner
            // switch on something that cannot fire.
            enabled = canEdit && company.lead_chase_enabled && !saving,
            onCheckedChange = { save(company.lead_chase_enabled, it) },
        )
        InlineError(error)
        Text(
            "Only during your business hours, and never to anyone who has turned their own " +
                "notifications off. Outside hours your away reply answers instead.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
        if (!canEdit) {
            Text(
                "Only owners and admins can change this.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/**
 * #386 — "we can't reach this address."
 *
 * A hard-bounced address is otherwise completely invisible to the person it
 * belongs to: their notifications simply stop, which is indistinguishable from
 * a quiet week. The point of this surface is that the failure becomes FIXABLE
 * rather than merely broken.
 *
 * Renders nothing when email is working. A false "we can't reach you" is worse
 * than none — it sends somebody to fix an address that was never broken.
 *
 * Same words as web and iOS, deliberately: this one explains why a person is
 * not hearing from us, and three wordings would be three different stories.
 */
@Composable
private fun EmailReachabilityCard(scope: SettingsScope) {
    val state = scope.me.email_state ?: return
    val coroutines = rememberCoroutineScope()
    var cleared by remember { mutableStateOf(false) }
    var retrying by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // The card is driven by the `me` loaded when settings opened, so after a
    // successful retry it hides itself rather than waiting for a refetch that
    // this screen has no trigger for. The server has already cleared it.
    if (cleared) return

    SettingsCard(title = "We can't email you at ${state.email}") {
        if (state.fixable) {
            Text(
                "Emails to this address are bouncing, so we've stopped sending them. " +
                    "Push notifications still work. If the address was mistyped, fix it " +
                    "in your account first, then tell us to try again.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            InlineError(error)
            Button(
                onClick = {
                    error = null
                    retrying = true
                    coroutines.launch {
                        try {
                            scope.repo.retryOwnEmail()
                            cleared = true
                            scope.showMessage(
                                "We'll try that address again on your next notification.",
                            )
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            retrying = false
                        }
                    }
                },
                enabled = !retrying,
                modifier = Modifier.padding(top = 10.dp),
            ) { Text(if (retrying) "Trying…" else "Try this address again") }
        } else {
            // No button, on purpose. The address reported us as spam, and one
            // tap in our own app is not that person's consent to start again.
            Text(
                "This address reported our email as spam, so we've stopped sending to " +
                    "it for good. Push notifications still work. To get email again, " +
                    "change your account to a different address.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
