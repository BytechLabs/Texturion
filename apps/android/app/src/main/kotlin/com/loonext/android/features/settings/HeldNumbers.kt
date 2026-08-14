package com.loonext.android.features.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ChangePlanResult
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.HeldNumberReason
import com.loonext.android.core.model.HeldNumbers
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import java.util.UUID
import kotlinx.coroutines.launch

/**
 * #523 — a number this workspace holds that its plan does not cover: what that
 * means, and how to end it.
 *
 * ── THE DEFECT BEHIND THIS FILE ────────────────────────────────────────────
 *
 * `POST /v1/billing/checkout` does not refuse a workspace for holding more
 * NUMBERS than its new plan covers (it does now refuse one over the plan's
 * SEATS — no seat can be held, so that one has no other answer), and its
 * completion handler used to un-suspend EVERY suspended number with one
 * statement carrying no plan term. During the 30-day grace window `change-plan`
 * refuses a cancelled subscription outright, so checkout is the only route back
 * — and the #277 win-back puts a "Come back on Starter" button on exactly that
 * path. A Pro workspace holding two numbers pressed it and came back holding
 * two, on a plan that includes one, with nobody billed for the second and
 * $1.10/mo of carrier rent accruing against it forever.
 *
 * The API's answer is NOT a gate on coming back — that is #277's decision and it
 * stands — it is that the plan they bought is respected AFTERWARDS and the owner
 * is told. The surplus stays `suspended`: nothing released, still receiving,
 * history intact. This file is the "and the owner is told" half on Android.
 *
 * ── WHY A HOLD HAS TO BE EXPLAINED OR IT IS A DEFECT ───────────────────────
 *
 * A held number is half alive. It takes texts and answers calls only to say it
 * cannot take them, so the customer's customers keep reaching a line that no
 * longer works and they find out before the owner does. That state is defensible
 * only while the owner can see it and act on it — which is the whole argument
 * for these words existing rather than a grey "Suspended" pill left to be
 * interpreted.
 *
 * ── WHY THIS LIVES ON THE NUMBERS SCREEN AND NOT ON BILLING ────────────────
 *
 * Three reasons, in order of weight. The billing screen has a standing rule that
 * nothing new renders between landing on it and the button that leaves
 * (`PauseOfferTest`), and a card carrying "move to Pro" and "buy an extra
 * number" is precisely the shape that rule forbids. The numbers screen is where
 * somebody goes when a line is not working, so the explanation meets the
 * question where it is asked. And `GET /v1/billing/held-numbers` is behind
 * `billing.manage`, so only the numbers screen can explain this to the tech who
 * noticed — [suspendedNumberNote] needs no billing read at all.
 *
 * ── EVERY FIGURE HERE IS THE SERVER'S ──────────────────────────────────────
 *
 * The allowance, the plan's hard cap and the price of un-holding one all arrive
 * on [HeldNumbers]. Nothing here is computed from a Kotlin literal, and the
 * price renders through [formatMoney] with the WORKSPACE's currency as the
 * audience: the extra-number book is filed in USD only, so a Canadian owner
 * reads "US$5/mo" and is charged US$5. A bare "$5" at that reader means CA$5 and
 * is #522 with a different figure.
 */

// ---------------------------------------------------------------------------
// Copy — pure, so it can be tested without rendering anything
// ---------------------------------------------------------------------------

/**
 * The half of a hold somebody could plan a business around being wrong about,
 * in the one place both screens read it from.
 *
 * WHY IT IS SHARED RATHER THAN TYPED TWICE. This clause is the difference
 * between a hold and a release, and it is the sentence a reader stops on. Two
 * copies of it are two chances for one of them to lose the "still reach it"
 * half in an edit — after which one screen says the line is dead and the other
 * says it is fine, and the owner believes whichever they read first. The numbers
 * screen says it under the number ([suspendedNumberNote]); the billing screen
 * says it under the plan ([heldNumbersPlanNote]); neither writes it.
 *
 * BOTH FORMS LIVE HERE for the same reason. The numbers screen is always about
 * one number and the billing screen may be about three, so a shared singular
 * string would have forced the plural to be written somewhere else — which is
 * the duplication this exists to prevent, arrived at by grammar.
 */
internal fun heldNumberKept(many: Boolean, locale: String? = null): String =
    AppStrings.translate(
        locale,
        if (many) "settings.heldKeptMany" else "settings.heldKeptOne",
    )

/**
 * The numbers a sentence is about: named where we can spell them, counted where
 * we cannot.
 *
 * A row whose `number_e164` is null is still a number that is on hold, so it is
 * counted either way; what changes is whether the sentence can name it. Naming
 * only the spellable ones would under-report the state to the one person who has
 * to act on it.
 *
 * @param fallback what to call a single number we have no digits for. Each
 *   caller supplies its own because the two sentences are addressed differently
 *   — one reports what an upgrade just did, the other describes what is true now.
 */
internal fun heldNumberSubject(
    e164s: List<String?>,
    fallback: String,
    locale: String? = null,
): String {
    val named = e164s.filterNotNull().map(::formatPhone)
    return when {
        e164s.size == 1 -> named.singleOrNull() ?: fallback
        // The joiner is a WORD, so it is a catalogue entry like any other: a
        // French list joined with "and" is the one place a sentence would stop
        // being French halfway through.
        named.size == e164s.size ->
            named.joinToString(AppStrings.translate(locale, "settings.heldAndJoiner"))
        else -> AppStrings.translate(
            locale,
            "settings.heldCounted",
            mapOf("count" to e164s.size.toString()),
        )
    }
}

/**
 * #523 — what the BILLING screen says about a number the plan does not cover.
 *
 * ── WHY THIS SCREEN SAYS ANYTHING AT ALL ───────────────────────────────────
 *
 * Because the notice sends people here. `noticeHeldNumbers` mails and pushes
 * `/settings/billing`, and the push body is "Open Loonext to see which number,
 * and how to bring it back" — so this is the screen an owner arrives on holding
 * exactly one question. It used to have nothing to say: the hold lived only on
 * the numbers screen, and the tap landed on a plan card that cheerfully listed
 * an allowance without mentioning that the workspace was over it.
 *
 * ── WHY IT IS A LINE ON THE PLAN CARD AND NOT A CARD ───────────────────────
 *
 * The rule on [CancelCard] is that nothing new renders between landing on this
 * screen and the button that leaves, and `PauseOfferTest` pins the list of what
 * does. #277 met the same rule with the same answer: the paused state rides ON
 * the plan card because being paused IS a plan fact. So is this one, and more
 * literally — the card prints "· 1 phone number" three lines above, and this
 * finishes that sentence with "and you have more than that". iOS gives exactly
 * that reason for putting its own card directly under the plan card; a line
 * inside it is that argument carried one step further.
 *
 * ── WHY IT SELLS NOTHING ───────────────────────────────────────────────────
 *
 * The buy-back is a per-number consent surface with a price on the button, and
 * it already exists on the number's own card ([HeldNumberActions]). A second one
 * here would be a money control above the exit — the exact shape the layout rule
 * forbids — and a second copy of a charge to keep in step with the first. The
 * upgrade needs no words either: "Upgrade to Pro" is the control on this card,
 * directly under this sentence, and web refuses a second one for the same reason
 * ("two doors onto one room").
 *
 * So this names no price and no plan. It says which line is down, why, what is
 * still true of it, and where the controls are. Everything it declines to say is
 * something the server has to be asked about, and this screen has not asked.
 *
 * @return null when nothing is held, which is the answer on almost every load.
 */
fun heldNumbersPlanNote(heldE164s: List<String?>, locale: String? = null): String? {
    if (heldE164s.isEmpty()) return null
    val many = heldE164s.size > 1
    val subject = heldNumberSubject(
        heldE164s,
        fallback = AppStrings.translate(locale, "settings.heldOneOfYours"),
        locale = locale,
    )
    // WHOLE SENTENCES, one per grammar, rather than a stem with "is"/"are" and
    // "it"/"them" dropped into it. French agrees a verb, an article and a
    // possessive at once, so a shared stem would have pushed three more
    // fragments into the catalogue for a translator to reassemble blind — the
    // same reason the devices card spells both counts out.
    return AppStrings.translate(
        locale,
        if (many) "settings.heldPlanNoteMany" else "settings.heldPlanNoteOne",
        mapOf("subject" to subject, "kept" to heldNumberKept(many, locale)),
    )
}

/**
 * What the numbers screen says under a number that is on hold — the one surface
 * a plain member ever sees this state on.
 *
 * WHY IT DOES NOT READ THE ROUTE. Every /v1/billing route sits behind
 * `billing.manage`, so the tech looking at this screen cannot fetch
 * [HeldNumbers] at all. What they can see is `subscription_status`, which is on
 * the company view they already have — and that is precisely the field the
 * server's own `reason` ternary switches on, so the split here cannot disagree
 * with the split there.
 *
 * WHY IT NAMES NO FIGURE AND NO ROUTE. Both belong to [heldNumberRoutes], which
 * only renders where the server has actually answered. This sentence is the
 * part that is true without asking anybody: what happened, and — first — what
 * did not.
 *
 * WHAT WAS WRONG BEFORE. One sentence for every suspended number, whatever the
 * cause: "This number is suspended. Update your payment method under Settings ›
 * Billing to bring it back." For the #523 hold that is false twice over — the
 * card on file is fine, and the billing portal it sends you to cannot fix an
 * allowance. It asked somebody to re-enter card details to solve a problem card
 * details have nothing to do with.
 */
fun suspendedNumberNote(
    subscriptionStatus: String?,
    canManageBilling: Boolean,
    locale: String? = null,
): String {
    // Said before the cause, every time. Somebody who reads "your plan covers
    // fewer numbers than you're holding" and stops there has already started
    // composing the sentence where they lost a phone number — and the next thing
    // they do is tell customers to use a different one, or start a port they do
    // not need.
    val kept = heldNumberKept(many = false, locale = locale)
    fun say(key: String) = AppStrings.translate(locale, key, mapOf("kept" to kept))

    return when (subscriptionStatus) {
        // The server calls this `over_plan_allowance`: the subscription is live
        // and paid, there is simply more line than plan. The routes are rendered
        // below this by [heldNumberRoutes], where the server's own answer is —
        // so an owner is deliberately pointed nowhere here, and only a member,
        // for whom nothing further will render, is told who to ask.
        SubscriptionStatus.ACTIVE ->
            say("settings.heldNoteAllowance") +
                if (canManageBilling) {
                    ""
                } else {
                    " " + say("settings.heldAskOwnerAllowance")
                }

        SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID ->
            say("settings.heldNotePastDue") + " " +
                if (canManageBilling) {
                    say("settings.heldFixPastDue")
                } else {
                    say("settings.heldAskOwnerPastDue")
                }

        SubscriptionStatus.CANCELED ->
            say("settings.heldNoteCanceled") + " " +
                if (canManageBilling) {
                    say("settings.heldFixCanceled")
                } else {
                    say("settings.heldAskOwnerCanceled")
                }

        // Never seen in practice — a workspace with no subscription has no
        // numbers to hold. Says what is true and guesses at no cause, rather
        // than picking whichever of the three above sounds most likely.
        else ->
            say("settings.heldNoteUnknown") + " " +
                if (canManageBilling) {
                    say("settings.heldFixUnknown")
                } else {
                    say("settings.heldAskOwnerAllowance")
                }
    }
}

// ---------------------------------------------------------------------------
// The same hold, asked about from the port tracker beside the card
// ---------------------------------------------------------------------------

/**
 * The `phone_numbers` row a transfer delivered, or null while it has delivered
 * none.
 *
 * MATCHED ON THE E.164, because it is the one identifier both rows are
 * guaranteed to agree on after cutover — the client is never sent
 * `phone_numbers.porting_status`, and the port row's own id says nothing about
 * which line it produced.
 *
 * A RELEASED ROW IS NOT A MATCH. A released number has been given up; the story
 * there is the release, and letting a released row resolve here would put a hold
 * note on a number nobody holds.
 */
internal fun numberForPort(
    portE164: String,
    numbers: List<PhoneNumberSummary>,
): PhoneNumberSummary? = numbers.firstOrNull { row ->
    row.status != NumberStatus.RELEASED && row.number_e164 == portE164
}

/**
 * #523 follow-up — is the line this transfer delivered on hold?
 *
 * ── THE DEFECT THIS CLOSES, WHICH #523 CREATED ─────────────────────────────
 *
 * Admitting `SUSPENDED` rows to the card filter gave a held ported line a card
 * that says it cannot send. The tracker beside it was left alone, and a
 * completed transfer draws a POSITIVE "Ported" pill over a filled stepper. So
 * one screen said both "this line is on hold and cannot send" and "Ported, all
 * done" about one number. Before that change there was one wrong story; two
 * contradicting ones are worse, because the reader has no way to tell which
 * half to act on and the cheerful half is the easier one to believe.
 *
 * ── ANY SUSPENSION, NOT ONLY THE ALLOWANCE ONE ─────────────────────────────
 *
 * This asks the question the pill gets wrong — "does this line work" — and the
 * answer is no for every cause of a suspension (an over-allowance hold, a
 * declined card, a cancelled subscription). WHY it is held is a different
 * question, and it is [suspendedNumberNote]'s, on the number's own card. The
 * tracker deliberately names no cause: it would be a second, hand-derived
 * opinion about a state the card beside it already explains from the server's
 * own fields.
 *
 * ── AND IT CANNOT COLLIDE WITH A TRANSFER STILL IN FLIGHT ──────────────────
 *
 * `claim_port_slot` inserts the port's `phone_numbers` row with NO
 * `number_e164` — a port buys no inventory, and P6 writes the number at cutover
 * — so a row can only match a port that has already completed. That is why the
 * tracker's "Cancel transfer" needs no hold term of its own: it is already
 * withheld at `ported`, and nothing earlier can resolve a hold here. A held line
 * is ended by releasing the NUMBER, on its own card, with its own confirmation.
 *
 * @param numbers the SAME access-filtered list the number cards above are drawn
 *   from. Reading a different list is how the tracker could claim a hold on a
 *   number this member has no card for, and be the only thing on the screen
 *   saying it.
 */
fun portLineIsHeld(portE164: String, numbers: List<PhoneNumberSummary>): Boolean =
    numberForPort(portE164, numbers)?.status == NumberStatus.SUSPENDED

/**
 * What the tracker says in place of "all done" when the line it delivered is on
 * hold.
 *
 * IT SETTLES THE CONTRADICTION RATHER THAN JOINING IT. The stepper above it
 * stays filled and that is correct — the transfer did complete, and blanking it
 * would delete the true half of the story to fix the false one. What was wrong
 * was reading the finished transfer as a verdict on the line, so this says both
 * things in one sentence and puts them in the right order.
 *
 * IT NAMES NO CAUSE AND NO PRICE. Both belong to the number's own card, where
 * the server has actually been asked; a second account of the same hold, derived
 * here, is exactly the drift that produced this defect. It points there instead.
 *
 * THE "NOT GIVEN UP" CLAUSE IS THE SHARED ONE ([heldNumberKept]). The reader of
 * a transfer card who sees "on hold" is the reader most likely to conclude the
 * transfer failed and the number went back — which is the moment somebody calls
 * their old carrier, or starts a port they do not need. Two copies of that
 * clause are two chances for one of them to lose the "still reach it" half.
 */
fun portHoldNote(locale: String? = null): String = AppStrings.translate(
    locale,
    "settings.heldPortNote",
    mapOf("kept" to heldNumberKept(many = false, locale = locale)),
)

/**
 * The way or ways back, or null when this response has nothing to say about
 * this number.
 *
 * NULL IS THE COMMON ANSWER and the gate is deliberately narrow.
 * [HeldNumberReason.SUBSCRIPTION_INACTIVE] belongs to the cancellation or the
 * failed payment, and [suspendedNumberNote] has already answered both of those
 * in the reader's own terms. Offering "buy an extra number" beside a cancelled
 * subscription would be offering a purchase the API refuses outright.
 *
 * THE REASON IS READ, NEVER RE-DERIVED. The server owns that split — it is one
 * ternary in the route — and a client computing it separately would be one
 * subscription state away from disagreeing with the product it describes.
 *
 * @param price the served [HeldNumbers.extra_number_cents] formatted for this
 *   workspace, or null when the server named no price. Null closes the paid
 *   route: a control that charges an amount we declined to name is the one thing
 *   a money control must never be.
 */
fun heldNumberRoutes(
    state: HeldNumbers,
    numberId: String,
    price: String?,
    locale: String? = null,
): String? {
    if (state.reason != HeldNumberReason.OVER_PLAN_ALLOWANCE) return null
    if (state.held.none { it.id == numberId }) return null

    val paidRoute = canBringBack(state, numberId, price)

    // The plan's hard TOTAL cap (#80) has been reached — Starter sells one extra
    // and no more. Derived from three SERVED figures rather than from a Kotlin
    // constant, and asked separately from `can_reinstate` because that flag is
    // false for several reasons (a pause, an unprovisioned price, a scheduled
    // plan change) and only this one is a fact the client can see for itself.
    // Naming Pro for any of the others would send somebody to a plan switch the
    // API also refuses.
    val included = state.included
    val cap = state.max_total
    val atHardCap = included != null && cap != null && included + state.paid_extras >= cap

    return when {
        paidRoute && state.can_upgrade -> AppStrings.translate(
            locale,
            "settings.heldRoutePaidOrPro",
            mapOf("price" to price.orEmpty()),
        )

        paidRoute -> AppStrings.translate(
            locale,
            "settings.heldRoutePaid",
            mapOf("price" to price.orEmpty()),
        )

        atHardCap && state.can_upgrade -> AppStrings.translate(
            locale,
            "settings.heldRouteHardCap",
            mapOf("cap" to cap.toString()),
        )

        // The server has refused the paid route for a reason this client cannot
        // see: a paused plan, a scheduled plan change, an environment with no
        // extra-number price. Naming a route we cannot verify would draw the only
        // pressable path to a 409 on the whole screen, so this names the screen
        // where the real answer is instead.
        else -> AppStrings.translate(locale, "settings.heldRouteBilling")
    }
}

/**
 * May this number be bought back right now, at a price we can print?
 *
 * BOTH HALVES ARE REQUIRED. `can_reinstate` is the server's answer and is the
 * authority on whether the route would accept the call; a printable price is
 * what makes the button a purchase rather than a blank cheque.
 */
fun canBringBack(state: HeldNumbers, numberId: String, price: String?): Boolean =
    state.reason == HeldNumberReason.OVER_PLAN_ALLOWANCE &&
        state.can_reinstate &&
        price != null &&
        state.held.any { it.id == numberId }

/**
 * The served extra-number price, formatted for THIS workspace, or null.
 *
 * Two nulls collapse into one on purpose: a missing amount and a currency we do
 * not bill in are both "we cannot name this price", and the caller's answer to
 * either is the same — offer no paid route. Guessing a currency for a figure on
 * a consent button is the failure #522 documents.
 */
fun heldNumberPrice(state: HeldNumbers, company: CompanyView): String? {
    val cents = state.extra_number_cents ?: return null
    val priced = billingCurrencyOrNull(state.extra_number_currency) ?: return null
    val audience = billingCurrencyOrNull(company.billing_currency)
        ?: currencyForCountry(company.country)
    return formatMoney(cents, priced, audience) + "/mo"
}

/**
 * What to say after a plan change — including, since #523, what the bigger
 * allowance brought back with it.
 *
 * AN UPGRADE IS ONE OF THE TWO ROUTES OUT OF A HOLD, and until the API returned
 * `reinstated` there was no way to say so. An owner who pays the Pro difference
 * specifically to get their second line working read "You're on Pro now." and
 * had to go to another screen to find out whether it had worked. Naming the
 * number closes the loop on the decision they just made.
 *
 * COUNTS COME FROM THE LIST, NAMES ONLY WHEN THEY ARE THERE. A reinstated row
 * whose `number_e164` is null is still a number that came back, so it is counted
 * either way; what changes is whether the sentence can name it.
 */
fun changePlanMessage(result: ChangePlanResult, locale: String? = null): String {
    if (result.effective != "now") {
        return AppStrings.translate(locale, "settings.changePlanScheduled")
    }
    val count = result.reinstated.size
    if (count == 0) return AppStrings.translate(locale, "settings.changePlanOnPro")

    // Some rows can come back unnamed. Counting is still true; picking out only
    // the ones we can spell would under-report what the upgrade did — which is
    // why [heldNumberSubject] owns that judgement for both sentences that make it.
    val subject = heldNumberSubject(
        result.reinstated.map { it.number_e164 },
        fallback = AppStrings.translate(locale, "settings.heldYourHeldNumber"),
        locale = locale,
    )
    return AppStrings.translate(
        locale,
        if (count == 1) "settings.changePlanBackOne" else "settings.changePlanBackMany",
        mapOf("subject" to subject),
    )
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/**
 * The routes sentence and, where the server has said yes, the button that buys
 * this number back — rendered under [suspendedNumberNote] on the number's own
 * card.
 *
 * NOTHING RENDERS UNTIL THE SERVER HAS ANSWERED, and a failed read draws
 * nothing. That is not the [PauseRead] hazard repeated: the pause card had to
 * distinguish "told no" from "the ask failed" because it makes POSITIVE claims —
 * a green Active pill, allowances, a plan switch — off the back of an answer.
 * Nothing here claims anything when it is silent. The note above still says the
 * number is on hold and still says it has not been given up, which is the state
 * that existed before this route did.
 *
 * THE COST OF THAT, NAMED. An owner whose read failed reads the cause and is
 * pointed nowhere, because [suspendedNumberNote] deliberately leaves the routes
 * to this function rather than repeating a pointer beside a button that does the
 * thing here. The alternative — a pointer in the note that a landed read then
 * contradicts — is a screen arguing with itself on every load, to save one tap
 * in the case where the network is already failing.
 */
@Composable
fun HeldNumberActions(
    scope: SettingsScope,
    company: CompanyView,
    number: PhoneNumberSummary,
    held: HeldNumbers?,
    onChanged: () -> Unit,
) {
    val state = held ?: return
    val price = heldNumberPrice(state, company)
    val routes = heldNumberRoutes(state, number.id, price, LocalAppLocale.current)
        ?: return

    Text(
        routes,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 6.dp),
    )
    // ONE PRESS, ONE NUMBER, ONE CONSENT. The route raises the billed quantity
    // by exactly one per call, so a workspace holding three numbers buys them
    // back one at a time rather than pressing a button that spends whatever it
    // finds.
    if (price != null && canBringBack(state, number.id, price)) {
        ReinstateControl(scope, number, price, onChanged)
    }
}

/**
 * The button that buys one held number back, and the dialog behind it.
 *
 * THE PRICE IS ON THE BUTTON, not only in the dialog. Somebody who presses a
 * control captioned "Bring it back" and only then learns it costs money has been
 * charged by surprise, which is the shape #277 spent five commits refusing to
 * ship.
 *
 * AND THE PRESS IS CONFIRMED, which is ethical friction rather than friction for
 * its own sake: the route invoices with `always_invoice`, so the charge lands
 * the moment the dialog is confirmed rather than on some later statement.
 */
@Composable
private fun ReinstateControl(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    price: String,
    onChanged: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // One key per attempt-intent, reused across retries of THIS dialog and
    // regenerated the next time it opens. The route invoices immediately, so a
    // fresh key for the same decision would be a second charge.
    var idempotencyKey by remember { mutableStateOf("") }
    val coroutines = rememberCoroutineScope()

    val display = number.number_e164?.let(::formatPhone) ?: t("settings.heldThisNumber")
    val alreadyBack = t("settings.heldAlreadyBack", "number" to display)
    val backNow = t("settings.heldBackNow", "number" to display)

    OutlinedButton(
        onClick = {
            idempotencyKey = UUID.randomUUID().toString()
            error = null
            confirming = true
        },
        modifier = Modifier.padding(top = 8.dp),
    ) { Text(t("settings.heldBringBackPriced", "price" to price)) }

    if (confirming) {
        ConfirmDialog(
            title = t("settings.heldBringBackTitle", "number" to display),
            body = t("settings.heldBringBackBody", "price" to price),
            confirmLabel = t("settings.heldBringBack"),
            pending = pending,
            error = error,
            onDismiss = { if (!pending) confirming = false },
            onConfirm = {
                pending = true
                error = null
                coroutines.launch {
                    try {
                        val result = scope.repo.reinstateHeldNumber(
                            scope.companyId,
                            number.id,
                            idempotencyKey,
                        )
                        confirming = false
                        // `already_active` is a SUCCESS with nothing billed —
                        // an upgrade, or a double press, got there first.
                        // Reporting it as a failure would send somebody back to
                        // a button that would charge them for real.
                        scope.showMessage(
                            if (result.already_active) alreadyBack else backNow,
                        )
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
