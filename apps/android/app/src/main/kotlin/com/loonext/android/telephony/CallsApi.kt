package com.loonext.android.telephony

import com.loonext.android.core.model.WebRtcToken
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * Typed /v1 calls for the softphone's server side: token mint, outbound
 * authorization, live-call ops. Wire models that core/model doesn't carry yet
 * live here (extension models per the mobile build rules — flagged for the
 * integrator to hoist into core/model when convenient).
 *
 * [CallsApi] is an interface for the same reason [SdkClient] is: it's the
 * seam SoftphoneCoreTest fakes with plain suspend functions. A real
 * HTTP-backed fake (MockWebServer) resumes the core's coroutines on OkHttp
 * threads — outside the kotlinx-coroutines-test scheduler — which made the
 * core's event ordering nondeterministic under CI load. Production always
 * uses [HttpCallsApi]; behavior is byte-for-byte the old CallsApi class.
 */

/** POST /v1/calls/browser response — client_state goes into newCall VERBATIM. */
@Serializable
data class BrowserCallAuth(
    val from: String,
    val to: String,
    val client_state: String,
)

@Serializable
data class OutboundCallBody(
    val conversation_id: String? = null,
    val contact_id: String? = null,
    val to: String? = null,
    val phone_number_id: String? = null,
)

/** GET /v1/calls/live/by-leg/:ccid — ring leg -> customer session. */
@Serializable
data class LegResolution(val call_session_id: String)

/**
 * GET /v1/calls/live/:sessionId — the LEGACY live read (calls-v3 §8.2,
 * semantics frozen). Only ever called post-answer (the call bar's notes
 * deep-link); ringing-phase reads use [LiveSessionState] instead.
 */
@Serializable
data class LiveCallFacts(
    val conversation_id: String? = null,
    val caller_e164: String? = null,
)

/**
 * GET /v1/calls/live/:sessionId/state — calls-v3 §8.1, the ONE state read.
 * Always 200 for a visible session, in any state, live or ended — state is
 * never encoded in an error code again. `state` uses the §3 vocabulary
 * (`ringing`/`answered`/`voicemail_*`/`ended_*`); treat null defensively
 * (state is never assumed total).
 */
@Serializable
data class LiveSessionState(
    val call_session_id: String,
    val state: String? = null,
    val direction: String? = null,
    val started_at: String? = null,
    val answered_at: String? = null,
    val answered_by_user_id: String? = null,
    val caller_e164: String? = null,
    val caller_name: String? = null,
    val conversation_id: String? = null,
    val phone_number_id: String? = null,
    val outcome: String? = null,
    val your_leg: SessionLeg? = null,
)

/** The caller's own leg from the DO snapshot (null when none / purged). */
@Serializable
data class SessionLeg(
    val call_control_id: String? = null,
    val status: String? = null,
)

@Serializable
data class TransferTarget(val user_id: String, val busy: Boolean)

@Serializable
data class TransferTargets(val targets: List<TransferTarget> = emptyList())

@Serializable
data class TransferAck(val status: String)

/**
 * ring-me v2 response (calls-v3 §8.3): always 200 for an authorized request.
 * `ok` is retained so pre-v3 decoders never break; `rang:true` = a fresh leg
 * was dialed (an INVITE is coming); `rang:false` + `reason` says why not
 * (`not_ringing` / `live_leg` / `recent_leg` / `dial_failed`).
 */
@Serializable
data class RingAck(
    val ok: Boolean = true,
    val rang: Boolean? = null,
    val state: String? = null,
    val reason: String? = null,
)

/** ring-me v2 request body (§6): v3 clients ALWAYS send `true` — by client
 *  rule §10.1.3 they only call ring-me when holding no live leg, so the call
 *  itself is the attestation "nothing presents on THIS DEVICE". */
@Serializable
private data class RingMeBody(val no_local_leg: Boolean)

@Serializable
private data class TransferBody(val target_user_id: String)

interface CallsApi {
    /** Mint the Telnyx login token — on start/recovery ONLY (rate-limited). */
    suspend fun mintToken(companyId: String): WebRtcToken

    /** Authorize an outbound call (all gates run server-side; no dial yet). */
    suspend fun authorizeBrowserCall(
        companyId: String,
        conversationId: String? = null,
        contactId: String? = null,
        to: String? = null,
        phoneNumberId: String? = null,
    ): BrowserCallAuth

    /**
     * Resolve an answered inbound RING leg to the customer call_session_id —
     * REQUIRED before any live-call op on an inbound answer (the ring leg has
     * its own session; acting on it addresses the wrong call).
     */
    suspend fun resolveByLeg(companyId: String, legCcid: String): LegResolution

    suspend fun liveFacts(companyId: String, sessionId: String): LiveCallFacts

    /**
     * The calls-v3 always-200 state read (§8.1) — polled at most on push
     * receipt, on INVITE, and on reconnect; steady-state updates arrive via
     * the `call.updated` realtime broadcast.
     */
    suspend fun sessionState(companyId: String, sessionId: String): LiveSessionState

    suspend fun transferTargets(companyId: String, sessionId: String): TransferTargets

    suspend fun blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String,
    ): TransferAck

    /**
     * ring-me v2 (§8.3): ask the server to dial a fresh leg for THIS member.
     * [noLocalLeg] is the §6 attestation — always true from this client
     * (§10.1.3: ring-me is only called when no live leg exists locally).
     */
    suspend fun ringMe(
        companyId: String,
        sessionId: String,
        noLocalLeg: Boolean = true,
    ): RingAck
}

class HttpCallsApi(private val api: ApiClient) : CallsApi {
    override suspend fun mintToken(companyId: String): WebRtcToken =
        api.post("/v1/webrtc/token", companyId = companyId)

    override suspend fun authorizeBrowserCall(
        companyId: String,
        conversationId: String?,
        contactId: String?,
        to: String?,
        phoneNumberId: String?,
    ): BrowserCallAuth = api.post(
        "/v1/calls/browser",
        OutboundCallBody(
            conversation_id = conversationId,
            contact_id = contactId,
            to = to,
            phone_number_id = phoneNumberId,
        ),
        companyId = companyId,
    )

    override suspend fun resolveByLeg(companyId: String, legCcid: String): LegResolution =
        api.get("/v1/calls/live/by-leg/$legCcid", companyId = companyId)

    override suspend fun liveFacts(companyId: String, sessionId: String): LiveCallFacts =
        api.get("/v1/calls/live/$sessionId", companyId = companyId)

    override suspend fun sessionState(companyId: String, sessionId: String): LiveSessionState =
        api.get("/v1/calls/live/$sessionId/state", companyId = companyId)

    override suspend fun transferTargets(companyId: String, sessionId: String): TransferTargets =
        api.get("/v1/calls/live/$sessionId/targets", companyId = companyId)

    override suspend fun blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String,
    ): TransferAck = api.post(
        "/v1/calls/live/$sessionId/transfer",
        TransferBody(targetUserId),
        companyId = companyId,
    )

    override suspend fun ringMe(
        companyId: String,
        sessionId: String,
        noLocalLeg: Boolean,
    ): RingAck = api.post(
        "/v1/calls/live/$sessionId/ring-me",
        RingMeBody(no_local_leg = noLocalLeg),
        companyId = companyId,
    )
}
