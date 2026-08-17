package com.loonext.android.features.quotes

import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.billingCurrencyOrNull
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * #287 — a quote is a thing, not a paragraph typed into a text.
 *
 * The wire shapes and the one rule a client cannot get from the server: which
 * status to SHOW.
 *
 * ## Why the status is derived here as well as on the server
 *
 * Nothing ever writes `expired`. A quote whose deadline passed an hour ago
 * still says `sent` in the database, and it will still say `sent` on any client
 * rendering the stored column — showing a live offer on a price the business
 * has already withdrawn, to the crew member who would then go and chase it.
 *
 * The server sends `effective_status` alongside `status`, so a client could
 * simply read it. This port exists because a cached row outlives its fetch: a
 * quote read at 4:59 and rendered at 5:01 carries a stale `effective_status`
 * and a perfectly good `expires_at`. The timestamps survive a cache round-trip;
 * a derived string is only as fresh as the read that brought it. Same reasoning
 * as `PaymentRequest.state`, and the same answer.
 *
 * Hand-ported from `packages/shared/src/quotes.ts`, checked against it by
 * `QuotesRuleTest`.
 */
object QuoteStatus {
    const val DRAFT = "draft"
    const val SENT = "sent"
    const val VIEWED = "viewed"
    const val ACCEPTED = "accepted"
    const val DECLINED = "declined"
    const val EXPIRED = "expired"
}

/** Catalogue keys, one per status. Named the same on all three clients. */
val QUOTE_STATUS_KEYS: Map<String, String> = mapOf(
    QuoteStatus.DRAFT to "quotes.statusDraft",
    QuoteStatus.SENT to "quotes.statusSent",
    QuoteStatus.VIEWED to "quotes.statusViewed",
    QuoteStatus.ACCEPTED to "quotes.statusAccepted",
    QuoteStatus.DECLINED to "quotes.statusDeclined",
    QuoteStatus.EXPIRED to "quotes.statusExpired",
)

object Quotes {
    /**
     * A decision is final. Expiry cannot un-accept a quote somebody accepted,
     * nor re-open one they declined — the deadline was for ANSWERING, and it
     * has been answered.
     */
    fun isDecided(status: String): Boolean =
        status == QuoteStatus.ACCEPTED || status == QuoteStatus.DECLINED

    /**
     * What to tell somebody, which is not always what the row says.
     *
     * `draft` never expires into anything: an unsent price is not an offer, so
     * there is no deadline for a customer to miss. And an UNPARSEABLE date is
     * not an expiry — reading it as one would silently withdraw a live offer on
     * the strength of a bad string.
     */
    fun effectiveStatus(status: String, expiresAt: String?, nowMillis: Long): String {
        if (isDecided(status)) return status
        if (status == QuoteStatus.DRAFT) return QuoteStatus.DRAFT
        if (status == QuoteStatus.EXPIRED) return QuoteStatus.EXPIRED
        val expiry = parseIsoMillis(expiresAt) ?: return status
        return if (expiry <= nowMillis) QuoteStatus.EXPIRED else status
    }

    /**
     * Money asked for and not yet answered — the outstanding queue, and the
     * highest-value list in the product: an unanswered quote is revenue nobody
     * has chased.
     */
    fun isOutstanding(status: String, expiresAt: String?, nowMillis: Long): Boolean =
        when (effectiveStatus(status, expiresAt, nowMillis)) {
            QuoteStatus.SENT, QuoteStatus.VIEWED -> true
            else -> false
        }

    /** Null rather than an exception: a bad string is a missing date, not a crash. */
    private fun parseIsoMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()
    }
}

/**
 * One quote, as it stands right now.
 *
 * `effective_status` IS ON THE WIRE and is deliberately not what the UI reads —
 * see the note above. [shownStatus] derives it from the timestamps that survive
 * a cache round-trip.
 */
@Serializable
data class Quote(
    val id: String,
    val conversation_id: String = "",
    val contact_id: String = "",
    val amount_cents: Int = 0,
    val currency: String = "usd",
    val description: String = "",
    val status: String = QuoteStatus.DRAFT,
    val expires_at: String? = null,
    val sent_at: String? = null,
    val viewed_at: String? = null,
    val decided_at: String? = null,
    val created_at: String? = null,
) {
    fun shownStatus(nowMillis: Long): String =
        Quotes.effectiveStatus(status, expires_at, nowMillis)

    /**
     * The money THIS quote is in, not the workspace's plan currency: a quote is
     * denominated when it is written, and a workspace that later changes
     * billing currency must not restate old prices.
     */
    val money: BillingCurrency
        get() = billingCurrencyOrNull(currency) ?: BillingCurrency.USD
}

@Serializable
data class QuotePage(val data: List<Quote> = emptyList())

/**
 * What `POST /v1/quotes/{id}/send` returns: the quote, plus two plaintext
 * tokens returned ONCE. Nothing can produce them again — only their SHA-256 is
 * stored — and they are separate on purpose: the link a customer opens to READ
 * a quote cannot accept it.
 */
/** The create body, typed rather than a map: kotlinx cannot serialise Any. */
@Serializable
private data class CreateQuoteBody(
    val conversation_id: String,
    val amount_cents: Int,
    val description: String,
    val expires_at: String,
)

@Serializable
data class SentQuote(
    val id: String,
    val view_token: String = "",
    val accept_token: String = "",
)

class QuotesRepository(private val api: ApiClient) {

    suspend fun forConversation(companyId: String, conversationId: String): QuotePage =
        api.get(
            "/v1/quotes",
            query = mapOf("conversation_id" to conversationId),
            companyId = companyId,
        )

    /**
     * Filtered SERVER-side, and that is load-bearing rather than tidy:
     * "outstanding" folds in an expiry derived at read time, so a client
     * filtering a full list would re-implement the rule — and the list is
     * capped, so it would start silently dropping quotes on a busy workspace.
     */
    suspend fun outstanding(companyId: String): QuotePage =
        api.get(
            "/v1/quotes",
            query = mapOf("status" to "outstanding"),
            companyId = companyId,
        )

    suspend fun create(
        companyId: String,
        conversationId: String,
        amountCents: Int,
        description: String,
        expiresAt: String,
    ): Quote = api.post(
        "/v1/quotes",
        body = CreateQuoteBody(
            conversation_id = conversationId,
            amount_cents = amountCents,
            description = description,
            expires_at = expiresAt,
        ),
        companyId = companyId,
    )

    suspend fun send(companyId: String, quoteId: String): SentQuote =
        api.post("/v1/quotes/$quoteId/send", companyId = companyId)
}
