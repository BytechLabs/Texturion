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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
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
    // Every sentence below that names somebody is written from a coroutine, so
    // the reader's language is read here and carried into them.
    val locale = LocalAppLocale.current

    val others = members.filter {
        it.deactivated_at == null && it.id != state.owner_member_id
    }
    fun nameOf(memberId: String?): String =
        members.firstOrNull { it.id == memberId }?.display_name?.ifBlank { null }
            ?: AppStrings.translate(locale, "settingsMore.aTeammate")

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
                actionError = cause.userMessage(locale)
                if (confirming == null) scope.showMessage(cause.userMessage(locale))
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
            val outcome = attemptHandover(
                scope, pending, code, alreadyOpen = proof != null, locale = locale,
            )
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
        title = t("settingsMore.ownershipTitle"),
        description = t("settingsMore.ownershipDesc"),
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
                            label = AppStrings.translate(locale, "settingsMore.nowOwn"),
                        ) { code -> scope.repo.acceptOwnership(scope.companyId, code) },
                        null,
                    )
                },
                onCancel = {
                    run(AppStrings.translate(locale, "settingsMore.handoverStopped")) {
                        scope.repo.cancelOwnershipTransfer(scope.companyId)
                    }
                },
            )
            Spacer(Modifier.height(14.dp))
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                t("settingsMore.owner"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (state.i_am_owner) {
                    t("settingsMore.you")
                } else {
                    nameOf(state.owner_member_id)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        if (state.i_am_owner) {
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(14.dp))

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    t("settingsMore.backupOwner"),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                if (state.backup_member_id == null) {
                    StatusPill(t("settingsMore.nobodyNamed"), PillTone.Warn)
                }
            }
            Spacer(Modifier.height(4.dp))
            // Loss aversion, stated once and plainly: this is the difference
            // between a bad week and a business nobody can run.
            ReadOnlyLine(t("settingsMore.backupOwnerExplain"))
            Spacer(Modifier.height(8.dp))
            if (others.isEmpty()) {
                ReadOnlyLine(t("settingsMore.inviteBackupFirst"))
            } else {
                MemberPicker(
                    label = members.firstOrNull { it.id == state.backup_member_id }
                        ?.display_name?.ifBlank { null } ?: t("settingsMore.nobody"),
                    members = others,
                    includeNobody = true,
                    enabled = !busy,
                ) { picked ->
                    run(
                        if (picked == null) {
                            AppStrings.translate(locale, "settingsMore.backupCleared")
                        } else {
                            AppStrings.translate(
                                locale,
                                "settingsMore.backupSet",
                                mapOf("name" to nameOf(picked.id)),
                            )
                        },
                    ) { scope.repo.setBackupOwner(scope.companyId, picked?.id) }
                }
            }

            if (state.can_offer && others.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(Modifier.height(14.dp))
                Text(
                    t("settingsMore.handOverTitle"),
                    style = MaterialTheme.typography.titleSmall,
                )
                Spacer(Modifier.height(4.dp))
                ReadOnlyLine(t("settingsMore.handOverNote"))
                Spacer(Modifier.height(8.dp))
                MemberPicker(
                    label = offerTo?.display_name?.ifBlank { null }
                        ?: t("settingsMore.chooseTeammate"),
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
                    Text(t("settingsMore.handItOver"))
                }
            }
        }

        if (state.can_claim) {
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(14.dp))
            Text(
                t("settingsMore.youAreBackup"),
                style = MaterialTheme.typography.titleSmall,
            )
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settingsMore.claimExplain"))
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { confirming = HandoverKind.CLAIM },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("settingsMore.askTakeOver"))
            }
        }
    }

    // Both of these hand a business to somebody. Neither gets a one-tap path —
    // the pause is the point, and the copy is what a person needs to have read
    // before they press it.
    when (confirming) {
        HandoverKind.OFFER -> ConfirmDialog(
            title = t(
                "settingsMore.handToTitle",
                "name" to (
                    offerTo?.display_name?.ifBlank { null } ?: t("settingsMore.them")
                    ),
            ),
            body = t("settingsMore.handOverBody"),
            confirmLabel = t("settingsMore.offerIt"),
            pending = busy,
            error = actionError,
            onDismiss = { confirming = null },
            onConfirm = {
                val target = offerTo ?: return@ConfirmDialog
                attempt(
                    HandoverProof(
                        action = "offer",
                        label = AppStrings.translate(
                            locale,
                            "settingsMore.offeredTo",
                            mapOf("name" to nameOf(target.id)),
                        ),
                    ) { code ->
                        scope.repo.offerOwnership(scope.companyId, target.id, code)
                    },
                    null,
                )
            },
        )

        HandoverKind.CLAIM -> ConfirmDialog(
            title = t("settingsMore.claimTitle"),
            body = t("settingsMore.claimBody"),
            confirmLabel = t("settingsMore.askTakeOver"),
            pending = busy,
            error = actionError,
            onDismiss = { confirming = null },
            onConfirm = {
                attempt(
                    HandoverProof(
                        action = "claim",
                        label = AppStrings.translate(locale, "settingsMore.claimAsked"),
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
                    scope.showMessage(
                        AppStrings.translate(locale, "settingsMore.codeSent"),
                    )
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
    val locale = LocalAppLocale.current
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
                    handoverHeadline(pending.kind, who, locale),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    handoverDetail(
                        pending.kind,
                        pending.ready,
                        pending.ripens_at,
                        pending.expires_at,
                        locale,
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
                                        t("settingsMore.acceptOwnership")
                                    } else {
                                        t("settingsMore.completeTakeover")
                                    },
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                        }
                        if (canCancel) {
                            LinkButton(onClick = onCancel, enabled = !busy) {
                                // The owner's veto and the recipient's decline
                                // are the same button: this is not going ahead.
                                Text(handoverCancelLabel(isOwner, pending.mine, locale))
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
        val fallbackName = t("settingsMore.aTeammateCapital")
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (includeNobody) {
                DropdownMenuItem(
                    text = { Text(t("settingsMore.nobody")) },
                    onClick = {
                        open = false
                        onPick(null)
                    },
                )
            }
            members.forEach { member ->
                DropdownMenuItem(
                    text = { Text(member.display_name.ifBlank { fallbackName }) },
                    onClick = {
                        open = false
                        onPick(member)
                    },
                )
            }
        }
    }
}
