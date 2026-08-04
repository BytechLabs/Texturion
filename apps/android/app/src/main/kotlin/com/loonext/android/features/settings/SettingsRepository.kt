package com.loonext.android.features.settings

import com.loonext.android.BuildConfig
import com.loonext.android.core.auth.await
import com.loonext.android.core.model.BillingModules
import com.loonext.android.core.model.ChangePlanResult
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.HostedUrl
import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberNumberAccess
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.Usage
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.core.model.OnCallShiftBody
import com.loonext.android.core.model.OnCallShiftCreated
import com.loonext.android.core.model.OnCallShiftsResponse
import com.loonext.android.core.model.ContactFieldDef
import com.loonext.android.core.model.ContactFieldsBody
import com.loonext.android.core.model.ContactFieldsResponse
import com.loonext.android.core.model.ReminderRule
import com.loonext.android.core.model.ReminderRulesBody
import com.loonext.android.core.model.ReminderRulesResponse
import com.loonext.android.core.model.ReminderRulesSaved
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

    /**
     * #490: the calls that reached a line which could not take them. Asked only
     * when the subscription is not active — it is an aggregate over the busiest
     * table in the product, and a paying workspace must never pay for a
     * question it is not asking.
     */
    suspend fun missedWhileOff(companyId: String): MissedWhileOff =
        api.get("/v1/billing/missed-while-off", companyId = companyId)

    /** PATCH /v1/company — returns the updated scalar columns as a view. */
    suspend fun updateCompany(companyId: String, patch: JsonObject): CompanyView =
        api.patch("/v1/company", patch, companyId = companyId)

    // -- #237 appointment reminders -----------------------------------------

    /**
     * The workspace's reminder rules, plus the two it would get if it asked.
     *
     * `suggested` is offered, never applied: no workspace sends reminders until
     * somebody turns them on, because seeding them would start texting a live
     * customer base automatically.
     */
    // -- #244 on call -------------------------------------------------------

    /** Live and upcoming shifts. A finished one is history. */
    suspend fun onCallShifts(companyId: String): OnCallShiftsResponse =
        api.get("/v1/on-call", companyId = companyId)

    suspend fun createOnCallShift(
        companyId: String,
        body: OnCallShiftBody,
    ): OnCallShiftCreated = api.post("/v1/on-call", body = body, companyId = companyId)

    suspend fun endOnCallShift(companyId: String, id: String) {
        api.delete("/v1/on-call/$id", companyId = companyId)
    }

    suspend fun reminderRules(companyId: String): ReminderRulesResponse =
        api.get("/v1/appointment-reminders", companyId = companyId)

    /**
     * Replace the whole set. Not per-rule saves — there are at most two, they
     * are edited together, and an empty list is how reminders are turned off.
     */
    suspend fun saveReminderRules(
        companyId: String,
        rules: List<ReminderRule>,
    ): ReminderRulesSaved = api.put(
        "/v1/appointment-reminders",
        body = ReminderRulesBody(rules),
        companyId = companyId,
    )

    /** #291: the fields this workspace defined for its own trade. */
    suspend fun contactFields(companyId: String): ContactFieldsResponse =
        api.get("/v1/contact-fields", companyId = companyId)

    /**
     * Replace the whole set. Not per-field saves — there are at most ten, they
     * are ordered relative to each other, and the order in the list IS the
     * order they appear on every contact.
     */
    suspend fun saveContactFields(
        companyId: String,
        fields: List<ContactFieldDef>,
    ): ContactFieldsResponse = api.put(
        "/v1/contact-fields",
        body = ContactFieldsBody(fields),
        companyId = companyId,
    )

    /**
     * #386: re-open your own bounced address after fixing it. Company-exempt
     * server-side — an address belongs to a person, not to a workspace.
     */
    suspend fun retryOwnEmail(): JsonObject = api.post("/v1/me/email/retry")

    suspend fun usage(companyId: String): Usage =
        api.get("/v1/usage", companyId = companyId)

    // -- team ---------------------------------------------------------------

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    /**
     * #348: what one member reaches on every number, and which rule decided it.
     * Owner/admin only — it answers for ANOTHER person, which is a management
     * question rather than something a member may ask about themselves.
     */
    suspend fun memberNumberAccess(companyId: String, userId: String): MemberNumberAccess =
        api.get("/v1/numbers/access/explain/$userId", companyId = companyId)

    /**
     * #286: what I reach, and why — INCLUDING the numbers I do not.
     *
     * The member-facing twin of the route above. It takes no user id: the
     * session decides who is asking, so there is nobody to be protected from,
     * which is why every role may call it.
     */
    suspend fun myNumberAccess(companyId: String): MemberNumberAccess =
        api.get("/v1/numbers/access/me", companyId = companyId)

    suspend fun setMemberRole(companyId: String, memberId: String, role: String): Member =
        api.patch("/v1/members/$memberId", buildJsonObject { put("role", role) }, companyId)

    suspend fun deactivateMember(companyId: String, memberId: String) {
        api.delete("/v1/members/$memberId", companyId = companyId)
    }

    /**
     * #406: leave this workspace yourself. Every membership action used to be
     * something done TO a member and never BY one, so a tech who quit on Friday
     * still had the customer list on Monday.
     */
    suspend fun leaveWorkspace(companyId: String) {
        api.delete("/v1/members/me", companyId = companyId)
    }

    // -- two-factor (#314) --------------------------------------------------
    //
    // Enrolment itself is SupabaseAuth's (GoTrue directly, the D8 boundary).
    // These are the parts Supabase does not give us.

    suspend fun mfa(): MfaState = api.get("/v1/mfa")

    /** Issue a fresh set. The plaintext comes back once and never again. */
    suspend fun issueRecoveryCodes(): RecoveryCodes = api.post("/v1/mfa/recovery-codes")

    /**
     * Burn a code. This REMOVES the factor rather than elevating the session —
     * the loud path, deliberately: a code that granted aal2 would turn a
     * stolen password plus a stolen printout into a silent full bypass.
     */
    suspend fun recoverWithCode(code: String): JsonObject =
        api.post("/v1/mfa/recover", buildJsonObject { put("code", code) })

    /** Owner only. `graceDays` is ignored once a deadline already exists. */
    suspend fun setWorkspaceMfa(
        companyId: String,
        required: Boolean,
        graceDays: Int = 14,
    ): WorkspaceMfa =
        api.put(
            "/v1/company/mfa",
            buildJsonObject {
                put("required", required)
                put("grace_days", graceDays)
            },
            companyId = companyId,
        )

    // -- ownership (#332) ---------------------------------------------------
    //
    // Five writes, one read, and the read is the only thing that decides what
    // any of the buttons look like — see the `can_*` booleans on [Ownership].

    suspend fun ownership(companyId: String): Ownership =
        api.get("/v1/company/ownership", companyId = companyId)

    /** Name the one person who may later claim ownership; null clears it. */
    suspend fun setBackupOwner(companyId: String, memberId: String?): Ownership =
        api.post(
            "/v1/company/ownership/backup",
            // An explicit null, not an omitted key: "nobody" is the answer
            // that CLEARS the nomination, and a dropped key would read as
            // "leave it as it was".
            buildJsonObject {
                put("member_id", memberId?.let { JsonPrimitive(it) } ?: JsonNull)
            },
            companyId = companyId,
        )

    /** Offer ownership. Nothing moves until the recipient accepts. */
    suspend fun offerOwnership(companyId: String, memberId: String): Ownership =
        api.post(
            "/v1/company/ownership/offer",
            buildJsonObject { put("member_id", memberId) },
            companyId = companyId,
        )

    /** The named backup asks to take over. Starts the owner's veto window. */
    suspend fun claimOwnership(companyId: String): Ownership =
        api.post("/v1/company/ownership/claim", companyId = companyId)

    /** Accept an offer, or complete a claim whose waiting period is over. */
    suspend fun acceptOwnership(companyId: String): Ownership =
        api.post("/v1/company/ownership/accept", companyId = companyId)

    /** The owner's veto and the recipient's decline are the same call. */
    suspend fun cancelOwnershipTransfer(companyId: String): Ownership =
        api.post("/v1/company/ownership/cancel", companyId = companyId)

    // -- signed-in devices (#236) -------------------------------------------

    /**
     * The two SELF routes are company-EXEMPT, and that is not an oversight to
     * tidy up: somebody who has just been removed from their only workspace
     * must still be able to sign their old phone out.
     */
    suspend fun mySessions(): Page<DeviceSession> = api.get("/v1/sessions")

    /** Sign one device out. */
    suspend fun revokeMySession(sessionId: String): SessionRevokeResult =
        api.post("/v1/sessions/revoke", buildJsonObject { put("session_id", sessionId) })

    /**
     * Sign out everywhere EXCEPT this phone. There is deliberately no "and
     * this one too" — that is the sign-out button, and offering it here would
     * end the session that is reading the result.
     */
    suspend fun revokeMyOtherSessions(): SessionRevokeResult =
        api.post("/v1/sessions/revoke", buildJsonObject { put("others", true) })

    suspend fun workspaceSessions(companyId: String): Page<WorkspaceSession> =
        api.get("/v1/members/sessions", companyId = companyId)

    suspend fun revokeMemberSessions(companyId: String, memberId: String): SessionRevokeResult =
        api.post("/v1/members/$memberId/sessions/revoke", companyId = companyId)

    // -- account (#346) -----------------------------------------------------
    //
    // Company-EXEMPT, both of them: deleting your account is about the person,
    // not one of their workspaces, and somebody who belongs to none must still
    // be able to leave. Passing a company id here would be wrong, not merely
    // unnecessary.

    suspend fun accountDeletionPreview(): AccountDeletionPreview =
        api.get("/v1/account/deletion-preview")

    suspend fun deleteAccount(): AccountDeletionResult = api.deleteReturning("/v1/account")

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
        /**
         * #513: digits the number must contain, honoured by the SEARCH.
         *
         * The picker used to narrow only the batch it already held, so asking
         * for a fresh one silently discarded what had been typed. Telnyx
         * honours `filter[phone_number][contains]` — a comment in the web
         * client claimed otherwise for months and it was wrong.
         */
        contains: String? = null,
        limit: Int = 50,
    ): AvailableNumbersResult = api.get(
        "/v1/available-numbers",
        query = mapOf(
            "country" to country,
            "area_code" to areaCode,
            "best_effort" to if (bestEffort) "true" else null,
            "contains" to contains,
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

    /** #307: this line's identity, resolved with what each field inherits. */
    suspend fun numberIdentity(companyId: String, numberId: String): NumberIdentity =
        api.get("/v1/numbers/$numberId/identity", companyId = companyId)

    // -- #309 recorded voicemail greetings ----------------------------------

    /** What this workspace has recorded. */
    suspend fun voicemailGreetings(companyId: String): List<VoicemailGreeting> =
        api.get<Page<VoicemailGreeting>>("/v1/voicemail-greetings", companyId = companyId).data

    /**
     * Record one. Multipart, so it goes through [GreetingUploader] rather than
     * the JSON client — the same door the wrap-up dictation uses.
     */
    suspend fun recordGreeting(
        companyId: String,
        name: String,
        durationMs: Int,
        audio: ByteArray,
    ): VoicemailGreeting =
        GreetingUploader(api, baseUrl).upload(companyId, name, durationMs, audio)

    /**
     * #309's record-by-phone path: WE ring the owner, they speak after the beep
     * and hang up.
     *
     * Nothing exists when this returns. The greeting is written only once the
     * recording lands, so the card polls the list rather than trusting a
     * response — a call the owner never answers correctly produces nothing.
     */
    suspend fun greetingCaptureCall(companyId: String, name: String, to: String) {
        api.post<JsonObject, JsonObject>(
            "/v1/voicemail-greetings/capture-call",
            buildJsonObject {
                put("name", name)
                put("to", to)
            },
            companyId = companyId,
        )
    }

    /** Delete one. Every line using it goes back to the written words. */
    suspend fun deleteGreeting(companyId: String, id: String) {
        api.delete("/v1/voicemail-greetings/$id", companyId)
    }

    /**
     * #307: set or CLEAR this line's overrides.
     *
     * A field carrying JsonNull means INHERIT, so the body must send null
     * rather than omit the key — omitting it leaves the override in place,
     * which is the opposite of what "use the workspace's" means.
     */
    suspend fun setNumberIdentity(
        companyId: String,
        numberId: String,
        body: JsonObject,
    ): NumberIdentity = api.patch("/v1/numbers/$numberId/identity", body, companyId = companyId)

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

    /** Save wizard drafts. Each part must be a COMPLETE draft — the server
     *  validates the whole object, so send every field, not just edits. */
    suspend fun saveRegistrationDraft(
        companyId: String,
        body: JsonObject,
    ): RegistrationDetailPair = api.put("/v1/registration", body, companyId = companyId)

    /** Owner-only: a Canadian company turning US texting on (one-time $29). */
    suspend fun enableUsTexting(companyId: String): EnableUsResult =
        api.post("/v1/registration/enable-us", companyId = companyId)

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
