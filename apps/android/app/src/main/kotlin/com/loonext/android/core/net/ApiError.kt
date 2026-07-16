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
    const val INTERNAL_ERROR = "internal_error"

    /** Client-side code for transport failures (no HTTP response at all). */
    const val NETWORK = "network"
}

class ApiException(
    val code: String,
    override val message: String,
    val httpStatus: Int,
) : Exception(message)
