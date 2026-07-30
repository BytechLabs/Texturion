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
    /** #208 live-state mirror: ringing/answered/voicemail_greeting/
     *  voicemail_recording/ended_* — nullable (outbound + pre-v3 rows). */
    val state: String? = null,
    val direction: String,
    /** Talk time — 0 for misses, never ring time. */
    val forward_seconds: Int = 0,
    val screening_result: String? = null,
    val stir_attestation: String? = null,
    val voicemail_seconds: Int? = null,
    /**
     * What the voicemail says, written best-effort after the recording is
     * stored. Null means it was not transcribed (turned off, over the monthly
     * cap, too long, or the model failed) and is never a reason to hide the
     * audio.
     */
    val voicemail_transcript: String? = null,
    /**
     * #367: what the caller said, pulled out of the transcript — the problem,
     * the address, a callback number, a name. Extraction only, never a
     * judgement about urgency, and null whenever there is nothing to show.
     */
    val voicemail_intake: VoicemailIntake? = null,
    val answered_by_user_id: String? = null,
    /** #191: the acting member's resolved display name — the PLACER of an
     *  outbound call, the ANSWERER of an inbound one (both land in
     *  answered_by_user_id, resolved to a name server-side). Null when the actor
     *  is unknown (pre-#211 outbound, an un-answered call, or a blank profile). */
    val answered_by_name: String? = null,
    /** When the line was picked up — the #210 live-duration anchor. */
    val answered_at: String? = null,
    val started_at: String,
) {
    /** Display resolution order: contact > CNAM dip > raw number. */
    val displayName: String?
        get() = contact_name ?: caller_name ?: caller_e164
}

/**
 * #367 depth (1) — what the caller said, from `calls.voicemail_intake`.
 *
 * Hand-port of `packages/shared/src/voicemail-intake.ts`. Every field is
 * something the caller SAID: nothing here is a classification, and there is
 * deliberately no urgency field to render — an AI that mishandles an emergency
 * is worse than voicemail, so it is never asked.
 */
@Serializable
data class VoicemailIntake(
    val problem: String? = null,
    val address: String? = null,
    val callback: String? = null,
    val name: String? = null,
)

/** One rendered row: a stable key, the label, and the caller's words. */
data class VoicemailIntakeLine(
    val key: String,
    val label: String,
    val value: String,
)

/**
 * The provenance label, per PORTAL-UX §3.1. The Lou mark beside it already says
 * a machine did this; these words say WHERE it read it, which is the half a
 * person can check against the transcript underneath.
 */
const val VOICEMAIL_INTAKE_SOURCE_LABEL = "From the voicemail"

/**
 * The rows worth drawing: present fields, in a fixed order, empties dropped.
 *
 * Dropping rather than blanking is the part with consequences. A labelled empty
 * row reports an absence as a finding — "Address" with nothing after it reads as
 * though we looked and the caller gave none, when most voicemails simply do not
 * contain most of these.
 *
 * Order matches web and iOS: whether to go, then where, then how to reach them.
 */
fun VoicemailIntake?.lines(): List<VoicemailIntakeLine> {
    val intake = this ?: return emptyList()
    val fields = listOf(
        Triple("problem", "Problem", intake.problem),
        Triple("address", "Address", intake.address),
        Triple("callback", "Call back", intake.callback),
        Triple("name", "Name", intake.name),
    )
    return fields.mapNotNull { (key, label, raw) ->
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) null else VoicemailIntakeLine(key, label, value)
    }
}

/** POST /v1/webrtc/token — Telnyx credential login token (≤24h). */
@Serializable
data class WebRtcToken(
    val token: String,
    val sip_username: String,
    val expires_in_hours: Int = 24,
)
