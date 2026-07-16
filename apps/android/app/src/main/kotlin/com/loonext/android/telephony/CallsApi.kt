package com.loonext.android.telephony

import com.loonext.android.core.model.WebRtcToken
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * Typed /v1 calls for the softphone's server side: token mint, outbound
 * authorization, live-call ops. Wire models that core/model doesn't carry yet
 * live here (extension models per the mobile build rules — flagged for the
 * integrator to hoist into core/model when convenient).
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

/** GET /v1/calls/live/:sessionId — the call bar facts (notes deep-link). */
@Serializable
data class LiveCallFacts(
    val conversation_id: String? = null,
    val caller_e164: String? = null,
)

@Serializable
data class TransferTarget(val user_id: String, val busy: Boolean)

@Serializable
data class TransferTargets(val targets: List<TransferTarget> = emptyList())

@Serializable
data class TransferAck(val status: String)

@Serializable
data class RingAck(val ok: Boolean)

@Serializable
private data class TransferBody(val target_user_id: String)

class CallsApi(private val api: ApiClient) {
    /** Mint the Telnyx login token — on start/recovery ONLY (rate-limited). */
    suspend fun mintToken(companyId: String): WebRtcToken =
        api.post("/v1/webrtc/token", companyId = companyId)

    /** Authorize an outbound call (all gates run server-side; no dial yet). */
    suspend fun authorizeBrowserCall(
        companyId: String,
        conversationId: String? = null,
        contactId: String? = null,
        to: String? = null,
        phoneNumberId: String? = null,
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

    /**
     * Resolve an answered inbound RING leg to the customer call_session_id —
     * REQUIRED before any live-call op on an inbound answer (the ring leg has
     * its own session; acting on it addresses the wrong call).
     */
    suspend fun resolveByLeg(companyId: String, legCcid: String): LegResolution =
        api.get("/v1/calls/live/by-leg/$legCcid", companyId = companyId)

    suspend fun liveFacts(companyId: String, sessionId: String): LiveCallFacts =
        api.get("/v1/calls/live/$sessionId", companyId = companyId)

    suspend fun transferTargets(companyId: String, sessionId: String): TransferTargets =
        api.get("/v1/calls/live/$sessionId/targets", companyId = companyId)

    suspend fun blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String,
    ): TransferAck = api.post(
        "/v1/calls/live/$sessionId/transfer",
        TransferBody(targetUserId),
        companyId = companyId,
    )

    /** Push-to-wake part 2: re-ring THIS member for a still-ringing call. */
    suspend fun ringMe(companyId: String, sessionId: String): RingAck =
        api.post("/v1/calls/live/$sessionId/ring-me", companyId = companyId)
}
