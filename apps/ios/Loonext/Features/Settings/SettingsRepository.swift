import Foundation

/// All /v1 settings/billing/numbers endpoints (#163). Request shapes verified
/// against apps/api/src/routes/{companies,team,numbers,available-numbers,
/// billing,usage,porting,text-enablement,registration}.ts and the Android
/// twin's SettingsRepository.kt. (Notification prefs live with #162's
/// NotificationsFeedApi — the settings screen hosts that card.)
///
/// Company PATCH bodies are hand-built `JSONValue` objects so an explicit
/// `null` (clear this message) survives serialization — `JSONValue.null`
/// encodes as JSON `null` under its key.
struct SettingsRepository: Sendable {
    let api: ApiClient
    let sessionStore: SessionStore
    var baseURL: URL = AppConfig.apiURL

    // MARK: - Company

    func company(_ companyId: String) async throws -> CompanyView {
        try await api.get("/v1/company", companyId: companyId)
    }

    /// PATCH /v1/company — returns the updated scalar columns as a view.
    /// #490: the calls that reached a line which could not take them. Asked
    /// only when the subscription is not active — it is an aggregate over the
    /// busiest table in the product, and a paying workspace must never pay for
    /// a question it is not asking.
    func missedWhileOff(_ companyId: String) async throws -> MissedWhileOff {
        try await api.get("/v1/billing/missed-while-off", companyId: companyId)
    }

    func updateCompany(_ companyId: String, patch: JSONValue) async throws -> CompanyView {
        try await api.patch("/v1/company", body: patch, companyId: companyId)
    }

    // MARK: - #232 website widget

    /// The workspace's widget key, asked for only when somebody opens the card.
    ///
    /// Deliberately NOT on the company view every member loads at startup: the
    /// key is the credential in the embed, and asking for it is the act of
    /// installing a widget rather than the act of opening the app.
    func widgetKey(_ companyId: String) async throws -> WidgetKey {
        try await api.get("/v1/company/widget-key", companyId: companyId)
    }

    /// Replace the key. Every embed carrying the old one stops working.
    func rotateWidgetKey(_ companyId: String) async throws -> WidgetKey {
        try await api.post("/v1/company/widget-key/rotate", companyId: companyId)
    }

    // MARK: - #237 appointment reminders

    /// The workspace's reminder rules, plus the two it would get if it asked.
    ///
    /// `suggested` is offered, never applied: no workspace sends reminders
    /// until somebody turns them on, because seeding them would start texting a
    /// live customer base automatically.
    // MARK: - #244 on call

    /// Live and upcoming shifts. A finished one is history.
    func onCallShifts(_ companyId: String) async throws -> OnCallShiftsResponse {
        try await api.get("/v1/on-call", companyId: companyId)
    }

    func createOnCallShift(
        _ companyId: String,
        body: OnCallShiftBody
    ) async throws -> OnCallShiftCreated {
        try await api.post("/v1/on-call", body: body, companyId: companyId)
    }

    func endOnCallShift(_ companyId: String, id: String) async throws {
        try await api.delete("/v1/on-call/\(id)", companyId: companyId)
    }

    func reminderRules(_ companyId: String) async throws -> ReminderRulesResponse {
        try await api.get("/v1/appointment-reminders", companyId: companyId)
    }

    /// Replace the whole set. Not per-rule saves — there are at most two, they
    /// are edited together, and an empty list is how reminders are turned off.
    func saveReminderRules(
        _ companyId: String,
        rules: [ReminderRule]
    ) async throws -> ReminderRulesSaved {
        try await api.put(
            "/v1/appointment-reminders",
            body: ReminderRulesBody(rules: rules),
            companyId: companyId
        )
    }

    /// #291: the fields this workspace defined for its own trade.
    ///
    /// Here as well as on the contacts repository, because the two screens
    /// that need them are on opposite sides of the app: the settings card
    /// defines them, the contact panel fills them in. One method on the wrong
    /// repository compiles on Android and fails only in CI here.
    func contactFields(_ companyId: String) async throws -> ContactFieldsResponse {
        try await api.get("/v1/contact-fields", companyId: companyId)
    }

    /// Replace the whole set. Not per-field saves — there are at most ten, and
    /// the order in the list IS the order they appear on every contact.
    func saveContactFields(
        companyId: String,
        fields: [ContactFieldDef]
    ) async throws -> ContactFieldsResponse {
        try await api.put(
            "/v1/contact-fields",
            body: ContactFieldsBody(fields: fields),
            companyId: companyId
        )
    }

    /// #386: re-open your own bounced address after fixing it. Company-exempt
    /// server-side — an address belongs to a person, not to a workspace.
    func retryOwnEmail() async throws -> JSONValue {
        try await api.post("/v1/me/email/retry")
    }

    func usage(_ companyId: String) async throws -> Usage {
        try await api.get("/v1/usage", companyId: companyId)
    }

    // MARK: - #595 usage export (routes/exports.ts)

    /// POST /v1/exports/usage — this workspace's metered usage for a period.
    ///
    /// Behind `billing.manage` server-side, and deliberately NOT the
    /// `contacts.bulk` gate its neighbours carry: the document names no
    /// customer, and the bulk gate would lock out the bookkeeper it exists for.
    /// `UsageExportCard` asks the same capability before offering the surface,
    /// so this call is never made speculatively.
    ///
    /// Both instants are ISO-8601 UTC. `from` is required; `to` absent means the
    /// period is still running.
    func requestUsageExport(
        _ companyId: String,
        from: String,
        to: String?
    ) async throws -> DataExportRequested {
        try await api.post(
            "/v1/exports/usage",
            body: UsageExportBody(from: from, to: to),
            companyId: companyId
        )
    }

    /// GET /v1/exports — the recent exports, with links minted at read time.
    ///
    /// Gated on `workspace.access`, and the KINDS are filtered SQL-side to the
    /// ones this caller may collect (#581/C13). No client-side role logic here
    /// for exactly that reason: a second implementation of one access decision
    /// is the drift D79 exists to prevent.
    func dataExports(_ companyId: String) async throws -> Page<DataExport> {
        try await api.get("/v1/exports", companyId: companyId)
    }

    // MARK: - AI enrichment settings (#214)

    /// GET /v1/company/ai-settings — member-visible read.
    func aiSettings(_ companyId: String) async throws -> CompanyAiSettings {
        try await api.get("/v1/company/ai-settings", companyId: companyId)
    }

    /// PATCH /v1/company/ai-settings — admin-only; the server 403s a member.
    func updateAiSettings(
        _ companyId: String,
        enrichAddress: Bool,
        enrichDue: Bool,
        suggestReplies: Bool,
        transcribeVoicemail: Bool,
        voicemailIntake: Bool,
        callWrapup: Bool,
        summarizeThreads: Bool,
        businessDescription: String? = nil
    ) async throws -> CompanyAiSettings {
        var body: [String: JSONValue] = [
            "enrich_task_address": .bool(enrichAddress),
            "enrich_task_due": .bool(enrichDue),
            "suggest_replies": .bool(suggestReplies),
            "transcribe_voicemail": .bool(transcribeVoicemail),
            // #367: always on the wire. The server reads an ABSENT field as
            // "leave it alone", so a client that dropped this could turn the
            // greeting on and never be able to turn it back off.
            "voicemail_intake": .bool(voicemailIntake),
            // #507: same argument — absent means "leave it alone", so a save
            // that dropped this could turn dictation off and never turn it on.
            // Required rather than defaulted for the same reason: a new call
            // site has to say what it means to do with it.
            "call_wrapup": .bool(callWrapup),
            // #247: same argument a third time. Absent means "leave it alone",
            // so a save that dropped this could turn catch-ups off and never
            // turn them back on.
            "summarize_threads": .bool(summarizeThreads),
        ]
        // Omitted leaves whatever is stored; an empty string clears it. A
        // toggle save must never wipe the description as a side effect.
        if let businessDescription {
            body["business_description"] = .string(businessDescription)
        }
        return try await api.patch(
            "/v1/company/ai-settings",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    // MARK: - Team

    func members(_ companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }

    /**
     #286: what I reach, and why — INCLUDING the numbers I do not.

     The member-facing twin of the route below. It takes no user id: the
     session decides who is asking, so there is nobody to be protected from,
     which is why every role may call it.
     */
    func myNumberAccess(_ companyId: String) async throws -> MemberNumberAccess {
        try await api.get("/v1/numbers/access/me", companyId: companyId)
    }

    /// #348: what one member reaches on every number, and which rule decided it.
    /// Owner/admin only — it answers for ANOTHER person, which is a management
    /// question rather than something a member may ask about themselves.
    func memberNumberAccess(
        _ companyId: String,
        userId: String
    ) async throws -> MemberNumberAccess {
        try await api.get("/v1/numbers/access/explain/\(userId)", companyId: companyId)
    }

    /// #538: `confirmLosingAccess` travels only when somebody is giving up their
    /// OWN access, having been shown what that costs. The server refuses a
    /// self-downgrade without it, so this is the evidence the warning was seen —
    /// not a flag to set by default.
    func setMemberRole(
        _ companyId: String,
        memberId: String,
        role: String,
        confirmLosingAccess: Bool = false
    ) async throws -> Member {
        var body: [String: JSONValue] = ["role": .string(role)]
        if confirmLosingAccess { body[SelfDowngrade.ack] = .bool(true) }
        return try await api.patch(
            "/v1/members/\(memberId)",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    func deactivateMember(_ companyId: String, memberId: String) async throws {
        try await api.delete("/v1/members/\(memberId)", companyId: companyId)
    }

    /// #406: leave this workspace yourself. Every membership action used to be
    /// something done TO a member and never BY one, so a tech who quit on
    /// Friday still had the customer list on Monday.
    func leaveWorkspace(_ companyId: String) async throws {
        try await api.delete("/v1/members/me", companyId: companyId)
    }

    // MARK: - Two-factor (#314)
    //
    // Enrolment itself is SettingsAuthClient's (GoTrue directly, the D8
    // boundary). These are the parts Supabase does not give us.

    func mfa() async throws -> MfaState {
        try await api.get("/v1/mfa")
    }

    /// Issue a fresh set. The plaintext comes back once and never again.
    func issueRecoveryCodes() async throws -> RecoveryCodes {
        try await api.post("/v1/mfa/recovery-codes", body: JSONValue.object([:]))
    }

    /// Burn a code. This REMOVES the factor rather than elevating the session —
    /// the loud path, deliberately: a code that granted aal2 would turn a
    /// stolen password plus a stolen printout into a silent full bypass.
    func recoverWithCode(_ code: String) async throws -> JSONValue {
        try await api.post(
            "/v1/mfa/recover",
            body: JSONValue.object(["code": .string(code)])
        )
    }

    /// Owner only. `graceDays` is ignored once a deadline already exists.
    func setWorkspaceMfa(
        _ companyId: String,
        required: Bool,
        graceDays: Int = 14,
        /// The #537 confirmation, read by the server only when this turns the
        /// requirement OFF. No screen on this phone does that yet — the workspace
        /// switch is web-only — but the parameter belongs with the call rather than
        /// with whoever adds the screen.
        code: String? = nil
    ) async throws -> WorkspaceMfa {
        var body: [String: JSONValue] = [
            "required": .bool(required),
            "grace_days": .number(Double(graceDays)),
        ]
        if let code { body["confirmation_code"] = .string(code) }
        return try await api.put(
            "/v1/company/mfa",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    // MARK: - Ownership (#332)
    //
    // Five writes, one read, and the read is the only thing that decides what
    // any of the buttons look like — see the `can*` flags on `Ownership`.

    func ownership(_ companyId: String) async throws -> Ownership {
        try await api.get("/v1/company/ownership", companyId: companyId)
    }

    /// Name the one person who may later claim ownership; nil clears it.
    func setBackupOwner(_ companyId: String, memberId: String?) async throws -> Ownership {
        // An explicit null, not an omitted key: "nobody" is the answer that
        // CLEARS the nomination, and a dropped key would read as "leave it".
        try await api.post(
            "/v1/company/ownership/backup",
            body: JSONValue.object([
                "member_id": memberId.map(JSONValue.string) ?? .null
            ]),
            companyId: companyId
        )
    }

    /// Offer ownership. Nothing moves until the recipient accepts.
    ///
    /// `code` is the confirmation from an authenticator or an email (#537). Sent only
    /// on a retry — the first attempt is what tells us which of the two the server
    /// wants, and asking for a code nobody has been asked for yet is noise.
    func offerOwnership(
        _ companyId: String,
        memberId: String,
        code: String? = nil
    ) async throws -> Ownership {
        var body: [String: JSONValue] = ["member_id": .string(memberId)]
        if let code { body["confirmation_code"] = .string(code) }
        return try await api.post(
            "/v1/company/ownership/offer",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    /// The named backup asks to take over. Starts the owner's veto window.
    func claimOwnership(_ companyId: String, code: String? = nil) async throws -> Ownership {
        try await api.post(
            "/v1/company/ownership/claim",
            body: JSONValue.object(Self.confirmationBody(code)),
            companyId: companyId
        )
    }

    /// Accept an offer, or complete a claim whose waiting period is over.
    func acceptOwnership(_ companyId: String, code: String? = nil) async throws -> Ownership {
        try await api.post(
            "/v1/company/ownership/accept",
            body: JSONValue.object(Self.confirmationBody(code)),
            companyId: companyId
        )
    }

    /// A body carrying nothing but the confirmation code, when there is one (#537).
    private static func confirmationBody(_ code: String?) -> [String: JSONValue] {
        guard let code else { return [:] }
        return ["confirmation_code": .string(code)]
    }

    /// Ask for a confirmation code by email (#537).
    ///
    /// Only for somebody with no authenticator. The answer is always "sent" whether or
    /// not it was, so nothing here can be used to find out who holds an account.
    func requestHandoverCode(_ companyId: String, action: String) async throws {
        let _: JSONValue = try await api.post(
            "/v1/company/ownership/confirm-code",
            body: JSONValue.object(["action": .string(action)]),
            companyId: companyId
        )
    }

    /// The owner's veto and the recipient's decline are the same call.
    func cancelOwnershipTransfer(_ companyId: String) async throws -> Ownership {
        try await api.post(
            "/v1/company/ownership/cancel",
            body: JSONValue.object([:]),
            companyId: companyId
        )
    }

    // MARK: - Signed-in devices (#236)
    //
    // The two SELF routes are company-EXEMPT, and that is not an oversight to
    // tidy up: somebody who has just been removed from their only workspace
    // must still be able to sign their old phone out.

    func mySessions() async throws -> Page<DeviceSession> {
        try await api.get("/v1/sessions")
    }

    /// Sign one device out.
    func revokeMySession(sessionId: String) async throws -> SessionRevokeResult {
        try await api.post(
            "/v1/sessions/revoke",
            body: JSONValue.object(["session_id": .string(sessionId)])
        )
    }

    /// Sign out everywhere EXCEPT this phone. There is deliberately no "and
    /// this one too" — that is the sign-out button, and offering it here would
    /// end the session that is reading the result.
    func revokeMyOtherSessions() async throws -> SessionRevokeResult {
        try await api.post(
            "/v1/sessions/revoke",
            body: JSONValue.object(["others": .bool(true)])
        )
    }

    /// Sign THIS phone out server-side, which is what the sign-out button forgot.
    ///
    /// `SupabaseAuth.signOut` ends the GoTrue session and nothing else, so
    /// `user_sessions.revoked_at` stayed null and the softphone credential was never
    /// swept — and because authorization is `revoked_at is null`, the access token
    /// this phone holds kept full read and send for the rest of its life after
    /// somebody pressed Sign out. Called from `RootViewModel.signOut` before the
    /// local clear, in the same slot the push-token delete already occupies.
    ///
    /// The note above about there deliberately being no "and this one too" is about
    /// the DEVICES LIST, where ending the session that is reading the result makes
    /// for a bad screen. It never meant the operation should not exist.
    func revokeThisSession() async throws -> SessionRevokeResult {
        try await api.post(
            "/v1/sessions/revoke",
            body: JSONValue.object(["self": .bool(true)])
        )
    }

    func workspaceSessions(_ companyId: String) async throws -> Page<WorkspaceSession> {
        try await api.get("/v1/members/sessions", companyId: companyId)
    }

    func revokeMemberSessions(
        _ companyId: String,
        memberId: String
    ) async throws -> SessionRevokeResult {
        try await api.post(
            "/v1/members/\(memberId)/sessions/revoke",
            body: JSONValue.object([:]),
            companyId: companyId
        )
    }

    // MARK: - Account (#346)
    //
    // Company-EXEMPT, both of them: deleting your account is about the person,
    // not one of their workspaces, and somebody who belongs to none must still
    // be able to leave. Passing a company id here would be wrong, not merely
    // unnecessary.

    func accountDeletionPreview() async throws -> AccountDeletionPreview {
        try await api.get("/v1/account/deletion-preview")
    }

    func deleteAccount() async throws -> AccountDeletionResult {
        try await api.deleteReturning("/v1/account")
    }

    func invites(_ companyId: String) async throws -> Page<Invite> {
        try await api.get("/v1/invites", companyId: companyId)
    }

    func createInvite(
        _ companyId: String,
        email: String,
        role: String,
        /// #521: why this person is being added, in the inviter's own words, or
        /// nil for the invite this route has always sent. Never the empty
        /// string: the server normalises blank to null, so `""` would be a
        /// longer way of saying nothing.
        note: String? = nil
    ) async throws -> Invite {
        var body: [String: JSONValue] = [
            "email": .string(email),
            "role": .string(role),
        ]
        // Written only when there is one, so an invite sent without a note
        // carries exactly the body it always did.
        if let note { body["note"] = .string(note) }
        return try await api.post(
            "/v1/invites",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    func revokeInvite(_ companyId: String, inviteId: String) async throws {
        try await api.delete("/v1/invites/\(inviteId)", companyId: companyId)
    }

    // MARK: - Numbers

    func numbers(_ companyId: String) async throws -> Page<PhoneNumberSummary> {
        try await api.get("/v1/numbers", companyId: companyId)
    }

    func availableNumbers(
        country: String,
        areaCode: String? = nil,
        bestEffort: Bool = false,
        /// #513: digits the number must contain, honoured by the SEARCH.
        ///
        /// The picker used to narrow only the batch it already held, so asking
        /// for a fresh one silently discarded what had been typed. Telnyx does
        /// honour `filter[phone_number][contains]` — a comment in the web
        /// client claimed otherwise for months and it was wrong.
        contains: String? = nil,
        limit: Int = 50
    ) async throws -> AvailableNumbersResult {
        try await api.get(
            "/v1/available-numbers",
            query: [
                "country": country,
                "area_code": areaCode,
                "best_effort": bestEffort ? "true" : nil,
                "contains": contains,
                "limit": String(limit),
            ],
            // Company-exempt route (the onboarding number step runs pre-company).
            companyId: nil
        )
    }

    /// POST /v1/numbers/provision — Idempotency-Key REQUIRED (per intent).
    func provisionNumber(
        _ companyId: String,
        idempotencyKey: String,
        chosenNumberE164: String? = nil,
        requestedAreaCode: String? = nil
    ) async throws -> PhoneNumberSummary {
        try await api.post(
            "/v1/numbers/provision",
            body: numberChoiceBody(chosenNumberE164: chosenNumberE164, requestedAreaCode: requestedAreaCode),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// POST /v1/numbers/:id/remediate — re-arm a failed row, no new charge.
    func remediateNumber(
        _ companyId: String,
        numberId: String,
        chosenNumberE164: String? = nil,
        requestedAreaCode: String? = nil
    ) async throws -> PhoneNumberSummary {
        try await api.post(
            "/v1/numbers/\(numberId)/remediate",
            body: numberChoiceBody(chosenNumberE164: chosenNumberE164, requestedAreaCode: requestedAreaCode),
            companyId: companyId
        )
    }

    private func numberChoiceBody(chosenNumberE164: String?, requestedAreaCode: String?) -> JSONValue {
        if let chosenNumberE164 {
            return .object(["chosen_number_e164": .string(chosenNumberE164)])
        }
        return .object(["requested_area_code": .string(requestedAreaCode ?? "")])
    }

    /// DELETE /v1/numbers/:id — owner-only; returns the released row.
    /// `code` is the #537 confirmation. Sent only on a retry: the first attempt is
    /// what tells us which of the two proofs the server wants.
    func releaseNumber(
        _ companyId: String,
        numberId: String,
        code: String? = nil
    ) async throws -> PhoneNumberSummary {
        var body: Data?
        if let code {
            body = try JSONEncoder().encode(
                JSONValue.object(["confirmation_code": .string(code)])
            )
        }
        let data = try await api.raw(
            "DELETE",
            "/v1/numbers/\(numberId)",
            body: body,
            companyId: companyId
        )
        return try JSONDecoder().decode(PhoneNumberSummary.self, from: data)
    }

    func numberAccess(_ companyId: String, numberId: String) async throws -> NumberAccess {
        try await api.get("/v1/numbers/\(numberId)/access", companyId: companyId)
    }

    func setNumberAccess(
        _ companyId: String,
        numberId: String,
        body: JSONValue
    ) async throws -> NumberAccess {
        try await api.put("/v1/numbers/\(numberId)/access", body: body, companyId: companyId)
    }

    /// #307: this line's identity, resolved with what each field inherits.
    func numberIdentity(_ companyId: String, numberId: String) async throws -> NumberIdentity {
        try await api.get("/v1/numbers/\(numberId)/identity", companyId: companyId)
    }

    // MARK: - #309 recorded voicemail greetings

    /// What this workspace has recorded.
    func voicemailGreetings(_ companyId: String) async throws -> [VoicemailGreeting] {
        let page: Page<VoicemailGreeting> = try await api.get(
            "/v1/voicemail-greetings",
            companyId: companyId
        )
        return page.data
    }

    /// #309's record-by-phone path: WE ring the owner, they speak after the
    /// beep and hang up.
    ///
    /// Nothing exists when this returns. The greeting is written only once the
    /// recording lands, so the card polls the list rather than trusting a
    /// response — a call the owner never answers correctly produces nothing.
    @discardableResult
    func greetingCaptureCall(
        _ companyId: String,
        name: String,
        to: String
    ) async throws -> JSONValue {
        try await api.post(
            "/v1/voicemail-greetings/capture-call",
            body: JSONValue.object(["name": .string(name), "to": .string(to)]),
            companyId: companyId
        )
    }

    /// Delete one. Every line using it goes back to the written words.
    func deleteGreeting(_ companyId: String, id: String) async throws {
        try await api.delete("/v1/voicemail-greetings/\(id)", companyId: companyId)
    }

    /// #307: set or CLEAR this line's overrides.
    ///
    /// A field carrying `.null` means INHERIT, so the body must SEND null
    /// rather than omit the key — omitting it leaves the override in place,
    /// which is the opposite of what "use the workspace's" means.
    func setNumberIdentity(
        _ companyId: String,
        numberId: String,
        body: JSONValue
    ) async throws -> NumberIdentity {
        try await api.patch("/v1/numbers/\(numberId)/identity", body: body, companyId: companyId)
    }

    // MARK: - Port-in

    func ports(_ companyId: String) async throws -> Page<PortRequest> {
        try await api.get("/v1/port-requests", companyId: companyId)
    }

    func checkPortability(_ companyId: String, phoneE164: String) async throws -> PortabilityCheck {
        try await api.post(
            "/v1/port-requests/check",
            body: JSONValue.object(["phone_e164": .string(phoneE164)]),
            companyId: companyId
        )
    }

    /// POST /v1/port-requests — Idempotency-Key REQUIRED (per intent).
    func createPort(
        _ companyId: String,
        idempotencyKey: String,
        body: JSONValue
    ) async throws -> PortRequest {
        try await api.post(
            "/v1/port-requests",
            body: body,
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// PUT /v1/port-requests/:id — fix-and-resubmit edits (draft/exception).
    func updatePort(_ companyId: String, portId: String, body: JSONValue) async throws -> PortRequest {
        try await api.put("/v1/port-requests/\(portId)", body: body, companyId: companyId)
    }

    func uploadPortDocuments(
        _ companyId: String,
        portId: String,
        parts: [DocumentUpload]
    ) async throws -> PortRequest {
        let data = try await multipartPut(
            path: "/v1/port-requests/\(portId)/documents",
            companyId: companyId,
            parts: parts
        )
        return try JSONDecoder().decode(PortRequest.self, from: data)
    }

    func submitPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/submit", companyId: companyId)
    }

    func resubmitPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/resubmit", companyId: companyId)
    }

    /// Owner-only.
    func cancelPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/cancel", companyId: companyId)
    }

    // MARK: - Text-enablement

    func textEnablements(_ companyId: String) async throws -> Page<TextEnablementOrder> {
        try await api.get("/v1/text-enablements", companyId: companyId)
    }

    /// POST /v1/text-enablements — Idempotency-Key REQUIRED (per intent).
    func createTextEnablement(
        _ companyId: String,
        idempotencyKey: String,
        phoneE164: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements",
            body: JSONValue.object(["phone_e164": .string(phoneE164)]),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    func uploadTextEnablementDocuments(
        _ companyId: String,
        orderId: String,
        parts: [DocumentUpload]
    ) async throws -> TextEnablementOrder {
        let data = try await multipartPut(
            path: "/v1/text-enablements/\(orderId)/documents",
            companyId: companyId,
            parts: parts
        )
        return try JSONDecoder().decode(TextEnablementOrder.self, from: data)
    }

    func resubmitTextEnablement(_ companyId: String, orderId: String) async throws -> TextEnablementOrder {
        try await api.post("/v1/text-enablements/\(orderId)/resubmit", companyId: companyId)
    }

    func requestVerificationCode(
        _ companyId: String,
        orderId: String,
        method: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements/\(orderId)/verification-codes",
            body: JSONValue.object(["verification_method": .string(method)]),
            companyId: companyId
        )
    }

    func submitVerificationCode(
        _ companyId: String,
        orderId: String,
        code: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements/\(orderId)/verification-codes/verify",
            body: JSONValue.object(["code": .string(code)]),
            companyId: companyId
        )
    }

    /// Owner-only.
    func cancelTextEnablement(_ companyId: String, orderId: String) async throws -> TextEnablementOrder {
        try await api.post("/v1/text-enablements/\(orderId)/cancel", companyId: companyId)
    }

    // MARK: - 10DLC registration

    func registration(_ companyId: String) async throws -> RegistrationDetailPair {
        try await api.get("/v1/registration", companyId: companyId)
    }

    /// First-submission recovery and rejected-resubmit.
    func submitRegistration(_ companyId: String) async throws -> RegistrationDetailPair {
        try await api.post("/v1/registration/submit", companyId: companyId)
    }

    /// Save wizard drafts. Each part must be a COMPLETE draft — the server
    /// validates the whole object, so send every field, not just edits.
    func saveRegistrationDraft(
        _ companyId: String,
        body: JSONValue
    ) async throws -> RegistrationDetailPair {
        try await api.put("/v1/registration", body: body, companyId: companyId)
    }

    /// Owner-only: a Canadian company turning US texting on. The one-time fee
    /// is `usRegistrationFeeCents` in the workspace's own currency — CA$39 for
    /// every caller of this route that has not been grandfathered onto USD.
    func enableUsTexting(_ companyId: String) async throws -> EnableUsResult {
        try await api.post("/v1/registration/enable-us", companyId: companyId)
    }

    /// Sole-proprietor SMS OTP verification.
    func verifyRegistrationOtp(_ companyId: String, code: String) async throws -> RegistrationDetailPair {
        try await api.post(
            "/v1/registration/otp",
            body: JSONValue.object(["code": .string(code)]),
            companyId: companyId
        )
    }

    func resendRegistrationOtp(_ companyId: String) async throws {
        let _: JSONValue = try await api.post("/v1/registration/otp/resend", companyId: companyId)
    }

    // MARK: - Billing

    func modules(_ companyId: String) async throws -> BillingModules {
        try await api.get("/v1/billing/modules", companyId: companyId)
    }

    func setModule(_ companyId: String, module: String, enabled: Bool) async throws {
        let _: JSONValue = try await api.post(
            "/v1/billing/modules",
            body: JSONValue.object(["module": .string(module), "enabled": .bool(enabled)]),
            companyId: companyId
        )
    }

    /// #583 — is a prepaid year running, and what would ending it pay back?
    ///
    /// Read only where it changes a decision: the change-plan confirmation. It costs
    /// a Stripe round trip server-side, so it is never part of loading Settings.
    func prepayOffer(_ companyId: String) async throws -> PrepayOffer {
        try await api.get("/v1/billing/prepay", companyId: companyId)
    }

    /// - Parameter convertPrepaid: #583 — "yes, end my prepaid year and credit me
    ///   the rest". Sent only when a year is running AND somebody ticked the box.
    ///   The server refuses the switch without it by design, because a prepaid year
    ///   is only ever ended by a person who read the amount coming back; a client
    ///   that set this unconditionally would assert consent nobody was asked for.
    func changePlan(
        _ companyId: String,
        plan: String,
        convertPrepaid: Bool = false
    ) async throws -> ChangePlanResult {
        var body: [String: JSONValue] = ["plan": .string(plan)]
        if convertPrepaid { body["convert_prepaid"] = .bool(true) }
        return try await api.post(
            "/v1/billing/change-plan",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    // MARK: - Numbers the plan does not cover (#523)

    /// What this workspace holds beyond its allowance, and both ways back.
    ///
    /// A ROUTE OF ITS OWN rather than fields on the company view, and the API
    /// says why in full: `GET /v1/company` and `GET /v1/me` run on every app
    /// boot for every role, and this answers a question only a workspace with a
    /// held number ever asks. Same trade as `missedWhileOff` above.
    ///
    /// Behind the router's `billing.manage` gate like everything else in this
    /// section, so it is only ever asked by somebody who can act on the answer —
    /// asking on a tech's behalf would 403 on every visit to the billing screen.
    func heldNumbers(_ companyId: String) async throws -> HeldNumbers {
        try await api.get("/v1/billing/held-numbers", companyId: companyId)
    }

    /// Buy the capacity for ONE held number and bring it back.
    ///
    /// ONE AT A TIME, because each one is its own purchase and its own consent.
    /// The server raises the extra-number quantity by exactly one and invoices
    /// the prorated amount now.
    ///
    /// THE KEY IS REQUIRED — the route refuses a request without a UUID
    /// `Idempotency-Key`, and it is what makes a retry after a lost response
    /// safe: the Stripe write is keyed on it, so the same key can never charge
    /// twice. Callers must mint one per INTENT and reuse it across retries of
    /// that intent, the way the number picker does.
    func reinstateHeldNumber(
        _ companyId: String,
        numberId: String,
        idempotencyKey: String
    ) async throws -> ReinstatedNumber {
        try await api.post(
            "/v1/billing/held-numbers/\(numberId)/reinstate",
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// #277: why this workspace says it is leaving, recorded BEFORE the
    /// handoff to Stripe. Afterwards they are gone, and nobody answers a
    /// survey about a product they have just left.
    ///
    /// Both halves are optional and an empty body is a valid record that the
    /// question was skipped, so this never refuses to send. Callers must not
    /// wait on it: a dead endpoint of ours cannot be allowed to stop somebody
    /// cancelling.
    ///
    /// 204 No Content, so nothing is decoded. A typed `post` here would throw
    /// on the empty body of a SUCCESSFUL call.
    func recordCancellationReason(
        _ companyId: String,
        reason: String?,
        detail: String
    ) async throws {
        let body = try JSONEncoder().encode(
            cancellationReasonBody(reason: reason, detail: detail)
        )
        _ = try await api.raw(
            "POST",
            "/v1/billing/cancellation-reason",
            body: body,
            companyId: companyId
        )
    }

    /// #277 follow-up: what this workspace told us on the way out, read back.
    ///
    /// A ROUTE OF ITS OWN rather than a field on the company view, for the
    /// reason `missed-while-off` beside it already uses: `GET /v1/company` runs
    /// on every app boot for every role, and this answer can only ever be
    /// non-null for a workspace that has already cancelled. Putting it there
    /// would have every paying workspace run a query for a card it can never
    /// see.
    ///
    /// The free text is deliberately NOT on the wire. `detail` is what somebody
    /// wrote about us in their own words, and reading it back to them on a
    /// win-back card would be quoting them at themselves. The code is all the
    /// card needs to pick an answer.
    func cancellationReason(_ companyId: String) async throws -> StatedCancellationReason {
        try await api.get("/v1/billing/cancellation-reason", companyId: companyId)
    }

    /// #277 follow-up: "stop showing me this."
    ///
    /// 204 No Content, so nothing is decoded — a typed `post` would throw on
    /// the empty body of a SUCCESSFUL call. The server stamps a timestamp
    /// compared against `canceled_at` rather than a flag, so the dismissal
    /// belongs to this one cancellation and nothing has to clear it later.
    func dismissWinback(_ companyId: String) async throws {
        _ = try await api.raw("POST", "/v1/billing/dismiss-winback", companyId: companyId)
    }

    /// #227's CSV of the whole customer list, for the cancel screen.
    ///
    /// Here as well as on the contacts repository, for the same reason
    /// `contactFields` is: this screen holds the settings repository and
    /// nothing else, and a call reached for through the wrong one compiles on
    /// Android and fails only in CI here. No `q`, because somebody leaving
    /// wants all of it rather than whatever a search box was filtered to.
    func contactsCsvExport(_ companyId: String) async throws -> String {
        let data = try await api.raw("GET", "/v1/contacts/export", companyId: companyId)
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - The paid pause (#277)

    /// May this workspace pause, what would it cost, and is it paused already?
    ///
    /// ONE request answers all three because the billing screen needs all three,
    /// and because the price has to be on the screen before anybody presses
    /// anything. Behind the router's `billing.manage` gate like every other call
    /// in this section, so it is only ever asked by somebody who can act on it.
    ///
    /// It round-trips to Stripe, which is why the screen reads it once and hands
    /// the answer to both surfaces rather than letting each fetch its own.
    func pauseOffer(_ companyId: String) async throws -> BillingPause {
        try await api.get("/v1/billing/pause", companyId: companyId)
    }

    /// Hold the number, stop the texting.
    ///
    /// THE RESPONSE IS A RE-READ, not an echo. The route swaps the licensed
    /// price at Stripe, re-reads its own mirror, and answers 409 when the two
    /// disagree — so "the call returned" and "the workspace is paused" are the
    /// same statement here, and callers must render what came back rather than
    /// what they asked for. A 409 carries a sentence written for the customer;
    /// show it as it arrives.
    func pausePlan(_ companyId: String) async throws -> BillingPaused {
        try await api.post("/v1/billing/pause", companyId: companyId)
    }

    /// Come back in the spring. Same swap in reverse, same re-read, same rule.
    func resumePlan(_ companyId: String) async throws -> BillingResumed {
        try await api.post("/v1/billing/resume", companyId: companyId)
    }

    /// Hosted Stripe Billing Portal URL — open in an EXTERNAL browser.
    func billingPortal(_ companyId: String) async throws -> HostedUrl {
        try await api.post("/v1/billing/portal", companyId: companyId)
    }

    /// Hosted Stripe Checkout URL (resubscribe) — EXTERNAL browser only.
    func checkout(_ companyId: String, plan: String) async throws -> HostedUrl {
        try await api.post(
            "/v1/billing/checkout",
            body: JSONValue.object(["plan": .string(plan)]),
            companyId: companyId
        )
    }

    // MARK: - Token access (GoTrue account ops + multipart)

    /// A non-expired Supabase access token. When the stored token is stale,
    /// this routes through `ApiClient`'s single-flight refresh (via a cheap
    /// company-exempt read) instead of refreshing here — two refreshers racing
    /// would burn the rotated refresh token and kill the session.
    ///
    /// `locale` is the READER's, carried in and defaulted to nil — the English
    /// table — the way `SettingsRepository.kt` carries its own. This is not a
    /// View, and the one sentence below is ours rather than the server's:
    /// everything the API refuses with arrives already phrased for a person and
    /// is shown as written.
    func freshAccessToken(locale: String? = nil) async throws -> String {
        if let session = sessionStore.current(), !session.isExpired {
            return session.accessToken
        }
        let _: Me = try await api.get("/v1/me")
        guard let session = sessionStore.current() else {
            throw ApiError(
                code: ApiErrorCode.unauthorized,
                message: AppStrings.translate(locale, "settingsMore.signedOut"),
                httpStatus: 401
            )
        }
        return session.accessToken
    }

    // MARK: - Multipart

    /// Multipart PUT for the document-upload routes. `ApiClient.raw` only
    /// carries JSON bodies (it stamps Content-Type: application/json), so this
    /// builds its own URLRequest with the same bearer and decodes failures
    /// through the same SPEC §7 envelope.
    private func multipartPut(
        path: String,
        companyId: String,
        parts: [DocumentUpload],
        /// The READER's language, carried in from the view that started the
        /// upload. Defaulted to nil for the reason `freshAccessToken` gives.
        locale: String? = nil
    ) async throws -> Data {
        let token = try await freshAccessToken(locale: locale)
        let boundary = "loonext-\(UUID().uuidString)"
        var body = Data()
        for part in parts {
            let safeName = part.fileName
                .replacingOccurrences(of: "\"", with: "")
                .replacingOccurrences(of: "\r", with: "")
                .replacingOccurrences(of: "\n", with: "")
            body.append(Data("--\(boundary)\r\n".utf8))
            body.append(Data(
                "Content-Disposition: form-data; name=\"\(part.fieldName)\"; filename=\"\(safeName)\"\r\n".utf8
            ))
            body.append(Data("Content-Type: \(part.mimeType)\r\n\r\n".utf8))
            body.append(part.bytes)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(companyId, forHTTPHeaderField: "X-Company-Id")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: AppStrings.translate(locale, "settingsMore.cantReachLoonext"),
                httpStatus: 0
            )
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw ApiError(
                code: parsed?.error.code ?? ApiErrorCode.internalError,
                message: parsed?.error.message
                    ?? AppStrings.translate(
                        locale,
                        "settingsMore.somethingWentWrongStatus",
                        ["status": String(status)]
                    ),
                httpStatus: status
            )
        }
        return data
    }
}

/// GET /v1/billing/cancellation-reason (#277 follow-up).
///
/// `reason: nil` with a non-nil `stated_at` is a REAL answer and not the same
/// as no row: it means somebody opened the cancel screen and skipped the
/// question, which is allowed on purpose. Both render nothing, but only one of
/// them is a person declining to say.
struct StatedCancellationReason: Codable, Sendable {
    let reason: String?
    let stated_at: String?
}
