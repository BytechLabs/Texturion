package com.loonext.android.features.settings

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
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Member
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Ownership (#332) — on the Team screen, because that is where somebody
 * already is when they think about who runs this place.
 *
 * Three things, in falling order of urgency:
 *
 *   1. A HANDOVER IN FLIGHT, shown to EVERYBODY — including a plain member who
 *      is neither side of it. The colleague who knows the owner is only on
 *      holiday is the alarm, and a takeover nobody was shown is
 *      indistinguishable from a handover.
 *   2. Who owns it, and the backup slot (owner only).
 *   3. The two actions: hand it over, or ask to take over.
 *
 * Every permission is a boolean the SERVER decided. Nothing here works out for
 * itself whether somebody may claim a business.
 */
@Composable
fun OwnershipCard(
    scope: SettingsScope,
    state: Ownership,
    members: List<Member>,
    onChanged: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf<String?>(null) }
    var offerTo by remember { mutableStateOf<Member?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var proof by remember { mutableStateOf<HandoverProof?>(null) }
    var codeRejected by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val others = members.filter {
        it.deactivated_at == null && it.id != state.owner_member_id
    }
    fun nameOf(memberId: String?): String =
        members.firstOrNull { it.id == memberId }?.display_name?.ifBlank { null }
            ?: "a teammate"

    fun run(label: String, block: suspend () -> Ownership) {
        busy = true
        actionError = null
        coroutines.launch {
            try {
                block()
                confirming = null
                haptics.confirm()
                scope.showMessage(label)
                onChanged()
            } catch (cause: Exception) {
                actionError = cause.userMessage()
                if (confirming == null) scope.showMessage(cause.userMessage())
            } finally {
                busy = false
            }
        }
    }

    /**
     * The three actions that move a business, each of which the server refuses
     * until it has seen a code (#537).
     *
     * A refusal naming one of the two proofs opens the dialog and the SAME attempt
     * is retried with the code — held whole rather than rebuilt, because rebuilding
     * it would be a chance to hand the business to somebody other than the person
     * named in the first attempt. Every other refusal stays an error, so "a transfer
     * is already in flight" is never dressed up as a code that could not have
     * helped.
     */
    fun attempt(pending: HandoverProof, code: String?) {
        busy = true
        actionError = null
        coroutines.launch {
            val outcome = attemptHandover(scope, pending, code, alreadyOpen = proof != null)
            when (outcome) {
                is HandoverOutcome.Done -> {
                    confirming = null
                    proof = null
                    codeRejected = false
                    haptics.confirm()
                    scope.showMessage(pending.label)
                    onChanged()
                }

                is HandoverOutcome.NeedsCode -> {
                    // A code that came back refused says so IN the dialog rather than
                    // closing it — the next thing to do is ask for another one.
                    codeRejected = outcome.refused
                    proof = pending.copy(kind = outcome.kind)
                    actionError = null
                }

                is HandoverOutcome.Failed -> {
                    // The proof dialog renders `rejected` and nothing else, so a refusal
                    // for some OTHER reason — "a transfer is already in flight" — used to
                    // sit behind it saying absolutely nothing. Drop the dialog first,
                    // then report where it can actually be read.
                    //
                    // This became reachable with #581/#7: before, a stale-factor retry
                    // was refused before the route ran, so the only answer it could get
                    // was another demand for proof. Now the retry carries a fresh proof
                    // and reaches the route, where the ordinary refusals live.
                    proof = null
                    codeRejected = false
                    actionError = outcome.message
                    if (confirming == null) scope.showMessage(outcome.message)
                }
            }
            busy = false
        }
    }

    SettingsCard(
        title = "Ownership",
        description = "The owner controls billing, the spending cap, and your numbers. " +
            "Only they can hand that on.",
    ) {
        val pending = state.pending
        if (pending != null) {
            PendingHandoverNotice(
                pending = pending,
                who = nameOf(pending.to_member_id),
                isOwner = state.i_am_owner,
                canCancel = state.can_cancel,
                busy = busy,
                onAccept = {
                    attempt(
                        HandoverProof(
                            action = "accept",
                            label = "You now own this workspace.",
                        ) { code -> scope.repo.acceptOwnership(scope.companyId, code) },
                        null,
                    )
                },
                onCancel = {
                    run("Stopped. Nothing changed hands.") {
                        scope.repo.cancelOwnershipTransfer(scope.companyId)
                    }
                },
            )
            Spacer(Modifier.height(14.dp))
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Owner",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (state.i_am_owner) "You" else nameOf(state.owner_member_id),
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        if (state.i_am_owner) {
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(14.dp))

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Backup owner",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                if (state.backup_member_id == null) {
                    StatusPill("Nobody named", PillTone.Warn)
                }
            }
            Spacer(Modifier.height(4.dp))
            // Loss aversion, stated once and plainly: this is the difference
            // between a bad week and a business nobody can run.
            ReadOnlyLine(
                "If you ever can't get in — you lose your email, or worse — this is the " +
                    "one person who can ask to take over. They wait a week, you can stop " +
                    "it with one click, and everyone gets told. Nothing changes today.",
            )
            Spacer(Modifier.height(8.dp))
            if (others.isEmpty()) {
                ReadOnlyLine("Invite someone first — a backup has to be on the team.")
            } else {
                MemberPicker(
                    label = members.firstOrNull { it.id == state.backup_member_id }
                        ?.display_name?.ifBlank { null } ?: "Nobody",
                    members = others,
                    includeNobody = true,
                    enabled = !busy,
                ) { picked ->
                    run(
                        if (picked == null) {
                            "Backup owner cleared."
                        } else {
                            "${nameOf(picked.id)} is your backup owner."
                        },
                    ) { scope.repo.setBackupOwner(scope.companyId, picked?.id) }
                }
            }

            if (state.can_offer && others.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(Modifier.height(14.dp))
                Text("Hand the workspace over", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                ReadOnlyLine("They have to accept. You stay on the team as an admin.")
                Spacer(Modifier.height(8.dp))
                MemberPicker(
                    label = offerTo?.display_name?.ifBlank { null } ?: "Choose a teammate",
                    members = others,
                    includeNobody = false,
                    enabled = !busy,
                ) { picked -> offerTo = picked }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { confirming = HandoverKind.OFFER },
                    enabled = !busy && offerTo != null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Hand it over")
                }
            }
        }

        if (state.can_claim) {
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(14.dp))
            Text("You are the backup owner", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(
                "If the owner can't act, you can ask to take over. They get a week to " +
                    "stop it, and everyone on the team is told straight away.",
            )
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { confirming = HandoverKind.CLAIM },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Ask to take over")
            }
        }
    }

    // Both of these hand a business to somebody. Neither gets a one-tap path —
    // the pause is the point, and the copy is what a person needs to have read
    // before they press it.
    when (confirming) {
        HandoverKind.OFFER -> ConfirmDialog(
            title = "Hand this workspace to ${offerTo?.display_name?.ifBlank { null } ?: "them"}?",
            body = "Nothing changes until they accept. When they do, they control " +
                "billing, the spending cap, and your numbers — and you stay on the team " +
                "as an admin. You can cancel any time before they accept, and everyone " +
                "will be told either way.",
            confirmLabel = "Offer it",
            pending = busy,
            error = actionError,
            onDismiss = { confirming = null },
            onConfirm = {
                val target = offerTo ?: return@ConfirmDialog
                attempt(
                    HandoverProof(
                        action = "offer",
                        label = "Offered to ${nameOf(target.id)}. They have 7 days to accept.",
                    ) { code ->
                        scope.repo.offerOwnership(scope.companyId, target.id, code)
                    },
                    null,
                )
            },
        )

        HandoverKind.CLAIM -> ConfirmDialog(
            title = "Ask to take over this workspace?",
            body = "The owner will be emailed straight away and can stop this with one " +
                "click for the next 7 days. Everyone on the team is told too. If nobody " +
                "stops it, you can complete the takeover after 7 days. Only do this if " +
                "the owner genuinely cannot act.",
            confirmLabel = "Ask to take over",
            pending = busy,
            error = actionError,
            onDismiss = { confirming = null },
            onConfirm = {
                attempt(
                    HandoverProof(
                        action = "claim",
                        label = "Asked. The owner has 7 days to stop it.",
                    ) { code -> scope.repo.claimOwnership(scope.companyId, code) },
                    null,
                )
            },
        )

        else -> Unit
    }

    proof?.let { pending ->
        HandoverConfirmDialog(
            kind = pending.kind,
            pending = busy,
            rejected = codeRejected,
            onConfirm = { code -> attempt(pending, code) },
            onResend = {
                coroutines.launch {
                    runCatching {
                        scope.repo.requestHandoverCode(scope.companyId, pending.action)
                    }
                    // Said either way. Whether an address exists is not ours to leak.
                    scope.showMessage("Sent. Check your email.")
                }
            },
            onDismiss = {
                proof = null
                codeRejected = false
            },
        )
    }
}

/**
 * The one thing on this screen that everybody sees, whether or not they can do
 * anything about it. Tinted rather than tucked into the body copy: somebody
 * scrolling past should not be able to miss that their workspace is changing
 * hands.
 */
@Composable
private fun PendingHandoverNotice(
    pending: PendingHandover,
    who: String,
    isOwner: Boolean,
    canCancel: Boolean,
    busy: Boolean,
    onAccept: () -> Unit,
    onCancel: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp)) {
            Icon(
                Icons.Outlined.GppMaybe,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    handoverHeadline(pending.kind, who),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    handoverDetail(
                        pending.kind, pending.ready, pending.ripens_at, pending.expires_at,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (pending.mine && pending.ready || canCancel) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (pending.mine && pending.ready) {
                            Button(onClick = onAccept, enabled = !busy) {
                                Text(
                                    if (pending.kind == HandoverKind.OFFER) {
                                        "Accept ownership"
                                    } else {
                                        "Complete the takeover"
                                    },
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                        }
                        if (canCancel) {
                            LinkButton(onClick = onCancel, enabled = !busy) {
                                // The owner's veto and the recipient's decline
                                // are the same button: this is not going ahead.
                                Text(handoverCancelLabel(isOwner, pending.mine))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A teammate picker. `includeNobody` is how a nomination gets cleared. */
@Composable
private fun MemberPicker(
    label: String,
    members: List<Member>,
    includeNobody: Boolean,
    enabled: Boolean,
    onPick: (Member?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(
            onClick = { open = true },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(label)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (includeNobody) {
                DropdownMenuItem(
                    text = { Text("Nobody") },
                    onClick = {
                        open = false
                        onPick(null)
                    },
                )
            }
            members.forEach { member ->
                DropdownMenuItem(
                    text = { Text(member.display_name.ifBlank { "A teammate" }) },
                    onClick = {
                        open = false
                        onPick(member)
                    },
                )
            }
        }
    }
}
