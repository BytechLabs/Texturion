package com.loonext.android.features.compose

/**
 * First-text signature (#393) — a Kotlin port of the CLIENT arm of
 * packages/shared/src/first-message-identification.ts.
 *
 * When the owner turns "Sign your texts" on, the first text to a customer is
 * signed server-side with `- {Business name}. Reply STOP to opt out`. This file
 * does NOT build that string: the API hands over the exact suffix
 * (`CompanyView.first_message_identification_suffix`), because a client-composed
 * copy that drifted would show a part count the customer is not billed for.
 *
 * What IS ported is the append RULE, so the composer's meter measures the same
 * body the send path builds — merge fields first, then the signature, then the
 * estimate (apps/api/src/routes/compose.ts).
 */
object Signature {
    /**
     * Append an already-resolved signature to a body, idempotently.
     *
     * A null/blank signature returns the body untouched, as does a body that
     * already ends with it — which covers an owner whose own sign-off happens to
     * match, and keeps the preview stable rather than growing a second copy.
     */
    fun append(body: String, suffix: String?): String {
        if (suffix.isNullOrBlank()) return body
        if (body.trimEnd().endsWith(suffix.trimStart())) return body
        return body + suffix
    }

    /**
     * The signature THIS send will carry, or null.
     *
     * Both conditions matter. The company setting decides whether signing
     * happens at all; `alreadySignedAt` is the once-per-customer ledger, so a
     * customer who has had one gets a plain text. A recipient with no contact
     * row yet (a raw number) has never been signed to, so pass null.
     */
    fun pending(companySuffix: String?, alreadySignedAt: String?): String? {
        if (companySuffix.isNullOrBlank()) return null
        return if (alreadySignedAt == null) companySuffix else null
    }
}
