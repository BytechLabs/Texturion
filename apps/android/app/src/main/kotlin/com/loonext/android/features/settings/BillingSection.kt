package com.loonext.android.features.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.BillingModule
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
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
) {
    val canManage = SettingsRoleGate.canManageBilling(scope.role)

    StatusNotices(scope, company, canManage)
    // #490: directly under the notice that says the line is off, because it is
    // the consequence of that sentence rather than a separate topic.
    MissedWhileOffNote(scope, company)
    // #481: only for a workspace on its way out. Directly under the count of
    // customers who rang into nothing, because this is what to DO about that.
    OffRampCard(scope, company)
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
            CancelCard(scope)
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
 * NO SAVE OFFER. Not because one would be forbidden (a single dismissible offer
 * on this same card would be within the rule) but because we do not yet have
 * one that is true. A discount invented at the moment of leaving tells every
 * customer who did not threaten to leave what their loyalty was worth.
 */
@Composable
private fun CancelCard(scope: SettingsScope) {
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
                "Only the owner can cancel this plan. When they do, texting stops at " +
                    "the end of the billing period, and we hold the number for 30 days " +
                    "in case they change their mind. After that it is released for good.",
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
        ReadOnlyLine(
            "Cancel anytime. Texting stops at the end of your billing period, and we " +
                "hold your number for 30 days in case you change your mind. After that " +
                "it is released for good.",
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

/** #481: the release date, in UTC — the clock the release job runs on. A
 *  deadline shown a day out from the one the number actually goes on is worse
 *  than no date. */
private fun releaseDate(canceledAt: String?): String? = canceledAt?.let {
    runCatching {
        Instant.parse(it)
            .plus(java.time.Duration.ofDays(30))
            .atZone(ZoneId.of("UTC"))
            .format(DateTimeFormatter.ofPattern("d MMMM"))
    }.getOrNull()
}

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
        LinkButton(onClick = { openExternal(context, FAIR_USE_URL) }) {
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
    // #392: the Starter allowance, not a literal. A downgrade gate that
    // disagrees with the API blocks a plan change the server would allow.
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
