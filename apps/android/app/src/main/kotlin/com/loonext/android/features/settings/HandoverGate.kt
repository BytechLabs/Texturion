package com.loonext.android.features.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.net.ApiException
import com.loonext.android.core.ownership.HandoverConfirmation
import com.loonext.android.ui.common.userMessage

/**
 * #537 — the code the server wants before a business changes hands.
 *
 * THREE screens run these actions on this phone: the ownership card on Team, the #515
 * prompt on the settings index — which is the ONLY one the named backup can reach,
 * since they routinely have no `team.manage` — and releasing a number from Numbers. So
 * the rule lives here rather than in any of them: a gate the recovery valve did not
 * have is a recovery valve that does not work, and a rule copied into three screens is
 * a rule that is wrong in one of them.
 */

/**
 * A handover the server refused until it has seen proof.
 *
 * [attempt] is the action itself, held whole so the retry is the same handover to the
 * same person — rebuilding it would be a chance to hand the business to somebody
 * other than the one named in the first attempt. [action] is the server's own name
 * for it, because a code is scoped to one action: a code minted for an offer cannot
 * complete a takeover.
 */
internal data class HandoverProof(
    val action: String,
    val label: String,
    val kind: HandoverConfirmation.Kind = HandoverConfirmation.Kind.EMAIL,
    val attempt: suspend (String?) -> Unit,
)

/** What came back from one attempt. */
internal sealed interface HandoverOutcome {
    /** It went through. */
    data object Done : HandoverOutcome

    /**
     * The server named a proof it wants. [refused] is true only when a code was
     * actually sent and came back rejected, which is the one case the dialog says
     * something about.
     */
    data class NeedsCode(
        val kind: HandoverConfirmation.Kind,
        val refused: Boolean,
    ) : HandoverOutcome

    /** Refused for some other reason, which the person needs to read as itself. */
    data class Failed(val message: String) : HandoverOutcome
}

/**
 * Run one attempt and say what to do next.
 *
 * Only the refusals that NAME a proof divert to the dialog. Every other refusal comes
 * back as [HandoverOutcome.Failed] — so "a transfer is already in flight" is never
 * dressed up as a code that could not have helped.
 *
 * The email is requested here, on the way to opening the dialog, rather than left to
 * a button: a dialog whose only working control is "send it again" has wasted
 * somebody's time. [alreadyOpen] keeps a rejected code from quietly minting a new one
 * behind the person still looking at the old one.
 *
 * #581/#7 put a second question in front of the code: not what to say about it, but
 * WHERE IT IS CHECKED. Both answers are asked of
 * [HandoverConfirmation.goesToOurApi], never worked out here — the two kinds involved
 * read out word for word the same sentence, so anything deciding on the wording, or on
 * a kind named by hand, is one edit away from being wrong again.
 */
internal suspend fun attemptHandover(
    scope: SettingsScope,
    proof: HandoverProof,
    code: String?,
    alreadyOpen: Boolean,
): HandoverOutcome {
    // Digits that are not ours to check must not be sent to us. The kind held here is
    // the one the server named on the refusal that opened the dialog, so on the retry
    // this is already known before anything goes over the wire.
    if (code != null && !HandoverConfirmation.goesToOurApi(proof.kind)) {
        return proveFactorThenRetry(scope, proof, proof.kind, code)
    }
    try {
        proof.attempt(code)
        return HandoverOutcome.Done
    } catch (cause: Exception) {
        val kind = (cause as? ApiException)?.let { HandoverConfirmation.kindOf(it.code) }
            ?: return HandoverOutcome.Failed(cause.userMessage())
        // The refusal NAMES the kind, and that name outranks whatever we arrived
        // holding: a screen that rebuilds its request for each attempt gets here still
        // carrying the default one. So if the digits in hand turn out to have never
        // been ours to check, prove them now rather than posting them a second time —
        // posting them a second time is the forever loop, and the person is told their
        // own correct code is wrong.
        if (code != null && !HandoverConfirmation.goesToOurApi(kind)) {
            return proveFactorThenRetry(scope, proof, kind, code)
        }
        if (!alreadyOpen && kind == HandoverConfirmation.Kind.EMAIL) {
            // Best effort. A send that fails must not replace the demand with a
            // network error — the dialog still has a working "send it again".
            runCatching { scope.repo.requestHandoverCode(scope.companyId, proof.action) }
        }
        return HandoverOutcome.NeedsCode(kind, refused = code != null)
    }
}

/**
 * Prove the factor here, then run the action again carrying NO code.
 *
 * What the server refused was not a missing code — it was the AGE of the last proof on
 * this session. Nothing on that route reads a code, so the only thing that answers it
 * is proving the factor for real and coming back with a newer token.
 *
 * The dance is the one [com.loonext.android.features.auth.MfaGate] already uses,
 * deliberately unchanged: challenge the factor, answer it, and SAVE the session the
 * answer comes back with. Saving it is the entire point — the fresh token is what
 * carries the new proof time, and without it the app keeps presenting the old one and
 * the retry below is refused exactly as before.
 *
 * [kind] is carried in rather than assumed, so the dialog that stays up on a failure
 * is still the dialog the server asked for.
 */
private suspend fun proveFactorThenRetry(
    scope: SettingsScope,
    proof: HandoverProof,
    kind: HandoverConfirmation.Kind,
    code: String,
): HandoverOutcome {
    try {
        val token = scope.graph.api.freshSession()?.accessToken ?: error("signed out")
        // GET /v1/mfa returns verified factors only, so the first one is a real one.
        val id = scope.repo.mfa().factors.firstOrNull()?.id ?: error("no factor")
        val challenge = scope.graph.supabaseAuth.challengeFactor(token, id)
        val next = scope.graph.supabaseAuth.verifyFactor(
            token, id, challenge, code.filter { it.isDigit() },
        )
        scope.graph.sessionStore.save(next.toSession())
    } catch (_: Exception) {
        // The same one message our own API would have given, for the same reason:
        // telling a wrong code apart from an expired one helps whoever is guessing
        // more than it helps the owner, who types the next one either way. The dialog
        // stays up, which is where that next one goes.
        return HandoverOutcome.NeedsCode(kind, refused = true)
    }
    return try {
        proof.attempt(null)
        HandoverOutcome.Done
    } catch (cause: Exception) {
        val again = (cause as? ApiException)?.let { HandoverConfirmation.kindOf(it.code) }
            ?: return HandoverOutcome.Failed(cause.userMessage())
        // Still refused with a proof this fresh — a clock a long way out, or a factor
        // that is not the one this workspace is asking about. Say so once and stop:
        // proving again from here would be this same paragraph forever.
        HandoverOutcome.NeedsCode(again, refused = true)
    }
}

/**
 * The confirmation in front of a handover.
 *
 * ## Evaluation
 *
 * The server will not move a business without proof it is really the owner asking.
 * Three demands answer that — an authenticator, that same authenticator again because
 * the last time was too long ago, or a code emailed to the account —
 * and without this the refusal was a dead end on a phone: the action failed with a
 * message about a code there was nowhere to type.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — one field, one sentence, and the sentence differs by mechanism.
 * "Enter your code" is useless to somebody who does not know which code.
 *
 * *Smart Defaults* — a numeric keypad, and the email code is already sent by the time
 * the dialog is up.
 *
 * *Ethical Friction, deliberately* — this IS the friction and it belongs here, so
 * everything else about the dialog works to make the legitimate path quick: no typed
 * confirmation, no second checkbox, no countdown.
 *
 * Built on [ConfirmDialog] rather than a bespoke sheet so it inherits the pending
 * state, the inline error and the keyboard guard the rest of Settings already has.
 */
@Composable
internal fun HandoverConfirmDialog(
    kind: HandoverConfirmation.Kind,
    pending: Boolean,
    rejected: Boolean,
    onConfirm: (String) -> Unit,
    onResend: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Keyed on the kind so a second demand starts empty. Digits left in the field
    // from a refused attempt read as though the app were retrying by itself.
    var code by remember(kind) { mutableStateOf("") }

    // ...and emptied when a code comes back refused, which is the case that sentence was
    // written for and the key did not cover: a refusal does not change the KIND, so
    // nothing re-keyed and the rejected digits stayed there with Confirm still enabled.
    // An authenticator code has rotated by then, so pressing it again was certain to
    // fail — and on the emailed path it spent another of the five attempts doing so.
    LaunchedEffect(rejected) { if (rejected) code = "" }

    ConfirmDialog(
        title = HandoverConfirmation.TITLE,
        body = HandoverConfirmation.where(kind),
        confirmLabel = HandoverConfirmation.SUBMIT,
        confirmEnabled = HandoverConfirmation.isCode(code),
        pending = pending,
        error = if (rejected) HandoverConfirmation.REJECTED else null,
        onDismiss = onDismiss,
        onConfirm = { onConfirm(code) },
        extraContent = {
            OutlinedTextField(
                value = code,
                onValueChange = { code = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                singleLine = true,
                enabled = !pending,
                label = { Text(HandoverConfirmation.FIELD) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            )
            // Only on the email path. There is nothing to resend to somebody whose
            // app is generating the codes, and the button would imply otherwise.
            if (kind == HandoverConfirmation.Kind.EMAIL) {
                LinkButton(onClick = onResend, enabled = !pending) {
                    Text(HandoverConfirmation.RESEND)
                }
            }
        },
    )
}
