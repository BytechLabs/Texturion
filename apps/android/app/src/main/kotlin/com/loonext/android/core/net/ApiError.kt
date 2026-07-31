package com.loonext.android.core.net

import kotlinx.serialization.Serializable

/**
 * SPEC §7 error envelope: `{ error: { code, message } }`. The code set is the
 * stable list in packages/shared/src/error-codes.ts plus the 500 fallback.
 */
@Serializable
data class ErrorEnvelope(val error: ErrorBody) {
    @Serializable
    data class ErrorBody(val code: String, val message: String)
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
