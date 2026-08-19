package com.loonext.android.core.net

import kotlinx.serialization.Serializable

/**
 * SPEC §7 error envelope: `{ error: { code, message } }`. The code set is the
 * stable list in packages/shared/src/error-codes.ts plus the 500 fallback.
 */
@Serializable
data class ErrorEnvelope(val error: ErrorBody) {
    @Serializable
    data class ErrorBody(
        val code: String,
        val message: String,
        /**
         * #555: the Cloudflare ray the server already puts on a 500, and which
         * every client dropped.
         *
         * `apps/api/src/http/errors.ts` has been sending it for as long as the
         * envelope has existed. Without it a real server error and a response this
         * build could not decode are indistinguishable on a phone — the 500's
         * message is the literal string "Something went wrong.", the same words the
         * decode fallback used — so the founder reported two different bugs (#549,
         * #551) as one symptom, and neither report could carry the one identifier
         * that finds the failure in the logs.
         */
        val request_id: String? = null,
    )
}

/** Structural codes the client branches on (never sniff messages). */
object ApiErrorCode {
    const val UNAUTHORIZED = "unauthorized"
    const val FORBIDDEN = "forbidden"
    const val SUBSCRIPTION_INACTIVE = "subscription_inactive"
    const val USAGE_CAP_REACHED = "usage_cap_reached"
    const val REGISTRATION_PENDING = "registration_pending"
    const val RECIPIENT_OPTED_OUT = "recipient_opted_out"
    const val VALIDATION_FAILED = "validation_failed"
    const val NOT_FOUND = "not_found"
    const val CONFLICT = "conflict"
    const val QUIET_HOURS_CONFIRMATION_REQUIRED = "quiet_hours_confirmation_required"
    const val RATE_LIMITED = "rate_limited"

    /**
     * #314: the WORKSPACE requires a second factor, the grace window has
     * passed, and this session has none. Routed to the gate, never shown as an
     * error — a wall with no explanation is a lockout.
     */
    const val MFA_REQUIRED = "mfa_required"

    /**
     * #496: this person HOLDS a factor and this session is aal1. The opposite
     * remedy to [MFA_REQUIRED]: they need to enter a CODE, not enrol. Offering
     * enrolment here invites a SECOND factor to fix being asked for the first.
     */
    const val MFA_CHALLENGE_REQUIRED = "mfa_challenge_required"

    /**
     * #283: a subsystem is switched off at the runtime kill switch. Temporary
     * and nobody's fault, so the copy is "paused, try shortly" — never "you
     * cannot do this".
     */
    const val SERVICE_UNAVAILABLE = "service_unavailable"
    const val INTERNAL_ERROR = "internal_error"

    /** Client-side code for transport failures (no HTTP response at all). */
    const val NETWORK = "network"
}

class ApiException(
    val code: String,
    override val message: String,
    val httpStatus: Int,
    /** #555: the server's own reference for this failure, when it sent one. */
    val requestId: String? = null,
    /**
     * #228 — WHOSE SENTENCE THIS IS.
     *
     * Null means the SERVER wrote it: the message came off the `{ error: {
     * code, message } }` envelope, composed in English at one of 370 call
     * sites. An English reader gets it verbatim and that is right — it is
     * specific in a way no per-code sentence can be. A reader in another
     * language gets the CODE's sentence from the catalogue instead, because the
     * English one carries nothing they can use. `Ui.userMessage` holds that
     * rule; this field only says whose words they were.
     *
     * Non-null means WE wrote it — a transport failure, an expired session, a
     * refusal this app decided on its own. Those are ours to translate, and
     * before this they were rendered to a French reader in English on every
     * failed request, which is the most-seen copy in the app.
     *
     * The English `message` stays either way. It is what a crash log and a
     * diagnostics ring show, where a catalogue key would say nothing.
     */
    val messageKey: String? = null,
    /** Values for a `{name}` inside [messageKey]'s sentence. */
    val messageVars: Map<String, String> = emptyMap(),
) : Exception(message)

/**
 * Did this failure say the session is DEAD, or just that the server was
 * unreachable for a moment (#268)?
 *
 * Only a 4xx from GoTrue is the server refusing the refresh token itself.
 * Everything else — a dropped connection, a 429 when a whole crew shares one
 * office IP, a 5xx while Supabase deploys — is weather, and treating it as a
 * rejection throws away a perfectly good session and costs a full re-login.
 * Kept beside [ApiException] so both clients read the same rule (iOS:
 * Core/ApiClient.swift).
 */
fun ApiException.isTransientRefreshFailure(): Boolean =
    code == ApiErrorCode.NETWORK || httpStatus == 429 || httpStatus >= 500

/**
 * The server said 2xx but the body didn't match the client model. The ACTION
 * SUCCEEDED — treat as success wherever it surfaces (toast the success copy,
 * refetch the fresh state). The mismatch is a client-model bug: report it via
 * diagnostics, never via a user-facing "something went wrong".
 */
class ApiDecodeException(
    val path: String,
    override val cause: Throwable,
) : Exception("Response for $path did not match the client model", cause)

/**
 * What a decode failure is allowed to say out loud.
 *
 * #555 — THE FIELD NAME IS THE WHOLE DIAGNOSTIC, and the value never was.
 *
 * kotlinx.serialization appends the offending input to a JsonDecodingException
 * message, after a newline and the marker `JSON input:`. The first version of
 * the #555 diagnostics line recorded `cause.message` verbatim, so it could carry
 * a customer's text, their name or their address — and RecentErrors only redacts
 * phone-shaped digit runs and emails, while the ring it feeds is attached to the
 * support email from Settings > Help. SPEC.md puts message bodies, names and
 * addresses out of bounds; that line walked through it.
 *
 * Knowing that `spam_signals` arrived as a null is what fixes the bug. Knowing
 * what the customer wrote adds nothing to it.
 */
fun decodeSummary(cause: Throwable): String = when (cause) {
    is kotlinx.serialization.MissingFieldException ->
        "missing " + cause.missingFields.joinToString(",")
    // Everything else: the reason up to the input block, bounded. `substringBefore`
    // returns the whole string when the marker is absent, which is the safe
    // direction — a reason with no dump attached is kept, and the take() bounds it.
    else -> ((cause::class.simpleName ?: "decode") + " " +
        (cause.message?.substringBefore(INPUT_DUMP_MARKER) ?: "")).trim().take(80)
}

/**
 * Where kotlinx stops explaining and starts quoting the response.
 *
 * Its own literal is "\nJSON input: ". Matching on the marker alone is enough and
 * survives a change to the surrounding whitespace; `substringBefore` returns the
 * whole string when it is absent, which is the safe direction — a reason with no
 * dump attached is kept in full, and take(80) bounds it either way.
 */
private const val INPUT_DUMP_MARKER = "JSON input:"
