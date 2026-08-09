package com.loonext.android.features.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.BillingModule
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.OpenPrepaidYear
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.features.contacts.ContactMutations
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val FULL_DATE = DateTimeFormatter.ofPattern("MMMM d, yyyy")

private fun fullDate(iso: String?): String? = iso?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.systemDefault()).format(FULL_DATE) }
        .getOrNull()
}

/**
 * #490: "today" / "yesterday" / "on 12 July".
 *
 * A relative day rather than a timestamp: the reader's question is "is this
 * still happening?", and "yesterday" answers it where an ISO string makes them
 * work it out. Past a couple of days the date is the more useful answer,
 * because by then the question has become "how long has this been going on".
 */
private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMMM")

private fun relativeDay(iso: String?): String? = iso?.let {
    runCatching {
        val zone = ZoneId.systemDefault()
        val then = Instant.parse(it).atZone(zone).toLocalDate()
        when (val days = java.time.temporal.ChronoUnit.DAYS.between(then, java.time.LocalDate.now(zone))) {
            in Long.MIN_VALUE..0L -> "today"
            1L -> "yesterday"
            else -> {
                @Suppress("UNUSED_EXPRESSION") days
                "on " + then.format(DAY_MONTH)
            }
        }
    }.getOrNull()
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
    // #277 follow-up: the `missing_feature` answer names the help screen, and
    // sections do not own the section stack — the host does (#200). Defaulted
    // so a caller that has not been taught about it still compiles; the button
    // is simply not offered rather than doing nothing when pressed.
    onOpenHelp: (() -> Unit)? = null,
    // #523: the same #200 contract as [onOpenHelp] — a section does not own the
    // section stack, the host does. The hold explained on the plan card is acted
    // on under Numbers, and a pointer somebody has to navigate to by hand is
    // most of the way back to the defect this exists to fix.
    onOpenNumbers: (() -> Unit)? = null,
) {
    val canManage = SettingsRoleGate.canManageBilling(scope.role)

    // #277: the pause, read ONCE for the whole screen and threaded down.
    //
    // NOT ON `company_view`, deliberately — that read runs on every app boot for
    // every role and this is a billing fact that costs a Stripe round trip. So
    // it is asked here, and only where an answer could change what is drawn: a
    // workspace with no plan cannot pause, and a cancelled one is answered by
    // the card that has already taken over the plan slot.
    //
    // WHAT IS HELD IS THE READ, NOT THE ANSWER, and that is the fix for the
    // worst thing this screen has done. A nullable `PauseState` meant "not
    // asked", "asked and told no" and "the ask failed" with the same value, and
    // all three rendered as an ordinary running plan — so a paused workspace
    // whose read failed was shown a green Active pill, allowances for a plan
    // that is not running, and a plan-switch button that 409s by design. See
    // [PauseRead]: only an answer licenses a claim in either direction.
    var pauseReads by remember { mutableIntStateOf(0) }
    var pause by remember(scope.companyId) { mutableStateOf<PauseRead>(PauseRead.Unasked) }
    val asksAboutPause = canManage &&
        company.plan != null &&
        company.subscription_status != SubscriptionStatus.CANCELED
    LaunchedEffect(asksAboutPause, pauseReads, scope.companyId) {
        if (!asksAboutPause) return@LaunchedEffect
        // "Asked, nothing back yet" only while there is genuinely nothing. A
        // revalidation after a pause or a resume already HAS an answer — the
        // route's own re-read of the mirror — and blanking it here would flip
        // the card out of Paused and back on every refresh.
        if (pause !is PauseRead.Answered) pause = PauseRead.Loading
        pause = runCatching { PauseRead.Answered(scope.repo.pauseState(scope.companyId)) }
            // A FAILED READ IS NOT AN ANSWER, and it is certainly not "not
            // paused". Where an answer is already in hand it stands — it came
            // from this same route and nothing newer has contradicted it — and
            // where there is none the card says so rather than guessing.
            .getOrElse { pause as? PauseRead.Answered ?: PauseRead.Failed }
    }
    // What a pause or a resume actually DID, told from the API's own re-read of
    // the mirror rather than assumed from the fact that a button was pressed.
    // The re-read that follows is revalidation, not the source of truth.
    val onPauseChanged: (PauseState) -> Unit = { settled ->
        pause = PauseRead.Answered(settled)
        pauseReads++
    }

    StatusNotices(scope, company, canManage)
    // #490: directly under the notice that says the line is off, because it is
    // the consequence of that sentence rather than a separate topic.
    MissedWhileOffNote(scope, company)
    // #481: only for a workspace on its way out. Directly under the count of
    // customers who rang into nothing, because this is what to DO about that.
    OffRampCard(scope, company)
    // #277: the paused state rides ON the plan card rather than arriving as a
    // card of its own. Being paused IS a plan fact, and a new card here would
    // be new content above the button that leaves — which is the one thing this
    // screen's layout rule forbids.
    PlanCard(
        scope,
        company,
        canManage,
        onRefreshCompany,
        onOpenHelp,
        pause,
        onPauseChanged,
        onRetryPause = { pauseReads++ },
        onOpenNumbers = onOpenNumbers,
    )
    // #523 IS STILL NOT A CARD HERE, and the reason is the rule directly above
    // [CancelCard]: nothing new renders between landing on this screen and the
    // button that leaves. A held-number card would be exactly what that rule
    // forbids — height between a thumb and the exit, carrying an upsell ("move
    // to Pro", "buy an extra number") whatever its intent.
    //
    // WHAT CHANGED IS THAT THE SCREEN NO LONGER SAYS NOTHING. `noticeHeldNumbers`
    // mails and pushes `/settings/billing`, so this is where an owner who was
    // told a number is on hold arrives — and a plan card listing an allowance
    // without mentioning that the workspace is over it was the tap landing
    // nowhere. The hold now rides ON that card, the way #277 put the paused state
    // there: it is a fact about the plan, and the sentence it finishes ("· 1
    // phone number") is already printed three lines above it. No card, no price,
    // no second button — see [heldNumbersPlanNote].
    //
    // The CONTROLS stay on the numbers screen, attached to the card for the
    // number they act on: that is where somebody goes when a line is not
    // working, and every role can read the explanation there where
    // /v1/billing/held-numbers is owner-only. See [suspendedNumberNote].
    // NOT WHILE PAUSED, AND NOT WHILE WE DO NOT KNOW. Enabling a module invoices
    // immediately (`always_invoice`), so an owner on a paused workspace would be
    // charged on the spot for the voice module on a line that cannot dial. The
    // API refuses it, and a control whose only outcome is a refusal is a control
    // that should not have been drawn. `isRunning` rather than `!isPaused`: an
    // unanswered read is not permission to sell something.
    if (canManage && company.plan != null && company.subscriptionActive && pause.isRunning) {
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
            CancelCard(scope, company, onRefreshCompany, onOpenHelp, pause, onPauseChanged)
        }
        // #288/#399: the referral link, on the billing screen because the reward
        // is a month off the invoice, and behind the same billing.manage gate for
        // the same reason. Only on a plan we are told is running — a workspace
        // with nothing to discount cannot be paid, and offering the month anyway
        // would be an offer we already know we will not keep.
        //
        // BELOW THE CANCEL CARD, and `PauseOfferTest` is what says so: nothing new
        // may render above the way out, because every card added there is height
        // between a thumb and that button. An invitation to go and recommend us is
        // the last thing that should stand between an owner and leaving.
        if (company.plan != null && company.subscriptionActive) {
            ReferralCardSection(scope)
        }
    } else {
        SettingsCard(title = "Billing") {
            ReadOnlyLine("Only owners and admins can change billing.")
        }
    }
}

/**
 * #288/#399 — the referral card and the read behind it.
 *
 * Its own read rather than a field on the billing payload: `ensureReferralCode`
 * MINTS a code the first time it is asked for, and putting that behind the boot
 * read would mint one for every workspace that has ever opened settings. The
 * first person who looks at this card gets one.
 *
 * Silent on failure, like the other conditional cards here. This is an offer,
 * and a settings screen showing a broken panel looks like the settings are
 * broken.
 */
@Composable
private fun ReferralCardSection(scope: SettingsScope) {
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.referrals(scope.companyId),
    ) { scope.graph.forYouRepo.referrals(scope.companyId) }
    val view = (state as? LoadState.Ready)?.value ?: return
    ReferralCard(view)
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

/**
 * #277: the one screen somebody leaving sees.
 *
 * THE RULE THIS SCREEN IS BUILT AGAINST. Cancelling must never take more steps
 * or more time than subscribing did, and regulators in several of the markets
 * we sell into enforce against exactly that. So: one card, nothing hidden
 * behind a second tap, no confirmation dialog, and no control that stays
 * disabled until a question is answered. Where any of that would have improved
 * a save rate, the save rate loses.
 *
 * NOTHING IS COLLAPSED, AND THAT IS THE POINT. The card renders open. No
 * trigger, no sheet, no expand: a control that reveals the screen holding the
 * cancel button IS a step, and it makes leaving cost two taps where the
 * "Manage payment & invoices" button directly above costs one. Do not copy the
 * collapse out of DeleteAccountCard into this file. The two are opposite cases.
 * Deleting an account cannot be undone, so a deliberate pause is a kindness
 * there; a subscription can be restarted in a minute, and the same pause here
 * is the thing the rule forbids.
 *
 * THE WAY THROUGH IS ONE TAP. From landing on the billing screen, somebody who
 * answers nothing reaches Stripe with a single press. There is deliberately no
 * "Never mind" beside it: with nothing hidden there is nothing to back out of,
 * and a second button there invites the styling asymmetry (a loud stay, a quiet
 * leave) this card exists to avoid.
 *
 * THE QUESTION IS SUBORDINATE. It sits under the consequence copy in the same
 * muted voice as the supporting text everywhere else in settings, because a
 * billing screen should not shout "why are you leaving?" at somebody who came
 * to check their plan. Quiet question, plain exit: the button that leaves is
 * the only filled control on the card.
 *
 * WHY THE QUESTION IS HERE AT ALL. Afterwards they are gone, and nobody answers
 * a survey about a product they have just left. But saying why is not leaving.
 * The API records a statement and the Stripe webhook confirms it later, so a
 * person who reads this screen and stays is counted separately from one who
 * goes, and that second number is the only honest measure of anything we might
 * put on this screen.
 *
 * THE DATA LEAVES WITH THEM. The export sits between the question and the
 * button, so the last thing offered before the handoff is their own customer
 * list. Somebody winding down a business still needs it, and "they made it hard
 * to leave with their own data" is the story told about a company afterwards.
 * It is offered whether they go through with the cancellation or not.
 *
 * NO SAVE OFFER, AND WHAT SITS BELOW THE BUTTON IS NOT ONE. There is still no
 * discount here: one invented at the moment of leaving tells every customer who
 * did not threaten to leave what their loyalty was worth. What [CancellationOfferNote]
 * adds is an ANSWER to the reason somebody volunteered — a cheaper plan that
 * already exists, the hold that already exists, the help screen that already
 * exists — and it is rendered AFTER the button that leaves, never before it.
 *
 * That placement is the whole of it. Any content above the exit moves the exit
 * further down the moment a radio is tapped, which would mean answering the
 * question pushes the way out away from your thumb. Below the button, the exit
 * sits exactly where it did before a word was said, and the answer is the first
 * thing under it.
 *
 * AND THE PAUSE IS AN ANSWER, NOT A STEP (#277). It arrives through the same
 * [CancellationOfferNote] under the same button, for a workspace that has said
 * "quiet season" and that the API says may pause. It is never a confirmation in
 * front of the exit, never a reason the exit is unavailable, and it does not
 * move the exit by a pixel: from landing on the billing screen, one press still
 * reaches Stripe having answered nothing.
 */
@Composable
private fun CancelCard(
    scope: SettingsScope,
    company: CompanyView,
    onRefreshCompany: () -> Unit,
    onOpenHelp: (() -> Unit)?,
    pause: PauseRead,
    onPauseChanged: (PauseState) -> Unit,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    // NOTHING IS PRE-SELECTED. A default answer is not an answer anybody gave,
    // and every count built on it would be wrong in the direction we chose.
    //
    // Saveable rather than remembered, for both halves: a rotation, a switch to
    // dark mode, or the system reclaiming the activity recreates this screen,
    // and plain `remember` would drop the paragraph somebody had just taken the
    // trouble to write at us. Losing it silently is a second grievance handed to
    // a person already on their way out.
    var reason by rememberSaveable { mutableStateOf<String?>(null) }
    var detail by rememberSaveable { mutableStateOf("") }
    var opening by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var exporting by remember { mutableStateOf(false) }

    val contacts = remember(scope.graph) {
        ContactMutations(scope.graph.api, BuildConfig.API_URL)
    }
    // The same save-as-file path the contacts list uses: a 50k-row CSV through
    // a share-sheet intent would blow the binder transaction limit.
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        if (uri != null) {
            exporting = true
            coroutines.launch {
                try {
                    val csv = contacts.exportCsv(scope.companyId, null)
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                            // Re-attach the UTF-8 BOM the exporter emits (OkHttp
                            // strips it) so Excel round-trips accents correctly.
                            stream.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
                            stream.write(csv.removePrefix("\uFEFF").toByteArray(Charsets.UTF_8))
                        } ?: throw IllegalStateException("no stream")
                    }
                    scope.showMessage("Contacts exported.")
                } catch (cause: Exception) {
                    scope.showMessage(cause.userMessage())
                } finally {
                    exporting = false
                }
            }
        }
    }

    SettingsCard(title = "Cancel") {
        if (!SettingsRoleGate.canCancelSubscription(scope.role)) {
            // The same three facts as the owner's version above, but never in
            // the second person, because none of it is theirs to do. "Cancel
            // anytime, your number" followed by "only the owner can cancel"
            // makes a promise and withdraws it one line later, which reads as a
            // runaround rather than as information.
            ReadOnlyLine(
                "Only the owner can cancel this plan. When they do, the plan runs to " +
                    "the end of the billing period and nothing sends after that. The " +
                    "number is held for $CANCELLATION_GRACE_DAYS days from the day they " +
                    "cancel — not from that date — in case they change their mind. " +
                    "After that it is released for good.",
            )
            Spacer(Modifier.height(8.dp))
            // Said plainly rather than by omission. The portal an admin or a
            // bookkeeper can open is the card-update flow, which has no cancel
            // button in it, so being sent there to hunt for one is worse than
            // being told there is nothing to find.
            ReadOnlyLine(
                "The payment portal above is for cards and invoices and has no " +
                    "cancellation on it, so this is not something to go looking for there.",
            )
            return@SettingsCard
        }

        // The consequence first, in the second person, because from here down
        // every word is addressed to the one person who can act on it.
        //
        // THE HOLD RUNS FROM THE DAY THEY CANCEL, and this sentence says so
        // because the seasonal answer twenty dp below says so too. It used to
        // read "texting stops at the end of your billing period, and we hold
        // your number for 30 days", which invites the reader to add the two
        // together: cancel on day 2 of a month and you count about 59 days
        // where you have about 30. `runGraceJob` measures `now - canceled_at`,
        // and `canceled_at` is stamped when cancelling is REQUESTED — so the
        // period end is not on the clock at all.
        //
        // #524: AND IT NO LONGER PROMISES TEXTING UNTIL THEN. "Texting stops at
        // the end of your billing period" is false for somebody already paused,
        // whose texting stopped the day they paused — on the same screen as a
        // plan card saying so. What is true for both readers is that the PLAN
        // runs to the period end and that nothing sends after it, so that is
        // what this says, and it says it without consulting the pause read:
        // this sentence sits above the button that leaves, and a sentence that
        // reflowed when a Stripe round trip landed would move the exit out from
        // under a thumb. The paused reader's own sentence is under the button,
        // where everything the read decides on this card already lives.
        ReadOnlyLine(
            "Cancel anytime. Your plan runs to the end of your billing period, and " +
                "you can't send once it ends. Your number is held for " +
                "$CANCELLATION_GRACE_DAYS days from the day you cancel — not from " +
                "that date — in case you change your mind. After that it is released " +
                "for good.",
        )

        // Spacing is what tells the four groups apart. A divider or an inner
        // panel would draw a box inside a box, and a box that appeared is
        // exactly what this card must never look like.
        Spacer(Modifier.height(20.dp))

        // The ask and the reassurance are read as one thing, so they are one
        // muted paragraph in the same voice as the sentence above rather than a
        // heading with a caption under it. A title here would make the survey
        // the loudest thing on a card whose subject is leaving.
        ReadOnlyLine(
            "If you want to say why, it helps us fix it. Optional, and it changes " +
                "nothing about cancelling.",
        )
        Spacer(Modifier.height(6.dp))
        // Announced as one group of six rather than as six unrelated tappable
        // lines: without the group and the role below, a screen reader never
        // says "1 of 6", and this is the card being judged on how hard it is to
        // leave.
        Column(Modifier.selectableGroup()) {
            CANCELLATION_REASONS.forEach { choice ->
                val selected = reason == choice.code
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            enabled = !opening,
                            role = Role.RadioButton,
                            // Tapping the chosen row clears it. Without this
                            // there is no way back to "I would rather not say"
                            // once a thumb has landed on the wrong line, and
                            // adding a seventh "prefer not to say" row would
                            // make silence look like something you have to opt
                            // into.
                            onClick = { reason = if (selected) null else choice.code },
                        )
                        .padding(vertical = 6.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    RadioButton(selected = selected, onClick = null, enabled = !opening)
                    Spacer(Modifier.width(10.dp))
                    Text(choice.label, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = detail,
            // Truncates at the API's ceiling instead of refusing the edit. Two
            // reasons: the record is fired and never awaited, so an over-length
            // body would 422 in silence; and a box that drops a whole pasted
            // paragraph without a word looks broken rather than full.
            onValueChange = { detail = it.take(CANCELLATION_DETAIL_MAX) },
            enabled = !opening,
            minLines = 2,
            label = { Text("Anything you want to tell us (optional)") },
            modifier = Modifier.fillMaxWidth(),
        )
        DetailCounter(detail.length)

        Spacer(Modifier.height(20.dp))
        Text("Take your contacts with you", style = MaterialTheme.typography.titleSmall)
        // The columns are named, and named accurately, because this is a promise
        // made to somebody who is leaving and will not be back to check it.
        // GET /v1/contacts/export carries name, phone, tags, consent source and
        // dates. Custom fields are NOT in the file, so "every field you added"
        // would send somebody off with less than they were told they had, and no
        // way left to ask us about it.
        Text(
            "Every contact in this workspace as a CSV: names, numbers, tags and when " +
                "they opted in. Save it, send it, or open it in a spreadsheet. Yours " +
                "either way.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = { exportLauncher.launch("contacts.csv") },
            enabled = !exporting,
        ) { Text(if (exporting) "Exporting…" else "Export contacts") }

        Spacer(Modifier.height(20.dp))
        ReadOnlyLine(
            "Nothing above has to be filled in. This takes you to the secure Stripe " +
                "portal either way, where you finish cancelling. It opens in your browser.",
        )
        Spacer(Modifier.height(8.dp))
        Button(
            // Enabled on the first frame the billing screen draws. `opening` is
            // the request already in flight, and it is the ONLY thing that may
            // ever disable this button: never the reason, never the detail. One
            // tap reaches Stripe whether or not a single word was typed.
            enabled = !opening,
            onClick = {
                opening = true
                error = null
                val statement = cancellationStatement(reason, detail)
                // Fired on the PROCESS scope and never awaited. Two reasons: the
                // handoff below must not wait on it, because a slow or dead
                // analytics write cannot be allowed to stop somebody
                // cancelling; and this composition goes away when the browser
                // comes forward, which would cancel a screen-scoped request
                // mid-flight. A body with neither half is still worth sending —
                // it is the record that somebody was asked and skipped.
                scope.graph.appScope.launch {
                    runCatching {
                        scope.repo.recordCancellationReason(scope.companyId, statement)
                    }
                }
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
            },
        ) { Text(if (opening) "Opening…" else "Continue to cancel") }
        InlineError(error)
        // #524: what the sentence at the top of this card cannot say, for the
        // one reader it would otherwise mislead.
        //
        // UNDER THE BUTTON, like every other thing the pause read decides here.
        // Above it, this would appear the moment a Stripe round trip landed and
        // push the exit down the screen — the regression this whole card is
        // built against, arriving as a correction to the card's own copy.
        pausedCancelNote(pause)?.let { note ->
            Spacer(Modifier.height(12.dp))
            ReadOnlyLine(note)
        }
        // Under the button on purpose — see the header. Renders nothing for the
        // four answers we have nothing honest to say to, and nothing at all
        // until somebody chooses one.
        CancellationOfferNote(
            scope = scope,
            company = company,
            reason = reason,
            pause = pause,
            onRefreshCompany = onRefreshCompany,
            onOpenHelp = onOpenHelp,
            onPauseChanged = onPauseChanged,
        )
    }
}

/**
 * #277 follow-up — the answer to the reason, in place, on the cancel card.
 *
 * WHAT IT MAY SAY is decided by [cancellationOffer] and, for the one reason the
 * pause answers better, by the API. Four of the six answers get NULL and render
 * nothing, and null is a real answer rather than copy nobody has written yet:
 * there is no plan cheaper than Starter, we do not know what somebody switched
 * to, and "not using it" is already served by the export and the exit above.
 *
 * LIVES OUTSIDE CancelCard for the same reason [DetailCounter] does. Nothing
 * between that card opening and the button that leaves may be conditional, and
 * a block that renders itself or nothing is exactly the shape that has to stay
 * out of the way of that rule. Here it also keeps the plan dialog out of the
 * cancel card's own body, where a dialog of any kind is forbidden.
 *
 * THE CONTROL IS ONE THIS SCREEN ALREADY HAS. `ChangePlanDialog` is the same
 * downgrade the plan card above offers, with the same live checks on numbers
 * and seats — so the offer cannot promise a switch the API would refuse. Help
 * is the help section. Neither is a new path invented for people on their way
 * out.
 *
 * THE PAUSE REPLACES THE SEASONAL WORDS RATHER THAN JOINING THEM (#277). Both
 * answer "quiet season, I'll be back": the words explain that a season longer
 * than the hold outruns it, and the pause makes that stop being the answer.
 * Rendering both would be one card telling somebody their number is on a clock
 * and, in the next paragraph, that it is not. So when the API says this
 * workspace may pause — and only then, and only with the price it quoted —
 * [pauseOfferCopy] answers and [cancellationOffer] is not consulted.
 */
@Composable
private fun CancellationOfferNote(
    scope: SettingsScope,
    company: CompanyView,
    reason: String?,
    pause: PauseRead,
    onRefreshCompany: () -> Unit,
    onOpenHelp: (() -> Unit)?,
    onPauseChanged: (PauseState) -> Unit,
) {
    // `eligible` is the ONLY thing that may put a pause control on screen, and
    // this is where that rule is enforced on this client: no local guess at
    // eligibility, no price of our own, and nothing at all for the five other
    // reasons.
    //
    // [PauseRead.answer] is null for a read that has not landed or has failed,
    // and that is exactly right here: an unanswered read is not an offer, so
    // the seasonal words render instead — which is a whole answer on its own.
    val pauseAnswer = if (reason == PAUSE_ANSWERS_REASON) pauseOfferCopy(pause.answer) else null
    val offer = if (pauseAnswer == null) {
        cancellationOffer(
            reason = reason,
            plan = company.plan,
            phase = CancellationOfferPhase.Before,
            billingCurrency = company.billing_currency,
            country = company.country,
            registrationFeePaidAt = company.registration_fee_paid_at,
            // THE ANSWER HAS TO KNOW. A paused workspace reading the unpaused
            // answers gets two false things on one screen: a "Switch to Starter"
            // button the plan-change route 409s by design, and a seasonal
            // paragraph ending "a quiet season longer than that outruns the
            // hold" twelve lines under a card saying the pause starts no clock
            // at all. `isPaused` is true only on an ANSWERED read, so this says
            // "paused" only when we were told so.
            paused = pause.isPaused,
        )
    } else {
        null
    }
    if (pauseAnswer == null && offer == null) return

    var changingPlan by remember(offer?.reason) { mutableStateOf(false) }
    var pausing by remember(pauseAnswer?.heading) { mutableStateOf(false) }
    var pausePending by remember { mutableStateOf(false) }
    var pauseError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    Spacer(Modifier.height(20.dp))
    Text(
        pauseAnswer?.heading ?: offer!!.heading,
        style = MaterialTheme.typography.titleSmall,
    )
    Spacer(Modifier.height(4.dp))
    Text(
        pauseAnswer?.body ?: offer!!.body,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    // Outlined, never filled. The only filled control on this card is the one
    // that leaves, and an offer that out-weighed it would be the styling
    // asymmetry — a loud stay, a quiet leave — this whole screen avoids. The
    // pause carries its price on the label for the same reason it is stated in
    // the dialog: nobody may agree to a recurring charge they have not read.
    if (pauseAnswer != null) {
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { pauseError = null; pausing = true }) {
            Text(pauseAnswer.actionLabel)
        }
    }
    // The words above came from a boolean, which cannot say "we have not asked
    // yet" — see [mayDrawOfferControl]. Until the read answers, the answer is
    // still printed and its switch is not: the sentences about the two plans are
    // true either way, and the button is the only part that would be a claim.
    val action = offer?.action?.takeIf { mayDrawOfferControl(it, pause) }
    val label = offer?.actionLabel
    when (action) {
        CancellationOfferAction.ChangePlan -> if (label != null) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { changingPlan = true }) { Text(label) }
        }

        CancellationOfferAction.OpenHelp -> if (label != null && onOpenHelp != null) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onOpenHelp) { Text(label) }
        }

        // Coming back is not something a live subscription can be offered, so
        // this arm cannot be reached from the "before" phase. Rendering nothing
        // is the correct answer to an action this surface has no control for.
        CancellationOfferAction.ResubscribeStarter -> Unit

        null -> Unit
    }

    if (changingPlan) {
        ChangePlanDialog(
            scope = scope,
            company = company,
            onDismiss = { changingPlan = false },
            onChanged = {
                changingPlan = false
                onRefreshCompany()
            },
        )
    }

    if (pausing && pauseAnswer != null) {
        ConfirmDialog(
            title = pauseAnswer.confirmTitle,
            body = pauseAnswer.confirmBody,
            confirmLabel = pauseAnswer.confirmLabel,
            pending = pausePending,
            error = pauseError,
            onDismiss = { pausing = false },
            onConfirm = {
                pausePending = true
                pauseError = null
                coroutines.launch {
                    try {
                        // TOLD FROM THE RESPONSE, never assumed from the press.
                        // The route re-reads the mirror after the Stripe swap
                        // and answers 409 when it disagrees, so this is the
                        // pause that exists — and on 409 the message below is
                        // the one the API wrote for the customer.
                        val settled = scope.repo.pausePlan(scope.companyId)
                        onPauseChanged(
                            // Not eligible any more, because it has happened.
                            // The refusal code the route would send back with
                            // that is deliberately not carried: it is a wire
                            // code for a bug report, and nothing on screen may
                            // ever be built out of one.
                            PauseState(
                                eligible = false,
                                paused_at = settled.paused_at,
                                monthly_cents = settled.monthly_cents,
                                resume_plan = settled.resume_plan,
                            ),
                        )
                        pausing = false
                        scope.showMessage("Paused. Your number and your history are safe.")
                    } catch (cause: Exception) {
                        pauseError = cause.userMessage()
                    } finally {
                        pausePending = false
                    }
                }
            },
        )
    }
}

/** How close to the ceiling the note has to be before the count appears. */
private const val CANCELLATION_DETAIL_COUNTDOWN_FROM = 200

/**
 * What is left of the free-text note, shown only once the end is in sight.
 *
 * The box truncates rather than rejecting, which is the right behaviour and
 * also an invisible one: past the ceiling the keystrokes simply stop landing.
 * This is the sentence that explains it, and it arrives before the stop rather
 * than after. From the first character it would be nagging, on a card that is
 * meant to be quiet.
 *
 * Lives outside CancelCard on purpose. Nothing between that card opening and
 * the button that leaves may be conditional, and a counter that renders itself
 * or nothing is the one exception worth keeping out of the way of that rule.
 */
@Composable
private fun DetailCounter(length: Int) {
    val remaining = CANCELLATION_DETAIL_MAX - length
    if (remaining >= CANCELLATION_DETAIL_COUNTDOWN_FROM) return
    Text(
        "$remaining characters left.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp),
    )
}

/**
 * #490 — how many customers rang while the line could not take them.
 *
 * Shown only on a workspace whose subscription is not active, and only when the
 * number is greater than zero. It is the argument for coming back with evidence
 * attached: before this the business was never told those calls had happened.
 *
 * WHAT THIS IS NOT: a scare banner. It does not use the word "lost". The reader
 * has almost certainly stopped paying because money is tight, and a product
 * that shouts about what their lapse cost them is kicking somebody already
 * down. The bare number is more persuasive than any sentence we could write
 * about it.
 *
 * Zero renders NOTHING. An empty state here would be an argument AGAINST
 * reinstating, which is a screen nobody needed us to build. A failed read
 * renders nothing too — this is a supporting fact on somebody else's screen,
 * and a billing page showing a broken box looks like the billing is broken.
 */
/**
 * #481 — what a departing crew's customers are told, while we still hold the
 * number.
 *
 * THE DEADLINE IS THE FEATURE. After release the number belongs to somebody
 * else and nothing can answer from it, so this is not forwarding — it is "tell
 * the people who text you, while we still can". The copy leads with when it
 * stops, because an owner who believes this outlives their account has been
 * misled at the worst possible moment.
 *
 * THE WORDS ARE THEIRS: an empty box with an example placeholder, never a
 * draft. Writing the message IS the opt-in, so there is no separate switch to
 * leave somebody unsure whether they set this up.
 *
 * NO PERSUASION. A business is winding down. How we behave on the way out is
 * the referral channel (#399), so there is no retention pitch here.
 */
@Composable
private fun OffRampCard(scope: SettingsScope, company: CompanyView) {
    if (company.subscription_status != SubscriptionStatus.CANCELED) return
    if (!SettingsRoleGate.canManageBilling(scope.role)) return

    var draft by remember(company.offramp_message) {
        mutableStateOf(company.offramp_message.orEmpty())
    }
    var busy by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()
    val saved = company.offramp_message
    val trimmed = draft.trim()

    fun save(message: String?) {
        if (busy) return
        busy = true
        coroutines.launch {
            runCatching {
                scope.repo.updateCompany(
                    scope.companyId,
                    buildJsonObject {
                        if (message == null) put("offramp_message", JsonNull)
                        else put("offramp_message", message)
                    },
                )
            }.onSuccess {
                scope.showMessage(
                    if (message == null) "Turned off." else "Saved. We'll send this once to each customer who texts you.",
                )
            }.onFailure { scope.showMessage("Couldn't save that. Try again.") }
            busy = false
        }
    }

    Spacer(Modifier.height(10.dp))
    SettingsCard(title = "Tell your customers where you went") {
        Text(
            "Anyone who texts your old number gets this back, once each. " +
                (releaseDate(company.canceled_at)?.let { "It stops on $it, when " }
                    ?: "It stops when ") +
                "the number goes back to the phone company. After that we can't " +
                "answer it, and texts to it reach whoever gets it next.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = draft,
            onValueChange = { if (it.length <= OFFRAMP_MAX) draft = it },
            enabled = !busy,
            minLines = 3,
            placeholder = {
                Text("We've moved to (416) 555-0123 — call or text us there and we'll pick right up.")
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            if (trimmed.isEmpty()) {
                "Nothing is sent until you write something here."
            } else {
                "${trimmed.length} of $OFFRAMP_MAX characters. Your words, sent as they are."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { save(trimmed) },
                enabled = !busy && trimmed.isNotEmpty() && trimmed != saved.orEmpty(),
            ) {
                Text(if (saved == null) "Start sending this" else "Save")
            }
            if (saved != null) {
                TextButton(onClick = { draft = ""; save(null) }, enabled = !busy) {
                    Text("Turn off")
                }
            }
        }
    }
}

/**
 * #481: the release date, in UTC — the clock the release job runs on. A
 * deadline shown a day out from the one the number actually goes on is worse
 * than no date.
 *
 * The arithmetic itself lives in [numberReleaseAt] rather than here, because
 * two surfaces on this screen now print this date and the 30 is a shared
 * constant hand-ported from `cancellation-offers.ts`. A second local copy of it
 * is how one of the two ends up naming a different day.
 *
 * THE YEAR IS PART OF THE DATE. This printed "4 August" while the day-27 grace
 * email — which links to this exact screen — printed "August 4, 2026". The
 * branch that suffers is the expired one: "the hold ended on 3 September" is
 * read by definition after the deadline has passed, and possibly a winter or a
 * year later, by somebody whose only question is whether that date is behind
 * them. So this is [FULL_DATE], the same shape as the period end on the plan
 * card above and as `releaseDateLabel` in grace.ts, in UTC rather than the
 * device zone because that is the clock the job releases on.
 */
private fun releaseDate(canceledAt: String?): String? = numberReleaseAt(canceledAt)
    ?.atZone(ZoneId.of("UTC"))
    ?.format(FULL_DATE)

private const val OFFRAMP_MAX = 320

@Composable
private fun MissedWhileOffNote(scope: SettingsScope, company: CompanyView) {
    val show = !company.subscriptionActive
    var missed by remember(show) { mutableStateOf<MissedWhileOff?>(null) }
    LaunchedEffect(show) {
        if (show) missed = runCatching { scope.repo.missedWhileOff(scope.companyId) }.getOrNull()
    }
    val data = missed ?: return
    if (data.count <= 0) return

    Spacer(Modifier.height(10.dp))
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(
                if (data.count == 1) {
                    "1 customer called while your number was off"
                } else {
                    "${data.count} customers called while your number was off"
                },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                "They heard that the number isn't taking calls." +
                    (relativeDay(data.last_at)?.let { " The most recent was $it." } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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

        // The hold is counted from the day cancelling was REQUESTED, not from
        // the day texting stops — `canceled_at` comes off Stripe's own
        // `subscription.canceled_at`. This notice used to read "texting stops
        // then; we hold your number for 30 days", which invites the reader to
        // count from the period end and can overstate the real deadline by most
        // of a month. The exact date is not shown here on purpose: this notice
        // is drawn while the subscription is still `active`, so the webhook has
        // not stamped `canceled_at` on the company yet and any date built here
        // would be a guess. The anchor is named instead.
        company.subscriptionActive && company.cancel_at_period_end -> {
            val date = fullDate(company.current_period_end)
            ("Your plan is set to cancel" +
                (if (date != null) " on $date" else " at the end of this period") +
                ". Texting stops then. Your number is held for " +
                "$CANCELLATION_GRACE_DAYS days from the day you cancelled — not from " +
                "the end of that period — so it can be released soon afterwards. You " +
                "can undo this from the payment portal.") to "Keep my plan"
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

/**
 * The canceled-state card, and the one thing it now has to say (#277 follow-up).
 *
 * THE DATE WAS WRONG AND IS THE FIRST FIX HERE. This card said "we hold your
 * number for 30 days after your last period". The release job measures
 * `now - canceled_at`, and `canceled_at` is stamped when cancelling is
 * REQUESTED — so for a cancel-at-period-end the clock can start up to a month
 * before the last period ends. The old sentence named a later date than the one
 * the number actually dies on, which is the expensive direction to be wrong in.
 * [numberReleaseAt] is the same arithmetic the job does.
 *
 * WHY THE WIN-BACK IS HERE AND NOT IN THE MAIL. The day 1/15/27 grace emails
 * already link to this screen, so it is receiving win-back traffic on a cadence
 * and had nothing to say when somebody arrived. It stays in the app rather than
 * becoming a fourth email because this product cannot lawfully send a
 * commercial one today — `MAILING_ADDRESS` is null and the sender refuses on
 * that basis — the grace emails ride the critical reputation stream and carry
 * no unsubscribe by design, and the only opt-out list is global, so declining a
 * win-back would also silence that workspace's payment-failure and security
 * mail. An in-app card is not an electronic message and carries none of that.
 *
 * AND NOT INSIDE [OffRampCard], whose docblock forbids persuasion in as many
 * words. That card is for a business winding down. This one is beside the
 * Resubscribe button, which is where somebody who came back to look already is.
 *
 * ANYTHING SHOWN THREE TIMES NEEDS A WAY TO BE SHOWN ZERO TIMES, hence "No
 * thanks". It is stamped as a timestamp compared against `canceled_at` rather
 * than a flag, so a workspace that dismisses this, comes back, and leaves again
 * next winter is asked once about the new cancellation rather than never again.
 */
@Composable
private fun CanceledSubscriptionCard(
    scope: SettingsScope,
    company: CompanyView,
    canManage: Boolean,
    onOpenHelp: (() -> Unit)?,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    // WHICH plan is being opened, not merely that something is. Two ways back
    // can be on this card at once, and a shared boolean would put "Opening…" on
    // both of them.
    var opening by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val canceledAt = company.canceled_at
    val withinGrace = isWithinCancellationGrace(canceledAt)

    // Hidden the moment it is waved away, and re-shown if the write fails —
    // the control did nothing, so the screen must not pretend it did.
    var wavedAway by remember(canceledAt) { mutableStateOf(false) }
    val offering = canManage &&
        !wavedAway &&
        shouldOfferWinback(canceledAt, company.winback_dismissed_at)

    // Asked only when there is a window to answer inside, and never from
    // `company_view`: this is non-null only for a workspace that has already
    // left, and the company read runs on every boot for every role.
    var stated by remember(canceledAt) { mutableStateOf<String?>(null) }
    LaunchedEffect(offering, canceledAt) {
        if (offering) {
            stated = runCatching { scope.repo.statedCancellationReason(scope.companyId) }
                .getOrNull()?.reason
        }
    }

    val offer = if (offering) {
        cancellationOffer(
            reason = stated,
            plan = company.plan,
            phase = CancellationOfferPhase.Grace,
            billingCurrency = company.billing_currency,
            country = company.country,
            registrationFeePaidAt = company.registration_fee_paid_at,
        )
    } else {
        null
    }

    fun resubscribe(plan: String) {
        opening = plan
        error = null
        coroutines.launch {
            try {
                val hosted = scope.repo.checkout(scope.companyId, plan)
                openExternal(context, hosted.url)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                opening = null
            }
        }
    }

    val releaseOn = releaseDate(canceledAt)
    val released = canceledAt != null && !withinGrace

    SettingsCard(title = "Subscription") {
        Text(
            if (released) {
                "Your subscription is canceled."
            } else {
                // Receiving and sending are not the same thing here, and saying
                // only the reassuring half would let somebody plan around a
                // product they think is answering their customers.
                // `runPreSendGates` requires an active subscription and answers
                // 402 otherwise; inbound still lands.
                "Your subscription is canceled. You can't send until you're back, " +
                    "but your number is still taking messages and your history is " +
                    "untouched."
            },
            style = MaterialTheme.typography.bodyMedium,
        )

        if (offer != null) {
            Spacer(Modifier.height(18.dp))
            Text(offer.heading, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text(
                offer.body,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            LinkButton(
                onClick = {
                    wavedAway = true
                    // Process-lifetime, like the reason record on the way out:
                    // this is bookkeeping about a decision somebody has already
                    // made, and it must not depend on them staying on the
                    // screen long enough for it to land.
                    scope.graph.appScope.launch {
                        runCatching { scope.repo.dismissWinback(scope.companyId) }
                            .onFailure {
                                wavedAway = false
                                scope.showMessage("Couldn't save that. Try again.")
                            }
                    }
                },
            ) { Text("No thanks") }
        }

        Spacer(Modifier.height(if (offer != null) 14.dp else 10.dp))
        // THE HOLD ENDS ON A CLOCK; THE RELEASE HAPPENS ON A CRON. This branch
        // used to say the number "has gone back to the phone company", which
        // flips on the DEVICE clock the instant `canceled_at + 30d` passes —
        // but `runGraceJob` sweeps once a day (`0 14 * * *`) and can fail and
        // retry. For up to a day we would be telling somebody their number is
        // gone while it is in fact still recoverable, and the win-back above
        // vanishes at the same moment. What is true at exactly that boundary is
        // about the HOLD, not about the carrier, so that is what is said.
        Text(
            when {
                released && releaseOn != null ->
                    "The $CANCELLATION_GRACE_DAYS-day hold on your number ended on " +
                        "$releaseOn. Resubscribing now sets you up with a new number " +
                        "— your message history is still here."

                released ->
                    "The $CANCELLATION_GRACE_DAYS-day hold on your number has ended. " +
                        "Resubscribing now sets you up with a new number — your " +
                        "message history is still here."

                releaseOn != null ->
                    "We hold your number until $releaseOn. Resubscribe before then and " +
                        "it comes back with everything in it; after that it goes back " +
                        "to the phone company."

                // No readable `canceled_at` — a member without `billing.manage`
                // is not sent one. The rule is still true, so state the rule
                // rather than inventing a date for it.
                else ->
                    "We hold your number for $CANCELLATION_GRACE_DAYS days from the " +
                        "day you cancel. Resubscribe before then and it comes back " +
                        "with everything in it; after that it goes back to the phone " +
                        "company."
            },
            style = MaterialTheme.typography.bodyMedium,
        )

        InlineError(error)

        if (canManage) {
            val currentPlan = company.plan ?: "starter"
            // Stacked rather than sat side by side. "Resubscribe" and "Come
            // back on Starter" together are wider than a small phone, and a
            // clipped label on the one control that brings somebody back is
            // not a trade worth making for a tidier row.
            Column(
                Modifier.padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = { resubscribe(currentPlan) }, enabled = opening == null) {
                    Text(if (opening == currentPlan) "Opening…" else "Resubscribe")
                }
                // Never filled: the offer is the alternative, not the headline.
                val label = offer?.actionLabel
                when (offer?.action) {
                    CancellationOfferAction.ResubscribeStarter -> if (label != null) {
                        OutlinedButton(
                            onClick = { resubscribe("starter") },
                            enabled = opening == null,
                        ) { Text(if (opening == "starter") "Opening…" else label) }
                    }

                    CancellationOfferAction.OpenHelp -> if (label != null && onOpenHelp != null) {
                        OutlinedButton(onClick = onOpenHelp) { Text(label) }
                    }

                    // A live plan switch needs a live subscription. There is
                    // none here, so there is no control to render.
                    CancellationOfferAction.ChangePlan -> Unit

                    null -> Unit
                }
            }
        }
    }
}

/**
 * The plan, and — since #277 — whether it is paused.
 *
 * THE PAUSED STATE LIVES HERE rather than in a card of its own, for two
 * reasons. Being paused is a fact about the plan, so this is where somebody
 * looks for it; and a new card would be new content between the top of this
 * screen and the button that leaves, which is the one thing the layout rule on
 * [CancelCard] forbids. The exit stays exactly where it was.
 *
 * AND IT SAYS NOTHING IT HAS NOT READ. Three of this card's claims — the pill,
 * the allowance lines, and the plan switch — are true only of a plan that is
 * actually running, so all three hang off [PauseRead.isRunning] rather than off
 * "we have no pause in hand". Before the read lands, and after one that failed,
 * the card is quiet about the state instead of green about it.
 */
@Composable
private fun PlanCard(
    scope: SettingsScope,
    company: CompanyView,
    canManage: Boolean,
    onRefreshCompany: () -> Unit,
    onOpenHelp: (() -> Unit)? = null,
    pause: PauseRead = PauseRead.Unasked,
    onPauseChanged: (PauseState) -> Unit = {},
    onRetryPause: () -> Unit = {},
    onOpenNumbers: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()

    if (company.subscription_status == SubscriptionStatus.CANCELED) {
        CanceledSubscriptionCard(scope, company, canManage, onOpenHelp)
        return
    }

    // #328: the currency this workspace is actually CHARGED, not a hardcoded
    // dollar sign. A Canadian owner used to read "Pro · $79/mo" here and, an
    // inch below on the same screen, "Starter is $39 a month instead of $109"
    // out of the cancellation answer. One of those was provably wrong and both
    // were on screen at once.
    val facts = planFacts(company.plan, company.billing_currency, company.country)
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

    // #277: what they come back to, named by the API rather than inferred from
    // `plan` — the pause never touches that column, which is what makes
    // `resume_plan` a real answer months into a quiet season.
    val answer = pause.answer
    val paused = pausedStateCopy(
        answer,
        planFacts(answer?.resume_plan, company.billing_currency, company.country)?.name,
    )
    // The plan's own terms, which are only true of a plan that is running. The
    // pause read decides, and it decides POSITIVELY: `isRunning` is false for a
    // read that has not landed and for one that failed, where `paused == null`
    // was true of both.
    val running = pause.isRunning
    val badge = planBadge(pause, company.subscriptionActive, company.cancel_at_period_end)

    SettingsCard(title = "Plan") {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(
                "${facts.name} · ${facts.price}",
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.width(10.dp))
            when (badge) {
                // Amber, not the positive green: the plan above is not what is
                // being charged today, and the line under says what is.
                PlanBadge.Paused -> StatusPill("Paused", PillTone.Warn)
                PlanBadge.Active -> StatusPill("Active", PillTone.Positive)
                // Says only that we are asking, which is all that is true yet.
                PlanBadge.Checking -> StatusPill("Checking…", PillTone.Neutral)
                null -> Unit
            }
        }
        Spacer(Modifier.height(8.dp))
        if (paused != null) {
            // The allowances below describe a plan that is not running. Saying
            // "texting for your crew" over "you cannot send texts" would be the
            // card contradicting itself, so while paused this IS the plan copy.
            PausedPlanNote(scope, paused, answer, canManage, onPauseChanged)
        } else if (running || pause is PauseRead.Unasked) {
            // `Unasked` is here on purpose, and it is the one carve-out. Nobody
            // asked because nobody could: GET /v1/billing/pause is behind
            // `billing.manage`, so for a member this client cannot learn about a
            // pause at all. Blanking the plan's own terms would punish the one
            // reader who has no control on this card to be misled about, and the
            // pill — the only thing that CLAIMS a state — is already withheld.
            planAllowanceLines(facts).forEach { line ->
                Text(
                    "· $line",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 1.dp),
                )
            }
            Spacer(Modifier.height(6.dp))
            LinkButton(onClick = { openExternal(context, FAIR_USE_URL) }) {
                Text("Allowances reflect fair use. See the policy")
            }
        }
        // #523: WHICH LINE IS DOWN, AND WHY — directly under the allowance it is
        // the consequence of.
        //
        // NO READ. `GET /v1/billing/held-numbers` is a round trip, and everything
        // this sentence needs is already on the company view the screen was drawn
        // from. `suspendedNumberNote` on the numbers screen makes the same call
        // for the same reason, so the two cannot disagree about how many numbers
        // are on hold — they count the same field.
        //
        // `subscriptionActive` IS THE SERVER'S OWN SPLIT, not a second opinion
        // about it: the route decides `over_plan_allowance` vs
        // `subscription_inactive` from `subscription_status === "active"`, and
        // this is that field. A suspension while the subscription is past due or
        // unpaid belongs to the payment, and the amber banner at the top of this
        // screen has already said so — blaming the allowance there would be the
        // screen inventing a second cause for one state.
        //
        // Owner/admin only, because a member cannot reach this screen from the
        // hub at all (`Capability.BILLING_MANAGE` gates the row) and the one who
        // arrives by link is answered by "Only owners and admins can change
        // billing" below. Their copy of this sentence is on the numbers screen,
        // where it ends by naming who to ask.
        if (canManage && company.subscriptionActive) {
            heldNumbersPlanNote(
                company.numbers
                    .filter { it.status == NumberStatus.SUSPENDED }
                    .map { it.number_e164 },
            )?.let { note ->
                Spacer(Modifier.height(10.dp))
                Text(note, style = MaterialTheme.typography.bodyMedium)
                // A door rather than a treasure hunt. Everywhere else in settings
                // this would be the words "Settings › Numbers", because no
                // navigation callback exists at those call sites; one exists
                // here, and the whole defect being fixed is somebody following a
                // notification to a screen and finding nothing to press.
                //
                // A LINK, not a filled or outlined control: the one control with
                // weight on this card is the plan switch below, which is also one
                // of the two routes out of this state. A louder button here would
                // out-rank it.
                onOpenNumbers?.let { open ->
                    LinkButton(onClick = open) { Text("Open your numbers") }
                }
            }
        }
        // Asked and not answered. One sentence for the failure and a way to ask
        // again; nothing at all while it is still in flight, because the pill
        // above already says so and narrating a request is not information.
        planStateUnknownNote(pause)?.let { note ->
            ReadOnlyLine(note)
            LinkButton(onClick = onRetryPause) { Text("Try again") }
        }
        fullDate(company.current_period_end)?.let { date ->
            Text(
                "Current period ends $date.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // Only on a plan we have been TOLD is running. POST /v1/billing/change-plan
        // answers 409 for a paused workspace on purpose ("resume it first, then
        // switch plans"), so a switch control here would be a button whose only
        // outcome is an error — and that was equally true of the window before
        // the read landed, which is why the gate is `running` rather than "no
        // pause in hand". The paused note says the same thing in advance.
        if (canManage && company.subscriptionActive && running) {
            ChangePlanControl(scope, company, onRefreshCompany)
        }
    }
}

/**
 * #277 — the paused state, said plainly, with the way back.
 *
 * THREE FACTS AND A BUTTON. What stopped, what did not (inbound still arrives,
 * and that is the half somebody could plan a winter around being wrong about),
 * what it costs, and Resume. The copy is [pausedStateCopy]'s so the phone and
 * the web say the same thing about the same state.
 *
 * THE FIGURE IS THE MIRROR'S. `monthly_cents` while paused is what this
 * workspace is being charged, read back off the company row — not the catalog
 * price, which is next winter's. Where the mirror has none, the heading names
 * no amount rather than inventing one.
 *
 * RESUME IS CONFIRMED, and that is not friction for its own sake: resuming
 * bills the rest of the period back up to the plan price on the spot, and the
 * same-day idempotency key means somebody who resumes by accident cannot pause
 * again until tomorrow. The dialog states the charge; the sentence somebody
 * reads afterwards is the API's own, whatever it answers.
 */
@Composable
private fun PausedPlanNote(
    scope: SettingsScope,
    copy: PausedStateCopy,
    answer: PauseState?,
    canManage: Boolean,
    onPauseChanged: (PauseState) -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    Text(copy.heading, style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(4.dp))
    Text(
        copy.body,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    fullDate(answer?.paused_at)?.let { since ->
        Text(
            "Paused since $since.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
    if (canManage) {
        Spacer(Modifier.height(10.dp))
        Button(onClick = { error = null; confirming = true }) { Text(copy.resumeLabel) }
    }

    if (confirming) {
        ConfirmDialog(
            title = copy.confirmTitle,
            body = copy.confirmBody,
            confirmLabel = copy.confirmLabel,
            pending = pending,
            error = error,
            onDismiss = { confirming = false },
            onConfirm = {
                pending = true
                error = null
                coroutines.launch {
                    try {
                        // Re-read from the mirror by the route itself, which
                        // 409s rather than reporting a resume it cannot see.
                        // So this is the state, not the intention.
                        val settled = scope.repo.resumePlan(scope.companyId)
                        onPauseChanged(
                            PauseState(
                                eligible = false,
                                paused_at = settled.paused_at,
                                resume_plan = settled.plan,
                            ),
                        )
                        confirming = false
                        scope.showMessage("You're back. Texting and calls work again.")
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

    /**
     * #583 — a prepaid year running underneath this switch.
     *
     * Read here rather than with the screen: it costs a Stripe round trip on the
     * server, and it only changes a decision at the moment somebody is about to make
     * one. A failure leaves it null, which shows no panel and sends no consent — the
     * server then refuses with the arithmetic in the message, which is the same
     * answer this dialog would have given, arriving one tap later.
     */
    var prepaid by remember { mutableStateOf<OpenPrepaidYear?>(null) }
    var endPrepaid by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        prepaid = try {
            scope.repo.prepayOffer(scope.companyId).open
        } catch (_: Exception) {
            null
        }
    }

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
    // #392: the Starter allowances, not literals. A downgrade gate that
    // disagrees with the API blocks a plan change the server would allow — and
    // a CHECKLIST that disagrees with the offer above it ("It covers 3 people
    // and 1 business number") tells an owner two different things about the
    // same plan across one tap.
    val numbersOk = activeNumbers <= STARTER_NUMBERS
    val seatsOk = (activeMembers ?: Int.MAX_VALUE) <= STARTER_SEATS
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
        // #583: and never while a prepaid year is running and unacknowledged.
        confirmEnabled = !downgradeBlocked && (prepaid == null || endPrepaid),
        pending = pending,
        error = error,
        onDismiss = onDismiss,
        onConfirm = {
            pending = true
            error = null
            coroutines.launch {
                try {
                    val result = scope.repo.changePlan(
                        scope.companyId,
                        targetPlan,
                        convertPrepaid = prepaid != null && endPrepaid,
                    )
                    // #523: an upgrade is one of the two routes out of a hold,
                    // so the sentence names what the bigger allowance brought
                    // back rather than leaving the owner to go and look.
                    scope.showMessage(changePlanMessage(result))
                    onChanged()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
        extraContent = {
            // #583 first, because it is the thing that changes what the money does.
            // Orthogonal to the direction of the switch, so it renders on both.
            PrepaidYearPanel(
                open = prepaid,
                targetPlan = targetPlan,
                acknowledged = endPrepaid,
                onAcknowledgedChange = { endPrepaid = it },
            )
            if (!upgrading) {
                val numbersLabel =
                    "$STARTER_NUMBERS phone number" + if (STARTER_NUMBERS == 1) "" else "s"
                Spacer(Modifier.height(10.dp))
                Text(
                    (if (numbersOk) "✓" else "✗") +
                        if (numbersOk) " $numbersLabel. You're set."
                        else " Starter includes $numbersLabel; you have $activeNumbers. " +
                            "Release under Settings › Numbers first.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    when {
                        membersFailed -> "✗ Couldn't check your member count. Try again."
                        activeMembers == null -> "Checking your member count…"
                        seatsOk -> "✓ Up to $STARTER_SEATS members; you have $activeMembers."
                        else -> "✗ Starter includes $STARTER_SEATS members; you have " +
                            "$activeMembers active. Deactivate " +
                            "${activeMembers!! - STARTER_SEATS} under Settings › Team " +
                            "first."
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

/**
 * #583 — what a plan switch does to a prepaid year, before it happens.
 *
 * The reader's actual question is one sentence: "I paid for a year, do I lose it?"
 * Until this shipped the answer arrived as a refusal AFTER the tap, which is the
 * worst possible order — a refusal reads as "you cannot", to the one customer who
 * both can and wants to pay us more.
 *
 * Three facts and no more: what the year cost, how much is used, what comes back.
 * Three is inside what somebody holds at once on a phone; a fourth would be
 * arithmetic they did not ask for.
 *
 * IT SAYS CREDIT AND AN AMOUNT, NEVER MONTHS. Stripe spends a credit balance on the
 * whole invoice, so a heavy month can consume it instead of the plan fee — "two
 * months of Pro free" is a promise the mechanism cannot keep. D131 records why the
 * design settles in money rather than months, and that is only honest if the words
 * match on every client.
 *
 * The tick is deliberately not pre-set. Everywhere else this app fills a form in
 * advance to save somebody work; here the tick IS the consent, and a consent already
 * given is not one.
 *
 * Renders nothing for the workspaces with no prepaid year, which is almost all of
 * them — a panel for a rare state must not become furniture on the common one.
 */
@Composable
private fun ColumnScope.PrepaidYearPanel(
    open: OpenPrepaidYear?,
    targetPlan: String,
    acknowledged: Boolean,
    onAcknowledgedChange: (Boolean) -> Unit,
) {
    if (open == null) return
    // The currency the year was COLLECTED in. Its own money, so no prefix — which is
    // what `formatMoney` does when currency and audience agree. An unrecognised or
    // absent value reads as USD, matching `billingCurrencyOf` on the server: a
    // missing field must not stop the panel naming the amount.
    val paid = billingCurrencyOrNull(open.currency) ?: BillingCurrency.USD
    val credit = open.conversion?.let { formatMoney(it.credit_cents, paid) }
    // The sentences are the promise, so they come from the shared rule rather than
    // being typed out here — see `prepaidConversionCopy`.
    val copy = prepaidConversionCopy(open.plan, targetPlan, credit)

    Spacer(Modifier.height(10.dp))
    Text(
        copy.heading,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
    )
    Spacer(Modifier.height(4.dp))
    Text(
        "Paid up front: ${formatMoney(open.amount_cents, paid)}",
        style = MaterialTheme.typography.bodySmall,
    )
    open.conversion?.let {
        Text(
            "Months used: ${it.consumed_months} of 12",
            style = MaterialTheme.typography.bodySmall,
        )
    }
    if (credit != null) {
        Text(
            "Back on your account: $credit",
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
        )
    }
    Spacer(Modifier.height(6.dp))
    Text(
        copy.explanation,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(6.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = acknowledged, onCheckedChange = onAcknowledgedChange)
        Text(copy.acknowledgement, style = MaterialTheme.typography.bodySmall)
    }
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
