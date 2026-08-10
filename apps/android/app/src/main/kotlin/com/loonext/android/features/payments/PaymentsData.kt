package com.loonext.android.features.payments

import com.loonext.android.core.model.HostedUrl
import com.loonext.android.core.net.ApiClient
import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.billingCurrencyOrNull
import com.loonext.android.features.settings.currencyForCountry
import kotlinx.serialization.Serializable

/**
 * #224 — the wire, verified against apps/api/src/routes/payments.ts.
 *
 * Two reads with different lifetimes and different owners, which is why they
 * are two cache entries rather than one: the connected ACCOUNT belongs to the
 * workspace and changes on a settings screen; the REQUESTS belong to one
 * conversation and change when a customer pays, which is a webhook nobody in
 * the app initiated.
 */

/**
 * `GET /v1/payments/account` — where this workspace stands with Stripe.
 *
 * [title], [detail] and [action] are COMPOSED BY THE SERVER and rendered
 * verbatim. This client deliberately does not carry a port of
 * `payoutReadinessCopy`: five states times three sentences on three clients is
 * forty-five strings that have to stay identical, and the API already answers
 * with the one that is true. The shared module keeps the copy; we keep the
 * screen.
 *
 * Every field defaults, because `explicitNulls = false` + `coerceInputValues`
 * means a payload from a newer Worker must degrade rather than blank the
 * settings screen (#555).
 */
@Serializable
data class PayoutAccount(
    val connected: Boolean = false,
    /**
     * The server's own word. Read it through [state] and never directly — a
     * value this build has not heard of has to fall back to the booleans below
     * rather than to either constant.
     */
    val readiness: String = PayoutReadiness.NOT_CONNECTED.wire,
    val title: String = "",
    val detail: String = "",
    /** The one button's label, or null when there is nothing to press. */
    val action: String? = null,
    /** The Stripe account's country, not the workspace's. */
    val country: String? = null,
    val currency: String? = null,
    val charges_enabled: Boolean = false,
    val payouts_enabled: Boolean = false,
    val details_submitted: Boolean = false,
    val disabled_reason: String? = null,
    val requirements_due: List<String> = emptyList(),
    val requirements_deadline: String? = null,
) {
    /**
     * The readiness, as an exhaustive type.
     *
     * A readiness string this build has never heard of falls back to DERIVING
     * one from the booleans beside it, rather than to either constant. Both
     * constants are wrong in a way that costs somebody money: defaulting to
     * NOT_CONNECTED hides the ask from a workspace that can charge, and
     * defaulting to READY offers it to one that cannot and turns every send into
     * a 409. `charges_enabled` is the field that actually decides, and it is
     * right here.
     */
    val state: PayoutReadiness
        get() = Payments.readinessNamed(readiness) ?: Payments.readinessOf(
            connected = connected,
            chargesEnabled = charges_enabled,
            detailsSubmitted = details_submitted,
            disabledReason = disabled_reason,
        )

    /** The single question the composer asks: may this workspace take a card? */
    val canCharge: Boolean get() = state == PayoutReadiness.READY

    /**
     * What the business will actually receive, which is what the amount field
     * has to be labelled in.
     *
     * Stripe's `default_currency` for the account, falling back to the account's
     * COUNTRY and never to a platform default — the same rule `accountCurrency`
     * uses on the server. A Canadian account quoted in USD would settle at
     * Stripe's conversion rate, and receiving less than the number you typed is
     * the one surprise a payments feature cannot have.
     */
    val billingCurrency: BillingCurrency
        get() = billingCurrencyOrNull(currency) ?: currencyForCountry(country)
}

/**
 * One ask, as it stands right now.
 *
 * `state` IS ON THE WIRE AND IS DELIBERATELY NOT DECODED. The API derives it
 * with the same function [Payments.state] is a port of, so the two cannot
 * disagree — and a model carrying both would be a model somebody reads the
 * stale one from, because the timestamps survive a cache round-trip and a
 * derived string is only as fresh as the fetch that brought it.
 */
@Serializable
data class PaymentRequest(
    val id: String,
    val conversation_id: String = "",
    val contact_id: String = "",
    /** Null until the text has actually been inserted into the thread. */
    val message_id: String? = null,
    val amount_cents: Int = 0,
    val currency: String = "usd",
    val description: String = "",
    val status: String = PaymentStatus.REQUESTED,
    val paid_at: String? = null,
    val refunded_at: String? = null,
    /** Null unless refunded; a PARTIAL refund is less than [amount_cents]. */
    val amount_refunded_cents: Int? = null,
    val disputed_at: String? = null,
    val cancelled_at: String? = null,
    val expires_at: String? = null,
    val created_at: String? = null,
    val created_by: String? = null,
) {
    val state: PaymentState
        get() = Payments.state(status, paid_at, refunded_at, disputed_at)

    /**
     * The money this row is in — the account's, not the workspace's plan
     * currency. Falls back to USD for a value we do not bill in, which is the
     * same fail-to-default `billingCurrencyOf` makes on the server.
     */
    val money: BillingCurrency
        get() = billingCurrencyOrNull(currency) ?: BillingCurrency.USD
}

@Serializable
data class PaymentRequestPage(
    val payment_requests: List<PaymentRequest> = emptyList(),
)

/**
 * `POST /v1/payments/account/onboarding` — the hosted flow.
 *
 * The refreshed account rides back with the link because creating it is what
 * turns `connected` true, and a settings card still saying "Not set up yet"
 * while the browser is already on Stripe's form is a card that looks broken.
 */
@Serializable
data class PayoutOnboarding(
    val url: String = "",
    val account: PayoutAccount? = null,
)

@Serializable
internal data class CreatePaymentRequestBody(
    /**
     * Cents, integer, and named so. An `amount` in dollars as a float is how a
     * payment feature ships a rounding bug that only appears on some amounts.
     */
    val amount_cents: Int,
    val description: String,
)

/** Every /v1 payments endpoint this client calls. */
class PaymentsRepository(private val api: ApiClient) {

    /**
     * Refreshed from Stripe by the server on every read, so this is what Stripe
     * says now rather than what our mirror last recorded. That is a real API
     * call per read, which is why it is cached per company (#176) and
     * revalidated rather than polled.
     */
    suspend fun account(companyId: String): PayoutAccount =
        api.get("/v1/payments/account", companyId = companyId)

    /** Start or resume setting up. Owner-only server-side. */
    suspend fun startOnboarding(companyId: String): PayoutOnboarding =
        api.post("/v1/payments/account/onboarding", companyId = companyId)

    /** A login link to their own Stripe. THE REFUND AND DISPUTE PATH. */
    suspend fun dashboardLink(companyId: String): HostedUrl =
        api.get("/v1/payments/account/dashboard", companyId = companyId)

    suspend fun requests(companyId: String, conversationId: String): PaymentRequestPage =
        api.get("/v1/conversations/$conversationId/payment-requests", companyId = companyId)

    /**
     * Ask, and send.
     *
     * [idempotencyKey] is REQUIRED by the route, and for the same reason every
     * other send path requires one: this mints a Stripe payment link and puts a
     * text on somebody's phone, and a retry over a flaky cell connection must
     * not do that twice. The key belongs to the ASK — it is minted when the form
     * opens and replaced only once a request has actually gone — so a tap that
     * timed out and a tap the person repeated are the same request.
     */
    suspend fun createRequest(
        companyId: String,
        conversationId: String,
        amountCents: Int,
        description: String,
        idempotencyKey: String,
    ): PaymentRequest = api.post(
        "/v1/conversations/$conversationId/payment-requests",
        body = CreatePaymentRequestBody(amountCents, description),
        companyId = companyId,
        idempotencyKey = idempotencyKey,
    )

    /**
     * Call one off. Idempotent server-side: cancelling something already
     * cancelled or expired answers with the row rather than an error, so a
     * double tap is never a failure the crew has to interpret.
     */
    suspend fun cancelRequest(companyId: String, id: String): PaymentRequest =
        api.post("/v1/payment-requests/$id/cancel", companyId = companyId)
}
