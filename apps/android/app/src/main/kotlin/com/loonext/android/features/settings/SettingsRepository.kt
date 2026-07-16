package com.loonext.android.features.settings

import com.loonext.android.BuildConfig
import com.loonext.android.core.auth.await
import com.loonext.android.core.model.BillingModules
import com.loonext.android.core.model.ChangePlanResult
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.HostedUrl
import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.Usage
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** One document part for the multipart PUT upload routes. */
class DocumentUpload(
    val fieldName: String,
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
)

/**
 * All /v1 settings/billing/numbers endpoints (#157). Request shapes verified
 * against apps/api/src/routes/{companies,team,numbers,available-numbers,
 * billing,usage,porting,text-enablement,registration,notifications}.ts.
 *
 * Company PATCH bodies are hand-built [JsonObject]s so an explicit `null`
 * (clear this message) survives serialization — a data class with
 * `explicitNulls = false` would silently drop it.
 */
class SettingsRepository(
    private val api: ApiClient,
    private val baseUrl: String = BuildConfig.API_URL,
) {
    // -- company ------------------------------------------------------------

    suspend fun company(companyId: String): CompanyView =
        api.get("/v1/company", companyId = companyId)

    /** PATCH /v1/company — returns the updated scalar columns as a view. */
    suspend fun updateCompany(companyId: String, patch: JsonObject): CompanyView =
        api.patch("/v1/company", patch, companyId = companyId)

    suspend fun usage(companyId: String): Usage =
        api.get("/v1/usage", companyId = companyId)

    // -- team ---------------------------------------------------------------

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    suspend fun setMemberRole(companyId: String, memberId: String, role: String): Member =
        api.patch("/v1/members/$memberId", buildJsonObject { put("role", role) }, companyId)

    suspend fun deactivateMember(companyId: String, memberId: String) {
        api.delete("/v1/members/$memberId", companyId = companyId)
    }

    suspend fun invites(companyId: String): Page<Invite> =
        api.get("/v1/invites", companyId = companyId)

    suspend fun createInvite(companyId: String, email: String, role: String): Invite =
        api.post(
            "/v1/invites",
            buildJsonObject {
                put("email", email)
                put("role", role)
            },
            companyId = companyId,
        )

    suspend fun revokeInvite(companyId: String, inviteId: String) {
        api.delete("/v1/invites/$inviteId", companyId = companyId)
    }

    // -- numbers ------------------------------------------------------------

    suspend fun numbers(companyId: String): Page<PhoneNumberSummary> =
        api.get("/v1/numbers", companyId = companyId)

    suspend fun availableNumbers(
        country: String,
        areaCode: String? = null,
        bestEffort: Boolean = false,
        limit: Int = 50,
    ): AvailableNumbersResult = api.get(
        "/v1/available-numbers",
        query = mapOf(
            "country" to country,
            "area_code" to areaCode,
            "best_effort" to if (bestEffort) "true" else null,
            "limit" to limit.toString(),
        ),
        // Company-exempt route (the onboarding number step runs pre-company).
        companyId = null,
    )

    /** POST /v1/numbers/provision — Idempotency-Key REQUIRED (per intent). */
    suspend fun provisionNumber(
        companyId: String,
        idempotencyKey: String,
        chosenNumberE164: String? = null,
        requestedAreaCode: String? = null,
    ): PhoneNumberSummary = api.post(
        "/v1/numbers/provision",
        buildJsonObject {
            if (chosenNumberE164 != null) put("chosen_number_e164", chosenNumberE164)
            else put("requested_area_code", requestedAreaCode ?: "")
        },
        companyId = companyId,
        idempotencyKey = idempotencyKey,
    )

    /** POST /v1/numbers/:id/remediate — re-arm a failed row, no new charge. */
    suspend fun remediateNumber(
        companyId: String,
        numberId: String,
        chosenNumberE164: String? = null,
        requestedAreaCode: String? = null,
    ): PhoneNumberSummary = api.post(
        "/v1/numbers/$numberId/remediate",
        buildJsonObject {
            if (chosenNumberE164 != null) put("chosen_number_e164", chosenNumberE164)
            else put("requested_area_code", requestedAreaCode ?: "")
        },
        companyId = companyId,
    )

    /** DELETE /v1/numbers/:id — owner-only; returns the released row. */
    suspend fun releaseNumber(companyId: String, numberId: String): PhoneNumberSummary =
        api.json.decodeFromString(
            api.raw("DELETE", "/v1/numbers/$numberId", companyId = companyId),
        )

    suspend fun numberAccess(companyId: String, numberId: String): NumberAccess =
        api.get("/v1/numbers/$numberId/access", companyId = companyId)

    suspend fun setNumberAccess(
        companyId: String,
        numberId: String,
        body: JsonObject,
    ): NumberAccess = api.put("/v1/numbers/$numberId/access", body, companyId = companyId)

    // -- port-in ------------------------------------------------------------

    suspend fun ports(companyId: String): Page<PortRequest> =
        api.get("/v1/port-requests", companyId = companyId)

    suspend fun checkPortability(companyId: String, phoneE164: String): PortabilityCheck =
        api.post(
            "/v1/port-requests/check",
            buildJsonObject { put("phone_e164", phoneE164) },
            companyId = companyId,
        )

    /** POST /v1/port-requests — Idempotency-Key REQUIRED (per intent). */
    suspend fun createPort(
        companyId: String,
        idempotencyKey: String,
        body: JsonObject,
    ): PortRequest =
        api.post("/v1/port-requests", body, companyId = companyId, idempotencyKey = idempotencyKey)

    /** PUT /v1/port-requests/:id — fix-and-resubmit edits (draft/exception). */
    suspend fun updatePort(companyId: String, portId: String, body: JsonObject): PortRequest =
        api.put("/v1/port-requests/$portId", body, companyId = companyId)

    suspend fun uploadPortDocuments(
        companyId: String,
        portId: String,
        parts: List<DocumentUpload>,
    ): PortRequest = api.json.decodeFromString(
        multipartPut("/v1/port-requests/$portId/documents", companyId, parts),
    )

    suspend fun submitPort(companyId: String, portId: String): PortRequest =
        api.post("/v1/port-requests/$portId/submit", companyId = companyId)

    suspend fun resubmitPort(companyId: String, portId: String): PortRequest =
        api.post("/v1/port-requests/$portId/resubmit", companyId = companyId)

    /** Owner-only. */
    suspend fun cancelPort(companyId: String, portId: String): PortRequest =
        api.post("/v1/port-requests/$portId/cancel", companyId = companyId)

    // -- text-enablement ------------------------------------------------------

    suspend fun textEnablements(companyId: String): Page<TextEnablementOrder> =
        api.get("/v1/text-enablements", companyId = companyId)

    /** POST /v1/text-enablements — Idempotency-Key REQUIRED (per intent). */
    suspend fun createTextEnablement(
        companyId: String,
        idempotencyKey: String,
        phoneE164: String,
    ): TextEnablementOrder = api.post(
        "/v1/text-enablements",
        buildJsonObject { put("phone_e164", phoneE164) },
        companyId = companyId,
        idempotencyKey = idempotencyKey,
    )

    suspend fun uploadTextEnablementDocuments(
        companyId: String,
        orderId: String,
        parts: List<DocumentUpload>,
    ): TextEnablementOrder = api.json.decodeFromString(
        multipartPut("/v1/text-enablements/$orderId/documents", companyId, parts),
    )

    suspend fun resubmitTextEnablement(companyId: String, orderId: String): TextEnablementOrder =
        api.post("/v1/text-enablements/$orderId/resubmit", companyId = companyId)

    suspend fun requestVerificationCode(
        companyId: String,
        orderId: String,
        method: String,
    ): TextEnablementOrder = api.post(
        "/v1/text-enablements/$orderId/verification-codes",
        buildJsonObject { put("verification_method", method) },
        companyId = companyId,
    )

    suspend fun submitVerificationCode(
        companyId: String,
        orderId: String,
        code: String,
    ): TextEnablementOrder = api.post(
        "/v1/text-enablements/$orderId/verification-codes/verify",
        buildJsonObject { put("code", code) },
        companyId = companyId,
    )

    /** Owner-only. */
    suspend fun cancelTextEnablement(companyId: String, orderId: String): TextEnablementOrder =
        api.post("/v1/text-enablements/$orderId/cancel", companyId = companyId)

    // -- 10DLC registration ---------------------------------------------------

    suspend fun registration(companyId: String): RegistrationDetailPair =
        api.get("/v1/registration", companyId = companyId)

    /** First-submission recovery and rejected-resubmit. */
    suspend fun submitRegistration(companyId: String): RegistrationDetailPair =
        api.post("/v1/registration/submit", companyId = companyId)

    /** Sole-proprietor SMS OTP verification. */
    suspend fun verifyRegistrationOtp(companyId: String, code: String): RegistrationDetailPair =
        api.post(
            "/v1/registration/otp",
            buildJsonObject { put("code", code) },
            companyId = companyId,
        )

    suspend fun resendRegistrationOtp(companyId: String) {
        api.post<JsonObject>("/v1/registration/otp/resend", companyId = companyId)
    }

    // -- billing --------------------------------------------------------------

    suspend fun modules(companyId: String): BillingModules =
        api.get("/v1/billing/modules", companyId = companyId)

    suspend fun setModule(companyId: String, module: String, enabled: Boolean): JsonObject =
        api.post(
            "/v1/billing/modules",
            buildJsonObject {
                put("module", module)
                put("enabled", enabled)
            },
            companyId = companyId,
        )

    suspend fun changePlan(companyId: String, plan: String): ChangePlanResult =
        api.post(
            "/v1/billing/change-plan",
            buildJsonObject { put("plan", plan) },
            companyId = companyId,
        )

    /** Hosted Stripe Billing Portal URL — open in an EXTERNAL browser. */
    suspend fun billingPortal(companyId: String): HostedUrl =
        api.post("/v1/billing/portal", companyId = companyId)

    /** Hosted Stripe Checkout URL (resubscribe) — EXTERNAL browser only. */
    suspend fun checkout(companyId: String, plan: String): HostedUrl =
        api.post(
            "/v1/billing/checkout",
            buildJsonObject { put("plan", plan) },
            companyId = companyId,
        )

    // -- multipart ------------------------------------------------------------

    /**
     * Multipart PUT for the document-upload routes. [ApiClient.raw] only
     * carries JSON string bodies, so this builds its own OkHttp call with the
     * same bearer ([ApiClient.freshSession] refreshes proactively) and decodes
     * failures through the same SPEC §7 envelope.
     */
    private suspend fun multipartPut(
        path: String,
        companyId: String,
        parts: List<DocumentUpload>,
    ): String {
        val session = api.freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            parts.forEach { part ->
                addFormDataPart(
                    part.fieldName,
                    part.fileName,
                    part.bytes.toRequestBody(part.mimeType.toMediaType()),
                )
            }
        }.build()
        val request = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("X-Company-Id", companyId)
            .put(body)
            .build()
        val response = try {
            api.http.newCall(request).await()
        } catch (_: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach Loonext. Check your connection.",
                0,
            )
        }
        return response.use {
            ApiClient.RawResponse(it.code, it.body.string()).expectSuccess(api.json)
        }
    }
}
