package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #515 — "if a user is asked to be a backup owner, that confirmation prompt is
 * in settings/team that they dont have access to."
 *
 * Every ownership control lived on the Team screen, and Team needs
 * `team.manage`. The named backup routinely has none of it — an owner may name
 * ANY active teammate, because a succession plan that only works for admins is
 * not a succession plan — so on this phone the person the whole mechanism
 * exists for had no path at all: no Team row in the settings index, no settings
 * deep link, and no URL bar to type around it with. The recovery valve was
 * unreachable by exactly the people it was built for.
 *
 * So the prompt comes to the settings INDEX, which every role opens — it is
 * literally the bookkeeper's entire app. It costs them no new permission:
 * GET /v1/company/ownership is mounted at `workspace.access` and decides every
 * button server-side, and this card asks the shared rule
 * ([viewerHandoverPrompt]) whether there is anything here for the reader. When
 * there is not — which is almost always, for almost everybody — it draws
 * nothing.
 *
 * Strictly first-person. A handover between two OTHER people is real news, but
 * it is news for the Team card and the crew-wide email, not for a row on
 * somebody's settings index.
 */
@Composable
fun OwnershipPrompt(scope: SettingsScope, onChanged: () -> Unit) {
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember(scope.companyId) { mutableStateOf<Ownership?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var proof by remember { mutableStateOf<HandoverProof?>(null) }
    var codeRejected by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current

    // Quiet on failure: this card is an extra on somebody else's screen, and a
    // flaky read of it must not turn the settings index into an error state.
    LaunchedEffect(scope.companyId, refreshKey) {
        state = runCatching { scope.repo.ownership(scope.companyId) }.getOrNull()
    }

    val current = state ?: return
    val kind = viewerHandoverPrompt(current) ?: return
    val pending = current.pending

    fun run(label: String, block: suspend () -> Ownership) {
        busy = true
        actionError = null
        coroutines.launch {
            try {
                state = block()
                confirming = false
                haptics.confirm()
                scope.showMessage(label)
                // Reload the hub around us: accepting rewrites the workspace's
                // owner, and the identity card above this one is showing it.
                // The caller's own ROLE moves too, and that lives in `me` —
                // one resync behind, which is why the toast says what changed
                // rather than leaving the screen to imply it.
                onChanged()
            } catch (cause: Exception) {
                actionError = cause.userMessage()
                if (!confirming) scope.showMessage(cause.userMessage())
            } finally {
                busy = false
                refreshKey++
            }
        }
    }

    /**
     * The two actions here that move a business, both of which the server refuses
     * until it has seen a code (#537).
     *
     * This card matters MORE than the one on Team for this: the named backup often
     * cannot open Team at all, so completing a takeover from here is the only path
     * they have. Cancelling stays ungated — stopping a handover is the safe
     * direction, and a code standing between somebody and "no" would be a trap.
     */
    fun attempt(pending: HandoverProof, code: String?) {
        busy = true
        actionError = null
        coroutines.launch {
            when (
                val outcome =
                    attemptHandover(scope, pending, code, alreadyOpen = proof != null)
            ) {
                is HandoverOutcome.Done -> {
                    proof = null
                    codeRejected = false
                    confirming = false
                    haptics.confirm()
                    scope.showMessage(pending.label)
                    onChanged()
                }

                is HandoverOutcome.NeedsCode -> {
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
                    if (!confirming) scope.showMessage(outcome.message)
                }
            }
            busy = false
            refreshKey++
        }
    }

    // PaperCard + the index's own 18/15 padding and micro-label caption, NOT
    // [SettingsCard]: that one carries its own 16dp horizontal inset for the
    // section screens, and inside the index's 18dp column it would sit visibly
    // narrower than every card around it.
    PaperCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 15.dp)) {
            Text(
                t("settingsMore.ownershipCaption"),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                handoverPromptHeadline(kind),
                style = MaterialTheme.typography.titleSmall,
            )
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(
                handoverPromptDetail(
                    kind,
                    ripensAt = pending?.ripens_at.orEmpty(),
                    expiresAt = pending?.expires_at.orEmpty(),
                ),
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                when (kind) {
                    HandoverPrompt.ACCEPT_OFFER, HandoverPrompt.COMPLETE_CLAIM -> {
                        Button(
                            onClick = {
                                attempt(
                                    HandoverProof(
                                        action = "accept",
                                        label = AppStrings.translate(
                                            locale,
                                            "settingsMore.nowOwn",
                                        ),
                                    ) { code ->
                                        state = scope.repo.acceptOwnership(
                                            scope.companyId,
                                            code,
                                        )
                                    },
                                    null,
                                )
                            },
                            enabled = !busy,
                        ) {
                            Text(
                                if (kind == HandoverPrompt.ACCEPT_OFFER) {
                                    t("settingsMore.acceptOwnership")
                                } else {
                                    t("settingsMore.completeTakeover")
                                },
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                    }

                    HandoverPrompt.BACKUP_STANDING -> {
                        OutlinedButton(onClick = { confirming = true }, enabled = !busy) {
                            Text(t("settingsMore.askTakeOver"))
                        }
                    }
                }
                val cancelLabel = handoverPromptCancelLabel(kind)
                if (cancelLabel != null && current.can_cancel) {
                    LinkButton(
                        onClick = {
                            run(
                                AppStrings.translate(
                                    locale,
                                    "settingsMore.handoverStopped",
                                ),
                            ) {
                                scope.repo.cancelOwnershipTransfer(scope.companyId)
                            }
                        },
                        enabled = !busy,
                    ) {
                        Text(cancelLabel)
                    }
                }
            }
        }
    }

    // Ethical friction, and the only place this card has any: asking to take
    // over is the one action that STARTS something. Accepting does not get a
    // second dialog — by then the owner has already been told and has already
    // had their week.
    if (confirming) {
        ConfirmDialog(
            title = t("settingsMore.claimTitle"),
            body = t("settingsMore.claimBody"),
            confirmLabel = t("settingsMore.askTakeOver"),
            pending = busy,
            error = actionError,
            onDismiss = { confirming = false },
            onConfirm = {
                attempt(
                    HandoverProof(
                        action = "claim",
                        label = AppStrings.translate(locale, "settingsMore.claimAsked"),
                    ) { code ->
                        state = scope.repo.claimOwnership(scope.companyId, code)
                    },
                    null,
                )
            },
        )
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
