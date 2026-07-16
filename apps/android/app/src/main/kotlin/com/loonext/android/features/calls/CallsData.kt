package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * GET /v1/calls/:sessionId/voicemail — a short-lived (1h) signed URL. Minted
 * per playback and NEVER cached/persisted (SPEC: signed attachment URLs are
 * always fetched on view). Extension model (core/model doesn't carry it yet —
 * flagged for the integrator).
 */
@Serializable
data class VoicemailPlayback(
    val url: String,
    val seconds: Int = 0,
)

/** The calls tab's typed /v1 reads (log, voicemail, teammate names). */
class CallsRepository(private val api: ApiClient) {
    /** Company call log, newest first, cursor-paged, #106-filtered in SQL. */
    suspend fun calls(
        companyId: String,
        outcome: String? = null,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<Call> = api.get(
        "/v1/calls",
        query = mapOf(
            "outcome" to outcome,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /** Mint a fresh signed playback URL — on demand, per view. */
    suspend fun voicemail(companyId: String, sessionId: String): VoicemailPlayback =
        api.get("/v1/calls/$sessionId/voicemail", companyId = companyId)

    /** Member display names for the transfer picker (targets are id-only). */
    suspend fun members(companyId: String): Page<Member> = api.get(
        "/v1/members",
        query = mapOf("limit" to "100"),
        companyId = companyId,
    )
}
