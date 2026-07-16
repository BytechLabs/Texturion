package com.loonext.android.core.model

import kotlinx.serialization.Serializable

object CallOutcome {
    const val ANSWERED = "answered"
    const val VOICEMAIL = "voicemail"
    const val MISSED = "missed"
}

/** GET /v1/calls row. `outcome` null = in progress. */
@Serializable
data class Call(
    val id: String,
    val call_session_id: String,
    val caller_e164: String? = null,
    val contact_id: String? = null,
    val contact_name: String? = null,
    val caller_name: String? = null,
    val phone_number_id: String? = null,
    val conversation_id: String? = null,
    val outcome: String? = null,
    val direction: String,
    /** Talk time — 0 for misses, never ring time. */
    val forward_seconds: Int = 0,
    val screening_result: String? = null,
    val stir_attestation: String? = null,
    val voicemail_seconds: Int? = null,
    val answered_by_user_id: String? = null,
    val started_at: String,
) {
    /** Display resolution order: contact > CNAM dip > raw number. */
    val displayName: String?
        get() = contact_name ?: caller_name ?: caller_e164
}

/** POST /v1/webrtc/token — Telnyx credential login token (≤24h). */
@Serializable
data class WebRtcToken(
    val token: String,
    val sip_username: String,
    val expires_in_hours: Int = 24,
)
