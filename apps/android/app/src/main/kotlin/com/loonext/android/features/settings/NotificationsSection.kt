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
 * Five minutes mirrors LEAD_CHASE_WIDEN_MINUTES in
 * packages/shared/src/lead-chase.ts, which the server reads. Kotlin cannot
 * import it; if it ever changes, this string and the iOS one change with it.
 */
private const val WIDEN_MINUTES = 5

/**
 * Notifications (#157): hosts #156's embeddable card — per-user email/push
 * toggles plus this device's push-permission state — and states the one
 * exception plainly: billing and registration emails always reach owners
 * and admins.
 *
 * #463 folded the lead-chasing card INTO that one as a single row. It used to
 * be a titled card of its own holding two switches, and the owner's objection
 * was that all of it was special treatment for what is just another
 * notification setting. The second switch was also unreachable in practice —
 * see 01209b5.
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
    ) {
        LeadChaseRow(scope, company, onCompanyUpdated)
        // #430: directly below the push settings it qualifies, because an
        // owner looking for it is thinking "what do my notifications show",
        // not "what is my data-protection posture".
        PushContentRow(scope, company, onCompanyUpdated)
    }

    Text(
        "Billing, usage, and registration emails always go to owners and admins. " +
            "They can't be turned off.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
    )
}

/**
 * #463 — one switch, sitting among the other notification settings.
 *
 * WHAT THE OLD CARD GOT RIGHT AND THIS KEEPS. Everything else in that card is
 * per-person; this is workspace-wide, and the card's header said so. Silently
 * mixing the two scopes would let a member think they had muted something for
 * themselves when they had changed it for everyone. That warning is not
 * dropped — it moved into this row's own description, which is where somebody
 * looks before touching a switch.
 *
 * The business-hours limit moved with it, for the same reason: it is not a
 * setting, it is the difference between silence at 7pm being expected and
 * silence at 7pm being a bug worth reporting.
 *
 * Same sentence as web and iOS, deliberately — see the note on WIDEN_MINUTES.
 */
@Composable
private fun LeadChaseRow(
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
    fun save(crew: Boolean) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val body = buildJsonObject { put("lead_chase_crew_enabled", crew) }
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    LabeledSwitchRow(
        label = "Tell the whole crew after $WIDEN_MINUTES minutes",
        supporting = "When a conversation is assigned to one person and they still haven't " +
            "replied, notify everyone who can see it. Business hours only, and never " +
            "someone who has turned their own notifications off. This one is for the " +
            "whole workspace, not just you" +
            if (canEdit) "." else " — only owners and admins can change it.",
        checked = company.lead_chase_crew_enabled,
        enabled = canEdit && !saving,
        onCheckedChange = { save(it) },
        modifier = Modifier.padding(top = 6.dp),
    )
    InlineError(error)
}

/**
 * #430 — whether a customer's words may ride a push notification.
 *
 * PHRASED POSITIVELY, and on by default, so the switch's "on" position is the
 * behaviour every workspace already has. A negative switch ("hide message
 * content") makes the safe-looking position the one that changes things, and
 * an owner reading quickly cannot tell which way is the status quo.
 *
 * The description leads with the ROOM rather than the feature: an owner does
 * not think about push payloads, they think about the phone on a workbench in
 * a customer's kitchen. Same sentence as web and iOS, deliberately.
 */
@Composable
private fun PushContentRow(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = scope.role == "owner" || scope.role == "admin"
    val coroutines = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save(include: Boolean) {
        error = null
        saving = true
        coroutines.launch {
            try {
                val body = buildJsonObject { put("push_include_content", include) }
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    LabeledSwitchRow(
        label = "Show message text on lock screens",
        supporting = "Notifications show who texted and the first line of what they said, " +
            "so the crew can tell a lead from a \"thanks\" without unlocking. Turn this " +
            "off and they'll still see who it was, but never what a customer wrote — " +
            "useful if phones are out on the job, in other people's homes. This one is " +
            "for the whole workspace, not just you" +
            if (canEdit) "." else " — only owners and admins can change it.",
        checked = company.push_include_content,
        enabled = canEdit && !saving,
        onCheckedChange = { save(it) },
        modifier = Modifier.padding(top = 6.dp),
    )
    InlineError(error)
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
