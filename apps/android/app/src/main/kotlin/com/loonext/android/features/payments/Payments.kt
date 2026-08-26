package com.loonext.android.features.payments

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.formatMoney
import java.time.Instant

/**
 * #224 / D133 — text-to-pay, the parts all four surfaces have to agree on.
 *
 * A hand-port of `packages/shared/src/payments.ts` (plus the two sentences that
 * needed a money formatter, which live beside it in `payments-copy.ts`),
 * mirrored again in apps/ios/Loonext/Features/Payments/PaymentsLogic.swift.
 *
 * The TypeScript is the rule and this is a copy of it, which is the whole
 * reason it is small and total: a rule written three times drifts (#548). So
 * `PaymentsVectorsTest` runs this against `packages/shared/vectors/payments.json`
 * — the cases the TypeScript itself generated — rather than trusting that the
 * `when` blocks below read correctly.
 *
 * ## The one modelling decision worth reading
 *
 * `status` in the database has four values and the thread shows six states.
 * That is deliberate, not an omission. A REFUND and a DISPUTE happen to a
 * request that is, and stays, PAID — money changed hands and then moved back —
 * so folding them into `status` would destroy the fact the crew most needs.
 * They are timestamps beside the status, and the six-state answer is DERIVED.
 *
 * ## Why this client derives it at all, when the server sends `state`
 *
 * Because the server's answer is only as fresh as the last fetch, and this
 * client paints from a process cache before any fetch has happened (#176). A
 * row restored from that cache carries its own timestamps, so deriving is how a
 * strip painted in the first frame says the same word the API would.
 */

/** The stored status. Mirrors the SQL CHECK, and the four values the API sends. */
object PaymentStatus {
    const val REQUESTED = "requested"
    const val PAID = "paid"
    const val CANCELLED = "cancelled"
    const val EXPIRED = "expired"
}

/**
 * What the thread actually shows. Derived — never stored.
 *
 * An enum rather than string constants (which is how [PaymentStatus] next door
 * is modelled) for one reason: this is the type every `when` in the UI switches
 * on, and an enum makes those exhaustive. A sixth state added here fails to
 * compile at the label table and the icon table instead of quietly falling
 * through to whatever the `else` branch happened to draw.
 */
enum class PaymentState(val wire: String) {
    REQUESTED("requested"),
    PAID("paid"),
    REFUNDED("refunded"),
    DISPUTED("disputed"),
    CANCELLED("cancelled"),
    EXPIRED("expired"),
}

/** Why a workspace cannot send a payment request yet. */
enum class PayoutReadiness(val wire: String) {
    NOT_CONNECTED("not_connected"),
    ONBOARDING_INCOMPLETE("onboarding_incomplete"),
    PENDING_VERIFICATION("pending_verification"),
    RESTRICTED("restricted"),
    READY("ready"),
}

/** What is wrong with a typed amount. */
enum class PaymentAmountProblem { TOO_SMALL, TOO_LARGE, NOT_WHOLE }

object Payments {

    /**
     * The floor, in cents.
     *
     * Not arbitrary: Stripe refuses a charge under 50 cents in both USD and CAD,
     * and a request that mints a link the customer cannot pay is worse than a
     * refusal at the keyboard.
     */
    const val MIN_CENTS = 100

    /**
     * The ceiling, in cents — $25,000.
     *
     * A cap exists because a typo on a phone keypad is a real event and "$450"
     * becoming "$45000" is one missed decimal. It sits well above any
     * residential trade job and below the point where a mistyped figure is
     * plausible, which is the only job a cap of this kind can do.
     */
    const val MAX_CENTS = 2_500_000

    /** The description ceiling — it rides in an SMS and on a card statement. */
    const val DESCRIPTION_MAX = 200

    /** Live, or settled within this long. See [isWorthShowing]. */
    private const val RECENTLY_SETTLED_MS = 7L * 24 * 60 * 60 * 1000

    /**
     * The six-state answer, in the order that matters.
     *
     * ORDER IS THE DESIGN. A disputed payment that was also refunded reads as
     * DISPUTED, because a chargeback is the thing somebody has to act on and a
     * refund is not. A cancelled request that was somehow paid anyway reads as
     * PAID, because the money is real and telling a crew otherwise is how a
     * customer gets chased for a bill they settled.
     *
     * Takes the four fields rather than a wire model so the vectors that pin it
     * are the TypeScript's vectors, and so a cached row and a fresh one are
     * answered by the same code.
     */
    fun state(
        status: String,
        paidAt: String? = null,
        refundedAt: String? = null,
        disputedAt: String? = null,
    ): PaymentState = when {
        !disputedAt.isNullOrBlank() -> PaymentState.DISPUTED
        !refundedAt.isNullOrBlank() -> PaymentState.REFUNDED
        !paidAt.isNullOrBlank() || status == PaymentStatus.PAID -> PaymentState.PAID
        status == PaymentStatus.CANCELLED -> PaymentState.CANCELLED
        status == PaymentStatus.EXPIRED -> PaymentState.EXPIRED
        else -> PaymentState.REQUESTED
    }

    /**
     * One word for the state — a catalogue KEY, as of #228.
     *
     * Nothing server-side composes this: every client derives the state from a
     * row it already holds, so unlike the payout sentences there is no build in
     * the field rendering the return value verbatim.
     */
    fun label(state: PaymentState): String = when (state) {
        PaymentState.REQUESTED -> "payments.stateWaiting"
        PaymentState.PAID -> "payments.statePaid"
        PaymentState.REFUNDED -> "payments.stateRefunded"
        PaymentState.DISPUTED -> "payments.stateDisputed"
        PaymentState.CANCELLED -> "payments.stateCancelled"
        PaymentState.EXPIRED -> "payments.stateExpired"
    }

    /**
     * Whether this request can still be cancelled.
     *
     * Paid is excluded for the obvious reason and expired for a less obvious
     * one: an expired request is already dead, and offering a Cancel on it
     * invites a tap that does nothing, which reads as a broken button rather
     * than a settled state.
     */
    fun cancellable(state: PaymentState): Boolean = state == PaymentState.REQUESTED

    /**
     * Is this a chargeable amount? Returns the problem, or null when it is fine.
     *
     * [PaymentAmountProblem.NOT_WHOLE] is UNREACHABLE from this client and is
     * kept anyway. TypeScript's `number` can hold 250.5 cents; a Kotlin `Int`
     * cannot, and [parseAmountToCents] refuses a third decimal place before
     * anything gets here. It stays in the enum because the API answers 422 with
     * this exact sentence — [amountProblemCopy] is the only place that sentence
     * is written on this client, and a copy table with a hole in it is a hole
     * somebody fills with a paraphrase.
     */
    fun amountProblem(cents: Int): PaymentAmountProblem? = when {
        cents < MIN_CENTS -> PaymentAmountProblem.TOO_SMALL
        cents > MAX_CENTS -> PaymentAmountProblem.TOO_LARGE
        else -> null
    }

    /**
     * The sentence a crew member reads when the amount is refused.
     *
     * #228: the BOUND is still formatted here rather than written into the
     * catalogue, in either language. A Canadian workspace settles in CAD and a
     * US one in USD, so a typed "$1" in the one sentence that says what somebody
     * may charge is the #522 defect on the worst possible line.
     *
     * [locale] is defaulted to English because this is a plain function called
     * from a composer sheet's validation, and because `PaymentsTest` asks what
     * the English says — see `AppLock.headline` for the same shape.
     */
    fun amountProblemCopy(
        problem: PaymentAmountProblem,
        currency: BillingCurrency,
        locale: String = MessageLocale.EN,
    ): String = when (problem) {
        PaymentAmountProblem.TOO_SMALL -> AppStrings.translate(
            locale,
            "payments.amountTooSmall",
            mapOf("amount" to formatMoney(MIN_CENTS, currency)),
        )

        PaymentAmountProblem.TOO_LARGE -> AppStrings.translate(
            locale,
            "payments.amountTooLarge",
            mapOf("amount" to formatMoney(MAX_CENTS, currency)),
        )

        PaymentAmountProblem.NOT_WHOLE ->
            AppStrings.translate(locale, "payments.amountNotWhole")
    }

    /**
     * The text the customer receives.
     *
     * Composed by the API from the same shared function, so the preview this
     * client shows is the message that actually goes out rather than an
     * approximation of it. The shape is fixed and short for three reasons that
     * are all the same reason — this is an SMS somebody reads on a lock screen:
     *
     *   THE BUSINESS NAME IS FIRST. A payment link from an unnamed sender is a
     *   phishing text, and the customer is right to think so.
     *   THE AMOUNT IS SECOND. Nobody should have to open a link to find out what
     *   they are being asked for.
     *   THE LINK IS LAST, on its own line, so every phone linkifies all of it.
     *
     * No "click here", no urgency, no shortened domain: all three are what a
     * carrier's spam filter and a homeowner's instinct are both looking for.
     */
    fun requestSms(
        businessName: String,
        amountCents: Int,
        currency: BillingCurrency,
        description: String,
        url: String,
        locale: String,
    ): String {
        val amount = formatMoney(amountCents, currency)
        return AppStrings.translate(
            locale,
            "payments.requestSms",
            mapOf(
                "business" to businessName.trim(),
                "amount" to amount,
                "description" to description.trim(),
                "url" to url,
            ),
        )
    }

    /**
     * The readiness answer, derived from Stripe's mirror.
     *
     * `chargesEnabled` is the only field that decides whether a send may
     * happen. The others exist to say WHY it is false, and the order below is
     * the order a business moves through them.
     *
     * The API sends its own `readiness` string and that is what the settings
     * card renders. This exists for the case that string cannot cover: a build
     * running against a newer Worker that has invented a sixth readiness. See
     * [PayoutAccount.readiness] for why falling back to the booleans is the only
     * safe answer there.
     */
    fun readinessOf(
        connected: Boolean,
        chargesEnabled: Boolean,
        detailsSubmitted: Boolean,
        disabledReason: String?,
    ): PayoutReadiness = when {
        !connected -> PayoutReadiness.NOT_CONNECTED
        chargesEnabled -> PayoutReadiness.READY
        !disabledReason.isNullOrBlank() -> PayoutReadiness.RESTRICTED
        !detailsSubmitted -> PayoutReadiness.ONBOARDING_INCOMPLETE
        else -> PayoutReadiness.PENDING_VERIFICATION
    }

    /** A wire readiness this build recognises, or null for one it does not. */
    fun readinessNamed(wire: String?): PayoutReadiness? =
        PayoutReadiness.entries.firstOrNull { it.wire == wire }

    /**
     * A Stripe requirement identifier, in plain words.
     *
     * Stripe returns things like `individual.verification.document` and
     * `external_account`. Showing those to a plumber is showing them a stack
     * trace. Unknown identifiers fall back to a readable version of the
     * identifier itself rather than being dropped — an outstanding requirement
     * nobody can see is the state where an owner concludes the product is
     * broken.
     *
     * #228: THE FALLBACK STAYS UNTRANSLATED IN EVERY LANGUAGE, and that is the
     * honest answer rather than a gap. It is Stripe's own identifier with the
     * dots taken out; there is nothing to translate it FROM, and inventing a
     * French sentence for a requirement this build has never heard of would be
     * guessing at what Stripe is asking for. A tidied identifier a French reader
     * can search for beats a confident French sentence that might be wrong about
     * their money.
     */
    fun requirementCopy(
        requirement: String,
        locale: String = MessageLocale.EN,
    ): String {
        KNOWN_REQUIREMENTS[requirement]?.let { return AppStrings.translate(locale, it) }
        val cleaned = requirement.replace(OWNER_PREFIX, "")
        val words = cleaned.replace(SEPARATORS, " ").trim()
        return words.replaceFirstChar { it.uppercase() }
    }

    /**
     * Live, or settled within the last week.
     *
     * The week is the window in which somebody is still talking about that
     * money. After it, the request is history and the timeline holds it.
     *
     * A row whose timestamp will not parse is SHOWN. That is a deliberate
     * choice rather than a mirror of the web's arithmetic, which would compare
     * against a NaN and hide it: the rows that can be settled include DISPUTED,
     * and a chargeback the crew is never shown is the one failure this strip
     * exists to prevent. Our own server only ever sends ISO instants, so this
     * branch is defence, not behaviour.
     */
    fun isWorthShowing(
        state: PaymentState,
        createdAt: String?,
        paidAt: String?,
        now: Long = System.currentTimeMillis(),
    ): Boolean {
        if (state == PaymentState.REQUESTED) return true
        val settled = paidAt?.takeIf { it.isNotBlank() } ?: createdAt
        val at = settled?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
            ?: return true
        return now - at < RECENTLY_SETTLED_MS
    }

    /**
     * "250", "250.50", "$250.5" → cents. Anything else → null.
     *
     * Deliberately strict about the SHAPE and forgiving about decoration: a
     * person typing on a phone adds a dollar sign or a comma without thinking,
     * and refusing that would be pedantry. What is refused is anything that is
     * not a number, because a silently-misread amount is the one error this
     * feature cannot afford.
     *
     * THE ARITHMETIC GOES THROUGH INTEGERS, never `* 100`. 19.99 as a double
     * times 100 is 1998.9999999999998, and rounding that is a coin-flip nobody
     * should be taking with somebody's bill.
     *
     * The overflow guard is load-bearing rather than defensive. Without it a
     * fat-fingered 30-digit amount wraps a `Long` into whatever it wraps into,
     * and a wrapped value that happens to land between [MIN_CENTS] and
     * [MAX_CENTS] is a bill for a number nobody typed.
     */
    fun parseAmountToCents(input: String): Int? {
        // filterNot rather than a regex: a `$` inside a Kotlin string literal is
        // the start of a template, and the escape needed to get one into a
        // character class is exactly the kind of detail a hand-port loses.
        val cleaned = input.filterNot { it == '$' || it == ',' || it.isWhitespace() }
        if (cleaned.isEmpty()) return null
        if (!AMOUNT_SHAPE.matches(cleaned)) return null

        val dot = cleaned.indexOf('.')
        val wholeText = if (dot < 0) cleaned else cleaned.substring(0, dot)
        val fractionText = if (dot < 0) "" else cleaned.substring(dot + 1)
        val whole = wholeText.toLongOrNull() ?: return null
        if (whole > Int.MAX_VALUE / 100) return null
        val cents = whole * 100 + fractionText.padEnd(2, '0').toLong()
        return if (cents <= Int.MAX_VALUE) cents.toInt() else null
    }

    /**
     * Digits, optionally a point and up to two more digits.
     *
     * A raw string so the regex is the regex — `"""\d"""` IS `\d`, where the
     * escaped form invites the class of mistake this repo has already paid for
     * (a `\b` in a Kotlin string is a backspace, not a word boundary).
     * [Regex.matches] anchors the whole input, so no `^`/`$` are needed.
     */
    private val AMOUNT_SHAPE = Regex("""\d+(\.\d{0,2})?""")

    /** Stripe's own prefix for whose document it wants — dropped from the copy. */
    private val OWNER_PREFIX = Regex("""^(individual|company|representative)\.""")

    private val SEPARATORS = Regex("""[._]""")

    /**
     * Stripe's identifier → the catalogue key that says it in words.
     *
     * #228 turned the values from sentences into KEYS. The map is the same map:
     * what a Stripe identifier means is a fact about Stripe, not about a
     * language, so the mapping stays here and only the wording moved.
     */
    private val KNOWN_REQUIREMENTS: Map<String, String> = mapOf(
        "external_account" to "payments.reqBankAccount",
        "business_profile.url" to "payments.reqWebsite",
        "business_profile.mcc" to "payments.reqWorkKind",
        "individual.verification.document" to "payments.reqOwnerId",
        "individual.verification.additional_document" to "payments.reqOwnerIdSecond",
        "individual.id_number" to "payments.reqOwnerSin",
        "individual.address.line1" to "payments.reqOwnerAddress",
        "individual.dob.day" to "payments.reqOwnerDob",
        "company.tax_id" to "payments.reqBusinessNumber",
        "company.verification.document" to "payments.reqBusinessDocument",
        "tos_acceptance.date" to "payments.reqTos",
        "representative.verification.document" to "payments.reqSignatoryId",
    )
}
