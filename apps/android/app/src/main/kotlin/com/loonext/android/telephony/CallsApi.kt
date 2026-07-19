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

/**
 * POST /v1/calls/live/:session/decline response (#171 bug 1). Decline is a
 * FIRST-CLASS server signal — the CallSessionDO records this member DECLINED,
 * removes their device from the avenue/audience set, cancels their ring legs,
 * and re-runs the T3 exhaustion ladder (single member left → voicemail now;
 * multi-member → the caller keeps ringing the others). Idempotent: a decline
 * for an already-resolved session is a 200 no-op. `declined` echoes the record;
 * `state` is the resulting §3 session state.
 */
@Serializable
data class DeclineAck(
    val declined: Boolean = true,
    val state: String? = null,
)

/**
 * POST /v1/calls/live/decline-mine response (#171 R1). The MEMBER-scoped
 * decline — the universal fallback that needs NO session in the request. The
 * server runs the existing DO.decline(session, me) for EVERY session currently
 * ringing this member (idempotent no-op where the member isn't a target), so a
 * FOREGROUND live-socket ring — where the SDK exposes neither a session nor a
 * ccid pre-answer, so client-side per-session resolution returns null — still
 * reaches the caller instead of holding ringback for the full 45s window.
 * Member identity comes from the Bearer token; no body. `sessions` echoes the
 * sessions the member was dropped from (empty = nothing was ringing them).
 */
@Serializable
data class DeclineMineAck(
    val declined: Boolean = true,
    val sessions: List<String> = emptyList(),
)

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

    /**
     * Decline the ringing call for THIS member (#171 bug 1) — the server-side
     * sibling of ring-me. A plain leg hangup only tears down the SDK leg; the
     * v3 avenue ladder still counts this member's push-capable device as an
     * open avenue and holds ringback to the 45s window. This tells the DO the
     * member REJECTED the call, so the caller's ring ends (or moves on to the
     * other members). Member identity comes from the Bearer token; no body.
     */
    suspend fun decline(companyId: String, sessionId: String): DeclineAck

    /**
     * Universal member-scoped decline (#171 R1) — the fallback every user-facing
     * Decline fires, needing NO session. Where the per-session [decline] can't
     * resolve a session (a foreground live-socket ring exposes none pre-answer),
     * this still drops THIS member's device from every ringing session's avenue
     * set so the caller's ring ends. Member identity is the Bearer token; no body.
     */
    suspend fun declineMine(companyId: String): DeclineMineAck
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

    override suspend fun decline(companyId: String, sessionId: String): DeclineAck =
        api.post("/v1/calls/live/$sessionId/decline", companyId = companyId)

    override suspend fun declineMine(companyId: String): DeclineMineAck =
        api.post("/v1/calls/live/decline-mine", companyId = companyId)
}
