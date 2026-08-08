package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.NumberAccessExplanation
import com.loonext.android.core.model.numberAccessLevelLabel
import com.loonext.android.core.model.numberAccessReason
import com.loonext.android.core.model.numberAccessSelfNote
import com.loonext.android.core.model.sortedForOwner
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.HeldNumbers
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberHealth
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import java.util.UUID

/** Everything the numbers screen shows, loaded together. */
private data class NumbersData(
    val numbers: List<PhoneNumberSummary>,
    /** #286: how many numbers this member cannot see. */
    val hiddenNumbers: Int,
    val ports: List<PortRequest>,
    val textEnablements: List<TextEnablementOrder>,
    val registration: RegistrationDetailPair,
)

/**
 * Numbers (#157): per-number cards with honest status states, the #106 access
 * dialog, owner-only typed-confirmation release, the add-a-number picker,
 * port-in tracker cards, text-enablement cards, and the 10DLC registration
 * stepper. Realtime `number.updated` / `registration.updated` / `port.updated`
 * events refetch (payloads are ID-only by design).
 */
@Composable
fun NumbersSection(
    scope: SettingsScope,
    company: CompanyView,
    onRefreshCompany: () -> Unit,
) {
    var refreshKey by remember { mutableIntStateOf(0) }
    // #176 cache-first: the whole numbers surface paints instantly from
    // StoreCache after the first in-process fetch; realtime and mutation
    // refreshKey bumps revalidate silently.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.numbers(scope.companyId),
        refreshKey = refreshKey,
    ) {
        val numbersPage = scope.repo.numbers(scope.companyId)
        NumbersData(
            numbers = numbersPage.data,
            hiddenNumbers = numbersPage.hidden_count,
            ports = scope.repo.ports(scope.companyId).data,
            textEnablements = scope.repo.textEnablements(scope.companyId).data,
            registration = scope.repo.registration(scope.companyId),
        )
    }
    LaunchedEffect(scope.companyId) {
        scope.graph.realtime.events.collect { event ->
            if (event.event == "number.updated" ||
                event.event == "registration.updated" ||
                event.event == "port.updated"
            ) {
                refreshKey++
            }
        }
    }
    // #215: this section had no reconnect subscriber — an in-foreground socket
    // re-JOIN must also refetch (a provisioning/10DLC frame may have been
    // skipped while the channel was down).
    LaunchedEffect(scope.companyId) {
        scope.graph.realtime.reconnected.collect { refreshKey++ }
    }
    // ...and a frame missed while backgrounded/blurred heals on return to the
    // foreground.
    ResyncOnResume(scope.companyId) { refreshKey++ }

    // #523: which numbers this workspace holds that its plan does not cover, and
    // both ways back. Owner/admin only — every /v1/billing route is behind
    // `billing.manage` — which is why [suspendedNumberNote] explains the hold
    // from `subscription_status` for everybody else and needs no read at all.
    //
    // ASKED ONLY WHEN THE ANSWER COULD BE ANYTHING BUT EMPTY. The company view
    // already carries every number's status, so "is anything suspended" is free,
    // and a workspace holding nothing must never pay for the round trip. Same
    // discipline as `missed-while-off` and the pause read on the billing screen.
    //
    // The COUNT is the re-ask key rather than a boolean: an upgrade to Pro
    // reinstates what the bigger allowance fits and can leave a third number
    // held, and a boolean would still read `true` afterwards while this screen
    // went on quoting the Starter allowance over a Pro subscription.
    val suspendedCount = company.numbers.count { it.status == NumberStatus.SUSPENDED }
    val canManageBilling = SettingsRoleGate.canManageBilling(scope.role)
    var held by remember(scope.companyId) { mutableStateOf<HeldNumbers?>(null) }
    LaunchedEffect(suspendedCount, canManageBilling, refreshKey, scope.companyId) {
        // A FAILED READ DRAWS NOTHING, and that is not the PauseRead hazard: the
        // note under the number still says it is on hold and still says it has
        // not been given up. Silence here claims nothing — it is the state that
        // existed before this route did.
        held = if (suspendedCount == 0 || !canManageBilling) {
            null
        } else {
            runCatching { scope.repo.heldNumbers(scope.companyId) }.getOrNull()
        }
    }

    // #525: is the plan paused? Asked here because the enable-US card charges a
    // one-time fee for a capability the pause defers, and the card has to say so
    // before somebody presses it.
    //
    // ASKED ONLY WHERE THE ANSWER COULD CHANGE A SENTENCE, the same discipline
    // the hold read above follows. The pause is a Stripe round trip; the only
    // reader whose words it changes is an owner looking at the enable-US card,
    // which is drawn for a CA workspace without US texting and nothing else. An
    // owner holds `billing.manage` (Capability.ALL), so this is never a 403.
    //
    // NOT KEYED ON `refreshKey`. Every realtime number, port and registration
    // frame bumps that, and none of them can change whether a plan is paused —
    // keying on it would spend a Stripe call per event for an answer that cannot
    // have moved. Pausing and resuming both happen on the billing screen, which
    // does its own read.
    val mayEnableUs = company.country == "CA" && !company.us_texting_enabled
    val mayPressEnableUs = SettingsRoleGate.canEnableUsTexting(scope.role)
    var pause by remember(scope.companyId) { mutableStateOf<PauseRead>(PauseRead.Unasked) }
    LaunchedEffect(mayEnableUs, mayPressEnableUs, scope.companyId) {
        // Unasked, and staying that way. Nobody is drawing a sentence that
        // depends on the answer, so there is nothing here to be wrong about.
        if (!mayEnableUs || !mayPressEnableUs) return@LaunchedEffect
        pause = PauseRead.Loading
        pause = runCatching { PauseRead.Answered(scope.repo.pauseState(scope.companyId)) }
            // A FAILED READ IS NOT "NOT PAUSED". [PauseRead.isPaused] is false
            // for it either way, which leaves the card saying exactly what it
            // said before this feature existed — the honest fallback, and the
            // reason the paused wording is additive rather than a rewrite.
            .getOrElse { PauseRead.Failed }
    }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 3)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val data = current.value
            val refresh: () -> Unit = {
                refreshKey++
                onRefreshCompany()
            }
            // Ported/hosted rows in flight render ONLY through their tracker
            // cards below — never as a fake "under a minute" number card.
            //
            // #523 ADDED THE SUSPENDED ARM. A ported line that goes on hold is
            // `source == "ported"` and no longer `active`, so it fell through
            // both arms and rendered nowhere at all — no card, and the tracker
            // below only covers a port still in flight. The oldest-first restore
            // makes this the likely case rather than a corner: the number a
            // workspace ported in most recently is exactly the one held. A row
            // that is suspended was live once, so it is never an in-flight port
            // and the reason for the original filter does not reach it.
            val cards = data.numbers.filter { number ->
                number.source == "provisioned" ||
                    number.status == NumberStatus.ACTIVE ||
                    number.status == NumberStatus.SUSPENDED
            }
            if (cards.isEmpty() && company.plan == null) {
                SettingsCard(title = "Your number") {
                    Text(
                        "No number yet. It's created automatically when your " +
                            "subscription starts.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            cards.forEach { number ->
                NumberCard(scope, company, number, held, onChanged = refresh)
            }
            // #286: what this member cannot reach, and WHY. Below the
            // cards, because it explains the shape of the list rather than
            // competing with it — the primary view stays about the numbers
            // they can use.
            //
            // It replaces the bare count that used to sit here. "Ask an owner
            // if you need them" was the cost #286 is about: a tech who cannot
            // tell a deliberate restriction from a broken app resolves it by
            // interrupting somebody, and the owner then has to work out which
            // of three rules they set months ago produced it.
            MyAccessCard(scope)
            AddNumberCard(scope, company, data.numbers, onChanged = refresh)
            // #523: the trackers read the SAME rows the cards above were built
            // from. A transfer's card and its number's card describe one line, so
            // they may not disagree about whether it works — and the only way to
            // guarantee that is one list, not two reads that can land a moment
            // apart.
            PortsBlock(scope, company, data.ports, data.numbers, onChanged = refresh)
            TextEnableBlock(scope, company, data.textEnablements, onChanged = refresh)
            RegistrationBlock(scope, company, data.registration, pause, onChanged = refresh)
        }
    }
}

// ---------------------------------------------------------------------------
// Per-number card
// ---------------------------------------------------------------------------

@Composable
private fun NumberCard(
    scope: SettingsScope,
    company: CompanyView,
    number: PhoneNumberSummary,
    /** #523: null for a member, for a failed read, and for nothing on hold. */
    held: HeldNumbers?,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    val canRelease = SettingsRoleGate.canReleaseNumber(scope.role)
    val released = number.status == NumberStatus.RELEASED
    // #523: the hold this card may be about, worked out once. The control and
    // the confirmation both read it, and the one thing worse than no Release
    // button on a held number is one whose dialog describes a different number.
    val heldOverAllowance =
        number.status == NumberStatus.SUSPENDED && company.subscriptionActive
    var releasing by remember { mutableStateOf(false) }
    var managingAccess by remember { mutableStateOf(false) }
    var managingIdentity by remember { mutableStateOf(false) }
    var managingHours by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }

    val display = number.number_e164?.let(::formatPhone)
        ?: number.requested_area_code?.let { "Area code $it" }
        ?: "Your number"

    SettingsCard(title = display) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            NumberStatusPill(number)
            Spacer(Modifier.width(8.dp))
            number.source?.let { source ->
                Text(
                    when (source) {
                        "ported" -> "Transferred in"
                        "hosted" -> "Text-enabled landline"
                        else -> "Loonext number"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.weight(1f))
            val e164 = number.number_e164
            if (e164 != null && !released) {
                IconButton(onClick = {
                    haptics.tap()
                    copyToClipboard(context, "Phone number", e164)
                    scope.showMessage("Number copied.")
                }) {
                    Icon(
                        Icons.Filled.ContentCopy,
                        contentDescription = "Copy number",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        when {
            released -> {
                Text(
                    number.number_e164?.let(::formatPhone).orEmpty(),
                    style = MaterialTheme.typography.bodyMedium.copy(
                        textDecoration = TextDecoration.LineThrough,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                number.released_at?.let { at ->
                    Text(
                        "Released ${relativeTime(at)} ago.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // #235: a carrier is filtering this line. Only the confident
            // 'degraded' state ever reaches a client — the server flattens the
            // internal 'watch' to healthy, because a maybe-degraded warning on
            // a thin sample is how a false alarm becomes a cancellation.
            number.status == NumberStatus.ACTIVE && number.health != null -> {
                Text(
                    "Messages from this number aren't arriving reliably",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    numberHealthCopy(number.health),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // #366: a crew bigger than one call can ring. Shown to EVERY
            // member, not only owners, because the person who most needs it is
            // the tech wondering why their phone rings less than a
            // colleague's — and with the fan-out now rotating per call, the
            // honest thing to say is about the workspace rather than them.
            ringCeilingLine(number) != null -> Text(
                ringCeilingLine(number)!!,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // #523: WHY it is on hold, which used to be one sentence for four
            // different causes — the payment-method one, which for an
            // over-allowance hold is false twice over: the card on file is fine,
            // and the billing portal it sent you to cannot fix an allowance.
            //
            // The note is drawn for EVERY role off the company view. The routes
            // and the button under it need `billing.manage` and the server's
            // answer, so they are simply absent for anybody else rather than
            // being a control that refuses. See [HeldNumberActions].
            number.status == NumberStatus.SUSPENDED -> {
                Text(
                    suspendedNumberNote(
                        company.subscription_status,
                        SettingsRoleGate.canManageBilling(scope.role),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HeldNumberActions(scope, company, number, held, onChanged)
            }

            number.status == NumberStatus.PROVISIONING -> Text(
                provisioningWaitCopy(number.created_at, System.currentTimeMillis()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            number.status == NumberStatus.PROVISION_FAILED -> {
                Text(
                    failedNumberCopy(number),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (canManage && needsNumberChoice(number)) {
                    OutlinedButton(
                        onClick = { choosing = true },
                        modifier = Modifier.padding(top = 8.dp),
                    ) { Text("Choose a number") }
                }
            }
        }

        // #523: RELEASE IS NOT AN ACTIVE-ONLY ACTION, and gating the whole row on
        // `active` meant a held number could not be given up from this phone at
        // all. Releasing it is the only way to stop us paying its carrier rent,
        // the only way to free the Starter slot, and the only way to satisfy the
        // Pro-to-Starter downgrade gate — so a mobile-only owner was stuck with a
        // line they could neither use nor end. The route has always allowed it:
        // `DELETE /v1/numbers/:id` refuses only a row that is already released.
        //
        // ONLY WHILE THE SUBSCRIPTION IS LIVE, which is the #523 hold exactly.
        // The other thing that suspends a number is a failed payment, and the
        // answer there is the card — offering to give a number up for good as
        // the way out of a card problem is a button somebody presses in a panic
        // and cannot undo. `suspendedNumberNote` already tells them what to fix.
        //
        // Configuring is still active-only. "How this line answers", "When this
        // line is open" and "Who can use this number" all describe a line that
        // is answering, and a held one is not.
        val configurable = !released && number.status == NumberStatus.ACTIVE
        val releasable =
            mayReleaseNumber(number.status, number.number_e164, company.subscriptionActive)

        if ((configurable && canManage) || (releasable && canRelease)) {
            Row(modifier = Modifier.padding(top = 6.dp)) {
                if (configurable && canManage) {
                    // #307: how the line ANSWERS, beside who can use it. The
                    // same kind of question about one number, and a second
                    // number is a second business.
                    LinkButton(onClick = { managingIdentity = true }) {
                        Text("How this line answers")
                    }
                    // #307: a SECOND entry rather than more rows in the first
                    // dialog — when the line is open is a different question,
                    // asked at a different time.
                    LinkButton(onClick = { managingHours = true }) {
                        Text("When this line is open")
                    }
                    LinkButton(onClick = { managingAccess = true }) {
                        Text("Who can use this number")
                    }
                }
                if (releasable && canRelease) {
                    LinkButton(onClick = { releasing = true }) {
                        Text(
                            "Release",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
        // Still only under a working number. Under a held one the note above has
        // already named who can act on it, and a second sentence saying the same
        // thing a different way reads as a runaround.
        if (configurable && !canManage) {
            ReadOnlyLine("Only owners and admins can manage numbers.")
        }
    }

    if (releasing && number.number_e164 != null) {
        ReleaseNumberDialog(
            scope = scope,
            number = number,
            // Told, never re-derived here: the dialog's words and the control
            // that opens it have to be about the same state, and the one thing
            // worse than no Release button on a held number is one whose
            // confirmation describes a different number.
            heldOverAllowance = heldOverAllowance,
            onDismiss = { releasing = false },
            onReleased = {
                releasing = false
                onChanged()
            },
        )
    }
    if (managingIdentity) {
        NumberIdentityDialog(
            scope = scope,
            number = number,
            onDismiss = { managingIdentity = false },
            onChanged = onChanged,
        )
    }
    if (managingHours) {
        NumberHoursDialog(
            scope = scope,
            number = number,
            onDismiss = { managingHours = false },
            onChanged = onChanged,
        )
    }
    if (managingAccess) {
        NumberAccessDialog(
            scope = scope,
            number = number,
            onDismiss = { managingAccess = false },
        )
    }
    if (choosing) {
        RemediateNumberFlow(
            scope = scope,
            company = company,
            number = number,
            onDismiss = { choosing = false },
            onDone = {
                choosing = false
                onChanged()
            },
        )
    }
}

@Composable
private fun NumberStatusPill(number: PhoneNumberSummary) {
    when (number.status) {
        NumberStatus.ACTIVE -> StatusPill("Active", PillTone.Positive)
        NumberStatus.PROVISIONING -> StatusPill("Setting up", PillTone.Warn)
        NumberStatus.SUSPENDED -> StatusPill("Suspended", PillTone.Warn)
        NumberStatus.RELEASED -> StatusPill("Released", PillTone.Neutral)
        NumberStatus.PROVISION_FAILED ->
            if (!needsNumberChoice(number)) {
                StatusPill("Setting up", PillTone.Warn)
            } else if (number.failure_reason == "timeout") {
                StatusPill("Action needed", PillTone.Warn)
            } else {
                StatusPill("Couldn't set up", PillTone.Bad)
            }

        else -> StatusPill(number.status, PillTone.Neutral)
    }
}

// ---------------------------------------------------------------------------
// Release (owner-only, type-the-number confirmation)
// ---------------------------------------------------------------------------

/**
 * Giving a number up, with the words that are true of THIS number.
 *
 * #523 SPLIT THE BODY IN TWO, because the one that shipped is false in both
 * directions for a held line. "A number is included, so you can set up a new one
 * here afterward" is the worst of it: a workspace on hold is over its allowance
 * by definition, so releasing brings it back TO the allowance — somebody who
 * followed that sentence would try to add a number and be charged for an extra
 * or refused at the Starter cap, having given up the number they already had.
 *
 * The held branch also says the thing the reader most needs to hear before an
 * irreversible press: this is not the only way out. Bringing it back leaves the
 * line working, and it is one screen tap away on the same card. Naming the
 * alternative in front of the destructive control is the honest shape of
 * *Ethical Friction* — the type-to-confirm below is the pause, this is the
 * reason somebody might use it.
 */
@Composable
private fun ReleaseNumberDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    /** #523: this number is on hold because the plan does not cover it. */
    heldOverAllowance: Boolean,
    onDismiss: () -> Unit,
    onReleased: () -> Unit,
) {
    val display = formatPhone(number.number_e164)
    var typed by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val expectedDigits = number.number_e164.orEmpty().filter(Char::isDigit)
    val typedDigits = typed.filter(Char::isDigit)
    val matches = expectedDigits.isNotEmpty() &&
        (typedDigits == expectedDigits || "1$typedDigits" == expectedDigits)

    // #537 audit: permanent, and whoever holds this number next receives the texts
    // this business's customers send it. Typing the number guards against a slip; it
    // is no guard at all against somebody who is not the owner.
    var proof by remember { mutableStateOf<HandoverProof?>(null) }
    var codeRejected by remember { mutableStateOf(false) }

    /** One attempt. The number is closed over, so a retry releases the same one. */
    fun attempt(code: String?) {
        pending = true
        error = null
        coroutines.launch {
            val request = HandoverProof(
                action = "release_number",
                label = "$display released.",
            ) { digits -> scope.repo.releaseNumber(scope.companyId, number.id, digits) }
            when (val outcome = attemptHandover(scope, request, code, proof != null)) {
                is HandoverOutcome.Done -> {
                    proof = null
                    codeRejected = false
                    scope.showMessage(request.label)
                    onReleased()
                }

                is HandoverOutcome.NeedsCode -> {
                    codeRejected = outcome.refused
                    proof = request.copy(kind = outcome.kind)
                }

                is HandoverOutcome.Failed -> {
                    proof = null
                    error = outcome.message
                }
            }
            pending = false
        }
    }

    ConfirmDialog(
        title = "Release $display?",
        body = releaseNumberBody(heldOverAllowance),
        confirmLabel = "Release number",
        destructive = true,
        pending = pending,
        error = error,
        confirmEnabled = matches,
        dismissLabel = "Keep the number",
        onDismiss = onDismiss,
        onConfirm = {
            haptics.reject()
            attempt(null)
        },
        extraContent = {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                singleLine = true,
                enabled = !pending,
                label = { Text("Type $display to confirm") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        },
    )

    // #537 audit: the proof the server asks for before the number is gone for good.
    proof?.let { pendingProof ->
        HandoverConfirmDialog(
            kind = pendingProof.kind,
            pending = pending,
            rejected = codeRejected,
            onConfirm = { code -> attempt(code) },
            onResend = {
                coroutines.launch {
                    runCatching {
                        scope.repo.requestHandoverCode(scope.companyId, pendingProof.action)
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

// ---------------------------------------------------------------------------
// #106 access dialog
// ---------------------------------------------------------------------------

private enum class AccessMode { Everyone, MembersView, Admins, Users }

@Composable
private fun NumberAccessDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
) {
    var loaded by remember { mutableStateOf<LoadState<Pair<NumberAccess, List<Member>>>>(LoadState.Loading) }
    var retryKey by remember { mutableIntStateOf(0) }
    var mode by remember { mutableStateOf(AccessMode.Everyone) }
    var level by remember { mutableStateOf(NumberAccessLevel.TEXT) }
    var pickedUserIds by remember { mutableStateOf(setOf<String>()) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    LaunchedEffect(number.id, retryKey) {
        loaded = LoadState.Loading
        loaded = try {
            val access = scope.repo.numberAccess(scope.companyId, number.id)
            val members = scope.repo.members(scope.companyId)
                .data.filter { it.deactivated_at == null && it.role == MemberRole.MEMBER }
            mode = when {
                access.access == NumberAccessKind.EVERYONE -> AccessMode.Everyone
                access.access == NumberAccessKind.ROLE && access.role == MemberRole.ADMIN ->
                    AccessMode.Admins

                access.access == NumberAccessKind.ROLE -> AccessMode.MembersView
                else -> AccessMode.Users
            }
            level = access.level ?: NumberAccessLevel.TEXT
            pickedUserIds = access.user_ids.toSet()
            LoadState.Ready(access to members)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    val display = number.number_e164?.let(::formatPhone) ?: "this number"

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("Who can use $display?") },
        text = {
            // #180: option rows stay reachable at any viewport height; the
            // member list keeps its own bounded scroll inside.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    "Owners and admins can always use every number.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                when (val current = loaded) {
                    is LoadState.Loading -> LoadingIndicator()
                    is LoadState.Failed -> Column {
                        Text(
                            current.message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = { retryKey++ },
                            modifier = Modifier.padding(top = 8.dp),
                        ) { Text("Try again") }
                    }

                    is LoadState.Ready -> {
                        val members = current.value.second
                        AccessModeOptions(
                            mode = mode,
                            onMode = { mode = it },
                            enabled = !pending,
                        )
                        if (mode == AccessMode.Users) {
                            Spacer(Modifier.height(8.dp))
                            if (members.isEmpty()) {
                                Text(
                                    "No active members to pick. Everyone else on the " +
                                        "team is an owner or admin.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                LazyColumn(Modifier.heightIn(max = 180.dp)) {
                                    items(members, key = { it.id }) { member ->
                                        val checked = member.user_id in pickedUserIds
                                        Row(
                                            Modifier
                                                .fillMaxWidth()
                                                .toggleable(
                                                    value = checked,
                                                    enabled = !pending,
                                                    onValueChange = { on ->
                                                        pickedUserIds =
                                                            if (on) pickedUserIds + member.user_id
                                                            else pickedUserIds - member.user_id
                                                    },
                                                )
                                                .padding(vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Checkbox(checked = checked, onCheckedChange = null)
                                            Spacer(Modifier.width(8.dp))
                                            Text(
                                                member.display_name.ifBlank { "Teammate" },
                                                style = MaterialTheme.typography.bodyMedium,
                                            )
                                        }
                                    }
                                }
                                Spacer(Modifier.height(6.dp))
                                listOf(
                                    NumberAccessLevel.TEXT to "Can text",
                                    NumberAccessLevel.NOTE to "View & notes only",
                                ).forEach { (value, label) ->
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .selectable(
                                                selected = level == value,
                                                enabled = !pending,
                                                onClick = { level = value },
                                            )
                                            .padding(vertical = 2.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(selected = level == value, onClick = null)
                                        Spacer(Modifier.width(6.dp))
                                        Text(label, style = MaterialTheme.typography.bodyMedium)
                                    }
                                }
                            }
                        }
                    }
                }
                InlineError(error)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val ready = loaded as? LoadState.Ready ?: return@Button
                    val activeMemberIds =
                        ready.value.second.map { it.user_id }.toSet()
                    // Stale/deactivated selections are silently dropped (web parity).
                    val picked = pickedUserIds.intersect(activeMemberIds).toList()
                    if (mode == AccessMode.Users && picked.isEmpty()) {
                        error = "Pick at least one person, or choose Everyone."
                        return@Button
                    }
                    pending = true
                    error = null
                    coroutines.launch {
                        try {
                            scope.repo.setNumberAccess(
                                scope.companyId,
                                number.id,
                                buildAccessBody(mode, level, picked),
                            )
                            haptics.confirm()
                            scope.showMessage("Access to $display updated.")
                            onDismiss()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            pending = false
                        }
                    }
                },
                enabled = loaded is LoadState.Ready && !pending,
            ) { Text(if (pending) "Saving…" else "Save") }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !pending) { Text("Cancel") }
        },
    )
}

private fun buildAccessBody(
    mode: AccessMode,
    level: String,
    pickedUserIds: List<String>,
): kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.buildJsonObject {
    when (mode) {
        AccessMode.Everyone -> put(
            "access",
            kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.EVERYONE),
        )

        AccessMode.MembersView -> {
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.ROLE))
            put("role", kotlinx.serialization.json.JsonPrimitive(MemberRole.MEMBER))
            put("level", kotlinx.serialization.json.JsonPrimitive(NumberAccessLevel.NOTE))
        }

        AccessMode.Admins -> {
            // Admins always have full access; the level is moot — send 'text'.
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.ROLE))
            put("role", kotlinx.serialization.json.JsonPrimitive(MemberRole.ADMIN))
            put("level", kotlinx.serialization.json.JsonPrimitive(NumberAccessLevel.TEXT))
        }

        AccessMode.Users -> {
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.USERS))
            put(
                "user_ids",
                kotlinx.serialization.json.JsonArray(
                    pickedUserIds.map { kotlinx.serialization.json.JsonPrimitive(it) },
                ),
            )
            put("level", kotlinx.serialization.json.JsonPrimitive(level))
        }
    }
}

@Composable
private fun AccessModeOptions(
    mode: AccessMode,
    onMode: (AccessMode) -> Unit,
    enabled: Boolean,
) {
    listOf(
        Triple(AccessMode.Everyone, "Everyone", "The whole team can text, like today."),
        Triple(
            AccessMode.MembersView,
            "Members: view & notes only",
            "Members can read and add notes, but not text. Admins still text.",
        ),
        Triple(AccessMode.Admins, "Admins only", "Members can't see this number at all."),
        Triple(
            AccessMode.Users,
            "Specific people",
            "Only the people you pick. Admins still text.",
        ),
    ).forEach { (value, label, detail) ->
        Row(
            Modifier
                .fillMaxWidth()
                .selectable(
                    selected = mode == value,
                    enabled = enabled,
                    onClick = { onMode(value) },
                )
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = mode == value, onClick = null, enabled = enabled)
            Spacer(Modifier.width(8.dp))
            Column {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Add a number (buy) + remediation
// ---------------------------------------------------------------------------

@Composable
private fun AddNumberCard(
    scope: SettingsScope,
    company: CompanyView,
    numbers: List<PhoneNumberSummary>,
    onChanged: () -> Unit,
) {
    if (!SettingsRoleGate.canManageNumbers(scope.role) || !company.subscriptionActive) return
    val facts = planFacts(company.plan, company.billing_currency, company.country) ?: return

    val liveCount = numbers.count { it.status != NumberStatus.RELEASED }
    val starterAtCap = company.plan == "starter" && liveCount >= 2
    if (starterAtCap) return
    val nextIsExtra = liveCount >= facts.numbers
    // #464: an extra number is available to US AND Canadian workspaces. This
    // used to require country == "US", which a Canadian workspace can never
    // satisfy — and the gate it hid behind (10DLC approval) is a US carrier
    // requirement that does not exist in Canada. Same rule as the server's
    // extraNumberBlockedReason; only the US branch has a wait.
    val extraBlockedReason = extraNumberBlockedReason(
        country = company.country,
        usTextingEnabled = company.us_texting_enabled,
        billingCurrency = company.billing_currency,
    )
    if (nextIsExtra && extraBlockedReason != null) {
        SettingsCard(title = "Add a number") {
            ReadOnlyLine("Your plan's numbers are all in use. $extraBlockedReason")
        }
        return
    }
    // #523 rule 2 / #522: this was `if (plan == "pro") "$4/mo" else "$5/mo"` —
    // two prices typed into the one card that asks for consent to the charge,
    // in a currency the workspace may not be billed in. The extra-number book is
    // filed in USD only, so a Canadian owner was quoted "$5" (which reads as
    // CA$5) for a line their card takes US$5 for. [extraNumberMonthly] resolves
    // the audience the same way the plan price and the registration fee do, and
    // `ExtraNumberPriceTest` pins the figures against the TypeScript.
    val extraPrice = extraNumberMonthly(company.plan, company.billing_currency, company.country)

    var picking by remember { mutableStateOf(false) }
    var idempotencyKey by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    SettingsCard(
        title = "Add a number",
        description = when {
            !nextIsExtra ->
                "Choose the number your customers will text. It's included in your " +
                    "plan at no extra cost."

            extraPrice != null ->
                "An extra number is $extraPrice, billed today. Your message allowance " +
                    "is shared, so an extra number doesn't add messages."

            // No figure to name — [extraNumberMonthly] does not guess a price
            // book for a plan it does not recognise. Says the shape of the
            // charge instead of inventing an amount, which is the one thing a
            // consent surface must never do.
            else ->
                "An extra number is billed to your plan today. Your message allowance " +
                    "is shared, so an extra number doesn't add messages."
        },
    ) {
        OutlinedButton(onClick = {
            // One key per attempt-intent: reused across retries of THIS
            // dialog, regenerated the next time it opens.
            idempotencyKey = UUID.randomUUID().toString()
            error = null
            picking = true
        }) { Text("Choose a number") }
    }

    if (picking) {
        NumberPickerDialog(
            scope = scope,
            country = company.country,
            initialAreaCode = company.requested_area_code.takeIf { it.isNotBlank() },
            title = "Choose a number",
            pending = pending,
            error = error,
            onDismiss = { if (!pending) picking = false },
            onPick = { choice ->
                pending = true
                error = null
                coroutines.launch {
                    try {
                        when (choice) {
                            is NumberChoice.Exact -> scope.repo.provisionNumber(
                                scope.companyId,
                                idempotencyKey,
                                chosenNumberE164 = choice.e164,
                            )

                            is NumberChoice.AreaCode -> scope.repo.provisionNumber(
                                scope.companyId,
                                idempotencyKey,
                                requestedAreaCode = choice.code,
                            )
                        }
                        picking = false
                        haptics.confirm()
                        scope.showMessage("Your number is being set up.")
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        pending = false
                    }
                }
            },
        )
    }
}

@Composable
private fun RemediateNumberFlow(
    scope: SettingsScope,
    company: CompanyView,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    NumberPickerDialog(
        scope = scope,
        country = number.country,
        initialAreaCode = number.requested_area_code,
        title = "Choose a number to finish setup",
        pending = pending,
        error = error,
        onDismiss = { if (!pending) onDismiss() },
        onPick = { choice ->
            pending = true
            error = null
            coroutines.launch {
                try {
                    when (choice) {
                        is NumberChoice.Exact -> scope.repo.remediateNumber(
                            scope.companyId,
                            number.id,
                            chosenNumberE164 = choice.e164,
                        )

                        is NumberChoice.AreaCode -> scope.repo.remediateNumber(
                            scope.companyId,
                            number.id,
                            requestedAreaCode = choice.code,
                        )
                    }
                    haptics.confirm()
                    scope.showMessage("Setup restarted. You won't be charged again.")
                    onDone()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
    )
}

/**
 * #235 — what a degraded number is told to its owner.
 *
 * Ported 1:1 from web's `number-health-notice.tsx` and iOS's
 * `NumberHealthNotice`, because a crew with two devices must not read two
 * different accounts of the same problem.
 *
 * It never says "spam" or "flagged": we know delivery fell, we do not know
 * which vendor labelled it or whether one did, and naming a cause we have not
 * established would be a guess dressed as a diagnosis. It also promises no
 * self-serve fix — remediation is registry paperwork that takes days.
 */
internal fun numberHealthCopy(health: NumberHealth): String {
    val opening = health.delivery_rate?.let {
        "About ${Math.round(it * 100)}% of your recent texts were delivered, " +
            "which is below normal for this number."
    } ?: "Fewer of your texts are getting through than usual."
    return opening +
        " Carriers sometimes start filtering a number — often one that was " +
        "reused from a previous business. We've been alerted and we're on it; " +
        "you don't need to do anything yet."
}

/**
 * #523 — may this number be given up right now?
 *
 * ── THIS IS THE AGREED RULE FOR ALL THREE CLIENTS ──────────────────────────
 *
 * It was written here first and the other two adopted it, so the argument is
 * recorded here in full for whoever reads their copy next. One irreversible
 * control must not answer differently depending on which device is in the
 * owner's hand: web offered Release on ANY unreleased row with digits (a
 * past-due suspension included), iOS offered it on active-or-suspended with no
 * subscription term, and Android on the three terms below. The strictest of the
 * three is the one with a reason, so it won:
 *
 *   status is ACTIVE                          — a working line can be given up
 *   or status is SUSPENDED and the
 *     subscription is live                    — the #523 hold, and only that
 *   and the row has digits to type back       — the confirmation demands them
 *
 * Everything else — a released row, one still provisioning, one whose
 * provisioning failed — is refused, and each of those has its own control: a
 * released number is already gone, and a failed one is answered by "Choose a
 * number", which keeps the slot rather than burning it.
 *
 * ACTIVE, or ON HOLD WHILE THE SUBSCRIPTION IS LIVE. The second half is the fix:
 * this was gated on `active` alone, so a held number could not be released from
 * the phone at all — and releasing it is the only way to stop us paying its
 * carrier rent, the only way to free the Starter slot, and the only way to
 * satisfy the Pro-to-Starter downgrade gate. A mobile-only owner had a line they
 * could neither use nor end. `DELETE /v1/numbers/:id` has always allowed it; it
 * refuses only a row that is already released.
 *
 * AND NOT WHILE THE PAYMENT IS THE PROBLEM. `subscriptionActive` is the same
 * field the server splits `over_plan_allowance` from `subscription_inactive` on,
 * so this admits exactly the #523 hold. A past-due workspace has every number
 * suspended and the answer is the card — putting an irreversible "give it up for
 * good" in front of somebody whose real problem is a declined payment is a press
 * made in a panic that nothing can undo.
 *
 * A NUMBER WITH NO DIGITS IS NOT RELEASABLE either, and that is not only a
 * cosmetic point about the confirmation box: the dialog asks the reader to type
 * the number back, which nobody can do for a row that has none.
 */
internal fun mayReleaseNumber(
    status: String?,
    numberE164: String?,
    subscriptionActive: Boolean,
): Boolean {
    if (numberE164 == null) return false
    return when (status) {
        NumberStatus.ACTIVE -> true
        NumberStatus.SUSPENDED -> subscriptionActive
        else -> false
    }
}

/**
 * #523 — what giving this number up actually does, which is not the same
 * sentence for a working line and a held one.
 *
 * THE SHIPPED COPY IS FALSE FOR A HOLD, and the last clause is the expensive
 * part: "a number is included, so you can set up a new one here afterward". A
 * workspace on hold is over its allowance by definition, so releasing brings it
 * back TO the allowance and no further — somebody who believed that sentence
 * would give up the number they had and then be charged for an extra, or refused
 * outright at the Starter cap.
 *
 * THE HELD BRANCH NAMES THE ALTERNATIVE FIRST. Bringing the number back leaves
 * the line working and the control for it is on the same card, so a reader who
 * has arrived at the irreversible button by process of elimination should be
 * told there was no elimination to do. That is what the friction is for; the
 * type-the-number box below is the pause, this is the reason to use it.
 */
internal fun releaseNumberBody(heldOverAllowance: Boolean): String = if (heldOverAllowance) {
    "This is a number your plan doesn't cover, and releasing it is the other way " +
        "out of that hold — it ends the hold by giving the number up rather than " +
        "by bringing it back. Customers who text it won't reach you afterward, and " +
        "you can't get the same number back. Your plan stops being over its " +
        "allowance, and what you pay doesn't change. Type the number to confirm."
} else {
    "This gives the number up for good. Customers who text it won't reach you, " +
        "and you can't get the same number back. It doesn't change your plan or " +
        "what you pay. A number is included, so you can set up a new one here " +
        "afterward. Type the number to confirm."
}

/**
 * #464: why this workspace cannot buy one more number, or null when it can.
 *
 * Hand-ported from packages/shared/src/extra-numbers.ts and covered by the
 * same vectors, because a client that disagrees with the server here either
 * hides a purchase the server would allow or offers one it would refuse.
 *
 * The Starter total cap is checked by the caller (it already counts live
 * numbers), so this covers only the country/registration half.
 */
internal fun extraNumberBlockedReason(
    country: String,
    usTextingEnabled: Boolean,
    billingCurrency: String?,
): String? {
    if (country != "US" && country != "CA") {
        return "Extra numbers are available for US and Canadian workspaces."
    }
    // US only: the carriers must approve the brand before a US number can text.
    if (country == "US" && !usTextingEnabled) {
        return "An extra number needs US texting turned on for your workspace first."
    }
    // #522: a Stripe subscription bills in ONE currency and every item on it has
    // to carry an amount in that currency. The extra-number prices are filed in
    // USD only, so a subscription billed in anything else is refused outright by
    // Stripe. Better a sentence here than a tap that becomes an error.
    //
    // A NULL or unrecognised value reads as USD, matching `billingCurrencyOf`
    // on the server: this gate must never refuse a sale because a field was
    // missing from an older response.
    val currency = billingCurrency?.trim()?.lowercase()
    if (currency != null && currency.isNotEmpty() && currency != EXTRA_NUMBER_CURRENCY) {
        return "Extra numbers are priced in US dollars and can't be added to a " +
            "subscription billed in another currency yet. Contact support and " +
            "we'll sort it out."
    }
    return null
}

/**
 * #522: the currency the extra-number prices are filed in. Mirror of
 * EXTRA_NUMBER_CURRENCY in packages/shared/src/extra-numbers.ts.
 */
internal const val EXTRA_NUMBER_CURRENCY = "usd"

/**
 * #286 — what this member cannot reach, and why.
 *
 * Hand-port of `apps/web/src/components/settings/my-access-card.tsx`.
 *
 * Only the RESTRICTED rows: the numbers they can fully use are the cards above
 * this one, and repeating them would make this a second copy of that list
 * rather than an answer to the question the reader actually has.
 *
 * Renders nothing for anybody who reaches everything — every owner and admin,
 * and most members. A panel reassuring somebody about a problem they do not
 * have is furniture, and furniture is not read.
 */
@Composable
private fun MyAccessCard(scope: SettingsScope) {
    var rows by remember { mutableStateOf<List<NumberAccessExplanation>>(emptyList()) }

    LaunchedEffect(scope.companyId) {
        // A read that fails hides the card rather than showing an error about
        // a screen the member did not ask for.
        rows = runCatching { scope.repo.myNumberAccess(scope.companyId).numbers }
            .getOrDefault(emptyList())
    }

    val note = numberAccessSelfNote(rows) ?: return
    val restricted = rows.sortedForOwner().filter { it.level != "text" }

    SettingsCard(
        title = "What you can reach",
        description = "Some of this workspace's numbers are not shared with " +
            "you. Here is which, and what decided it.",
    ) {
        Text(note, style = MaterialTheme.typography.bodyMedium)
        restricted.forEach { row ->
            Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        row.number_e164?.let { formatPhone(it) } ?: "A number",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        numberAccessLevelLabel(row.level),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    numberAccessReason(row.decided_by, row.principal, self = true),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
