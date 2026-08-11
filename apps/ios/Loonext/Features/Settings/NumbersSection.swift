import SwiftUI

/// Everything the numbers screen shows, loaded together.
private struct NumbersData {
    let numbers: [PhoneNumberSummary]
    /// #286: how many numbers this member cannot see.
    let hiddenNumbers: Int
    let ports: [PortRequest]
    let textEnablements: [TextEnablementOrder]
    let registration: RegistrationDetailPair
}

/// Numbers (#163): per-number cards with honest status states, the #106
/// access sheet, owner-only typed-confirmation release, the add-a-number
/// picker, port-in tracker cards, text-enablement cards, and the 10DLC
/// registration stepper. Realtime `number.updated` / `registration.updated` /
/// `port.updated` events refetch (payloads are ID-only by design).
@MainActor
struct NumbersSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    @State private var state: LoadState<NumbersData> = .loading
    @State private var refreshKey = 0

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
                    .frame(height: 200)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(height: 200)
            case .ready(let data):
                let refresh: @MainActor () -> Void = {
                    refreshKey += 1
                    onRefreshCompany()
                }
                // Ported/hosted rows in flight render ONLY through their tracker
                // cards below — never as a fake "under a minute" number card.
                //
                // #523 ADDED THE SUSPENDED ARM, and it is not a corner case. A
                // ported line that goes on hold is `source == "ported"` and no
                // longer `active`, so it matched neither arm and rendered
                // nowhere at all: no card, no pill, no hold note, and the port
                // tracker below only speaks about a transfer still in flight.
                // The restore is oldest-first, so the number a workspace ported
                // in most recently is exactly the one left held — the likely
                // case, not the exotic one. A row that is suspended was live
                // once, so it is never an in-flight port and the reason for the
                // original filter does not reach it.
                let cards = data.numbers.filter { number in
                    number.source == "provisioned"
                        || number.status == NumberStatus.active
                        || number.status == NumberStatus.suspended
                }
                if cards.isEmpty && company.plan == nil {
                    SettingsCard(
                        title: AppStrings.translate(appLocale, "settingsMore.yourNumber")
                    ) {
                        Text(AppStrings.translate(appLocale, "settingsMore.noNumberYet"))
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(cards, id: \.id) { number in
                    NumberCard(scope: scope, company: company, number: number, onChanged: refresh)
                }
                // #286: what this member cannot reach, and WHY. Below the
                // cards, because it explains the shape of the list rather
                // than competing with it — the primary view stays about the
                // numbers they can actually use.
                //
                // It replaces the bare count that used to sit here. "Ask an
                // owner if you need them" was the cost #286 is about: a tech
                // who cannot tell a deliberate restriction from a broken app
                // resolves it by interrupting somebody, and the owner then has
                // to work out which of three rules they set months ago
                // produced it.
                MyAccessCard(scope: scope)
                AddNumberCard(scope: scope, company: company, numbers: data.numbers, onChanged: refresh)
                // The numbers go down with the ports on purpose (#523): a
                // finished transfer's tracker sits directly under that line's
                // own card, and until it could read the numbers list the two
                // disagreed about whether the line worked.
                PortsBlock(
                    scope: scope,
                    company: company,
                    ports: data.ports,
                    numbers: data.numbers,
                    onChanged: refresh
                )
                TextEnableBlock(scope: scope, company: company, orders: data.textEnablements, onChanged: refresh)
                RegistrationBlock(scope: scope, company: company, registration: data.registration, onChanged: refresh)
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                let numbersPage = try await scope.repo.numbers(scope.companyId)
                state = .ready(
                    NumbersData(
                        numbers: numbersPage.data,
                        hiddenNumbers: numbersPage.hidden_count ?? 0,
                        ports: try await scope.repo.ports(scope.companyId).data,
                        textEnablements: try await scope.repo.textEnablements(scope.companyId).data,
                        registration: try await scope.repo.registration(scope.companyId)
                    )
                )
            } catch {
                if case .ready = state {
                    scope.showMessage(error.userMessage)
                } else {
                    state = .failed(error.userMessage)
                }
            }
        }
        .task(id: scope.companyId) {
            for await event in await scope.graph.realtime.events()
                where event.event == "number.updated"
                || event.event == "registration.updated"
                || event.event == "port.updated" {
                refreshKey += 1
            }
        }
        // #215: a socket re-JOIN (missed provisioning/registration/port frames
        // while offline) refetches; Part A does the same on foreground return.
        .task(id: scope.companyId) {
            for await _ in await scope.graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
    }
}

// MARK: - Per-number card

private struct NumberCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let number: PhoneNumberSummary
    let onChanged: @MainActor () -> Void

    @State private var releasing = false
    @State private var managingAccess = false
    @State private var managingIdentity = false
    @State private var managingHours = false
    @State private var choosing = false

    @Environment(\.appLocale) private var appLocale

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canRelease: Bool { SettingsRoleGate.canReleaseNumber(scope.role) }
    private var released: Bool { number.status == NumberStatus.released }

    /// #523 — which rows carry the action row at all.
    ///
    /// A LINE ON HOLD IS STILL THIS WORKSPACE'S LINE, and it used to be
    /// excluded here. That made Release unreachable from this app for the one
    /// row it matters most for: giving a held number up is the only way to stop
    /// us renting it from the carrier for a workspace that has decided not to
    /// pay for it, and the only way to clear the Pro-to-Starter checklist,
    /// which counts every row that is not released — held ones included. An
    /// owner with a phone and no laptop could do neither.
    ///
    /// The three settings entries come with it rather than Release alone.
    /// A held number still receives, so how the line answers, when it is open
    /// and who may use it all still describe something that is happening — and
    /// a workspace about to buy the number back should be able to set it up
    /// before it comes back rather than after.
    ///
    /// Still excluded: `released` (there is nothing to configure or give up),
    /// and `provisioning` / `provision_failed`, which have no line yet —
    /// `statusBody` offers "Choose a number" there instead.
    ///
    /// IT NO LONGER DECIDES RELEASE. Every control here is reversible — a
    /// greeting, a schedule, an access list — and one is not, so the
    /// irreversible one answers to `releasable` instead. Widening this
    /// condition can no longer widen who is offered "give it up for good".
    private var manageable: Bool {
        !released
            && (number.status == NumberStatus.active
                || number.status == NumberStatus.suspended)
    }

    /// #523 — may this row be given up, by the one rule all three clients share?
    ///
    /// The reasoning lives on `mayReleaseNumber`, next to the copy it decides.
    /// The short version is that iOS was the only client offering "give it up
    /// for good" to a workspace whose real problem is a declined card, and the
    /// only client with no subscription check on the control at all.
    private var releasable: Bool {
        mayReleaseNumber(
            status: number.status,
            numberE164: number.number_e164,
            subscriptionActive: company.subscriptionActive
        )
    }

    /// #523 — the hold this card may be about, worked out ONCE.
    ///
    /// The confirmation sheet reads it too, and the one thing worse than no
    /// Release button on a held number is a Release button whose sheet describes
    /// a different situation. It is the allowance hold specifically — suspended
    /// while the subscription is live — which is the same split
    /// `mayReleaseNumber` makes, so a sheet that opens is always a sheet whose
    /// paragraph is true.
    private var heldOverAllowance: Bool {
        number.status == NumberStatus.suspended && company.subscriptionActive
    }

    private var display: String {
        if let e164 = number.number_e164 { return formatPhone(e164) }
        if let code = number.requested_area_code {
            return AppStrings.translate(
                appLocale, "settingsMore.areaCodeIs", ["areaCode": code]
            )
        }
        return AppStrings.translate(appLocale, "settingsMore.yourNumber")
    }

    var body: some View {
        SettingsCard(title: display) {
            HStack(spacing: 8) {
                statusPill
                if let source = number.source {
                    Text(sourceLabel(source))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let e164 = number.number_e164, !released {
                    Button {
                        copyToClipboard(e164)
                        scope.showMessage(
                            AppStrings.translate(appLocale, "settingsMore.numberCopied")
                        )
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "settingsMore.copyNumber")
                    )
                }
            }

            statusBody

            if manageable {
                HStack(spacing: 12) {
                    if canManage {
                        Button(
                            AppStrings.translate(
                                appLocale, "settingsMore.numberIdentityTitle"
                            )
                        ) { managingIdentity = true }
                        // #307: a SECOND entry rather than more rows in the
                        // first sheet — when the line is open is a different
                        // question, asked at a different time.
                        Button(
                            AppStrings.translate(appLocale, "settingsMore.numberHoursTitle")
                        ) { managingHours = true }
                        Button(
                            AppStrings.translate(appLocale, "settingsMore.whoCanUse")
                        ) { managingAccess = true }
                            .font(.subheadline)
                            .buttonStyle(.borderless)
                    }
                    if canRelease && releasable {
                        Button(
                            AppStrings.translate(appLocale, "settingsMore.release")
                        ) { releasing = true }
                            .font(.subheadline)
                            .foregroundStyle(BrandColor.destructive)
                            .buttonStyle(.borderless)
                    }
                }
                .padding(.top, 6)
                if !canManage {
                    ReadOnlyLine(
                        AppStrings.translate(
                            appLocale, "settingsMore.onlyAdminsManageNumbers"
                        )
                    )
                }
            }
        }
        .sheet(isPresented: $releasing) {
            // `releasable` rather than a bare digits check: the sheet is the
            // thing that performs the release, so it answers to the same rule
            // as the control that opens it. Nothing can present it while the
            // subscription is down, whichever way it was reached.
            if releasable {
                ReleaseNumberSheet(
                    scope: scope,
                    number: number,
                    heldOverAllowance: heldOverAllowance
                ) {
                    releasing = false
                    onChanged()
                } onDismiss: {
                    releasing = false
                }
            }
        }
        .sheet(isPresented: $managingAccess) {
            NumberAccessSheet(scope: scope, number: number) {
                managingAccess = false
            }
        }
        .sheet(isPresented: $managingIdentity) {
            NumberIdentitySheet(scope: scope, number: number) {
                managingIdentity = false
            }
        }
        .sheet(isPresented: $managingHours) {
            NumberHoursSheet(scope: scope, number: number) {
                managingHours = false
            }
        }
        .sheet(isPresented: $choosing) {
            RemediateNumberSheet(scope: scope, number: number) {
                choosing = false
                onChanged()
            } onDismiss: {
                choosing = false
            }
        }
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "ported": AppStrings.translate(appLocale, "settingsMore.sourcePorted")
        case "hosted": AppStrings.translate(appLocale, "settingsMore.sourceHosted")
        default: AppStrings.translate(appLocale, "settingsMore.sourceLoonext")
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        switch number.status {
        case NumberStatus.active:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.statusActive"),
                tone: .positive
            )
        case NumberStatus.provisioning:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.statusSettingUp"),
                tone: .warn
            )
        case NumberStatus.suspended:
            // "On hold", not the database's word for it. #523's mail, push and
            // billing card all say a number is on hold; a pill that said
            // "Suspended" would be a fourth name for one state, on the screen
            // somebody opens straight after reading the other three.
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.portOnHold"),
                tone: .warn
            )
        case NumberStatus.released:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.statusReleased"),
                tone: .neutral
            )
        case NumberStatus.provisionFailed:
            if !needsNumberChoice(number) {
                StatusPill(
                    label: AppStrings.translate(appLocale, "settingsMore.statusSettingUp"),
                    tone: .warn
                )
            } else if number.failure_reason == "timeout" {
                StatusPill(
                    label: AppStrings.translate(
                        appLocale, "settingsMore.statusActionNeeded"
                    ),
                    tone: .warn
                )
            } else {
                StatusPill(
                    label: AppStrings.translate(appLocale, "settingsMore.statusFailed"),
                    tone: .bad
                )
            }
        default:
            StatusPill(label: number.status, tone: .neutral)
        }
    }

    @ViewBuilder
    private var statusBody: some View {
        if released {
            Text(number.number_e164.map(formatPhone) ?? "")
                .font(.callout)
                .strikethrough()
                .foregroundStyle(.secondary)
            if let at = number.released_at {
                Text(
                    AppStrings.translate(
                        appLocale,
                        "settingsMore.releasedAgo",
                        ["ago": relativeTime(at)]
                    )
                )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else if number.status == NumberStatus.active, let health = number.health {
            // #235: a carrier is filtering this line. Only the confident
            // 'degraded' state ever reaches a client — the server flattens the
            // internal 'watch' to healthy, because a maybe-degraded warning on
            // a thin sample is how a false alarm becomes a cancellation.
            Text(AppStrings.translate(appLocale, "settingsMore.numberUnreliable"))
                .font(.callout)
            Text(numberHealthCopy(health))
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if number.status == NumberStatus.suspended {
            // #523: this line used to name ONE of the two reasons a number is
            // suspended — "update your payment method" — and since a resubscribe
            // onto a smaller plan started holding the surplus, it is the less
            // likely one. The workspace reading it is paid up. See
            // `suspendedNumberLine` for why it does not guess the other one
            // either.
            //
            // ABOVE THE RING-CEILING ARM, which it used to sit under. This
            // chain is exclusive — whichever arm matches first is the only
            // thing the card says about the row's state — and "nobody is rung
            // on every call" in place of "this line is on hold" answers a
            // question nobody asked while dropping the one fact that matters.
            // Nothing renders differently today: `GET /v1/numbers` resolves
            // `ring_targets` only for rows whose status is `active`
            // (apps/api/src/routes/numbers.ts), so the ceiling is nil for a
            // held row. The order is here so this card does not depend on that
            // staying true.
            Text(suspendedNumberLine(canManageBilling: SettingsRoleGate.canManageBilling(scope.role)))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        } else if let ceiling = ringCeilingLine(number) {
            // #366: a crew bigger than one call can ring. Shown to EVERY
            // member, not only owners, because the person who most needs it is
            // the tech wondering why their phone rings less than a
            // colleague's — and with the fan-out now rotating per call, the
            // honest thing to say is about the workspace rather than them.
            Text(ceiling)
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if number.status == NumberStatus.provisioning {
            Text(provisioningWaitCopy(number.created_at))
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if number.status == NumberStatus.provisionFailed {
            Text(failedNumberCopy(number))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if canManage && needsNumberChoice(number) {
                Button(AppStrings.translate(appLocale, "settingsMore.chooseNumber")) {
                    choosing = true
                }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            }
        }
    }
}

// MARK: - Release (owner-only, type-the-number confirmation)

private struct ReleaseNumberSheet: View {
    let scope: SettingsScope
    let number: PhoneNumberSummary
    /// #523 — this row is held because the plan covers fewer numbers than the
    /// workspace has, decided by the card that opened this sheet. Handed down
    /// rather than re-derived from `status`, which cannot tell that hold from a
    /// past-due suspension and would put the wrong paragraph in front of
    /// somebody whose card was declined.
    let heldOverAllowance: Bool
    let onReleased: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var typed = ""
    @State private var pending = false
    @State private var error: String?
    // #537 audit: permanent, and whoever holds this number next receives the texts
    // this business's customers send it. Typing the number guards against a slip; it
    // is no guard at all against somebody who is not the owner.
    @State private var proof: HandoverProof?
    @State private var codeRejected = false

    @Environment(\.appLocale) private var appLocale

    private var display: String { formatPhone(number.number_e164) }

    private var matches: Bool {
        let expected = (number.number_e164 ?? "").filter(\.isNumber)
        let typedDigits = typed.filter(\.isNumber)
        return !expected.isEmpty && (typedDigits == expected || "1\(typedDigits)" == expected)
    }

    var body: some View {
        ConfirmSheet(
            title: AppStrings.translate(
                appLocale, "settingsMore.releaseTitle", ["number": display]
            ),
            // #523: the ordinary sentence promises a free replacement, which is
            // false for a row on hold — see `releaseNumberMessage`. The sheet
            // asks which row this is rather than carrying one paragraph for two
            // different decisions.
            message: releaseNumberMessage(heldOverAllowance: heldOverAllowance),
            confirmLabel: AppStrings.translate(appLocale, "settingsMore.releaseConfirm"),
            destructive: true,
            pending: pending,
            error: error,
            confirmEnabled: matches,
            dismissLabel: AppStrings.translate(appLocale, "settingsMore.keepNumber"),
            onConfirm: { attempt(nil) },
            onDismiss: { onDismiss() }
        ) {
            TextField(
                AppStrings.translate(
                    appLocale, "settingsMore.typeToConfirm", ["number": display]
                ),
                text: $typed
            )
                .textFieldStyle(.roundedBorder)
                .keyboardType(.phonePad)
                .disabled(pending)
                .padding(.top, 10)
        }
        // #537 audit: the proof the server asks for before the number is gone for
        // good. A sheet over this one — presented from inside the presented view, so
        // it stacks rather than fighting it for the screen.
        .sheet(item: $proof) { pendingProof in
            HandoverProofSheet(
                kind: pendingProof.kind,
                pending: pending,
                rejected: codeRejected,
                onConfirm: { code in attempt(code) },
                onResend: { resendCode(pendingProof) },
                onDismiss: {
                    proof = nil
                    codeRejected = false
                }
            )
        }
    }

    /// One attempt. The number is closed over, so a retry releases the same one.
    private func attempt(_ code: String?) {
        pending = true
        error = nil
        let companyId = scope.companyId
        let repo = scope.repo
        let numberId = number.id
        let done = AppStrings.translate(
            appLocale, "settingsMore.numberReleased", ["number": display]
        )
        Task {
            // The kind is carried FORWARD from the demand we are answering, not left at
            // the default. This screen rebuilds its proof on every press — the other two
            // hand the held one back — and the funnel now reads the kind to decide who
            // checks the six digits. Rebuilt as `.email`, a stale-factor code goes to us
            // where nothing reads it: the sheet says "that code didn't work" to a correct
            // code, and only the NEXT press works, because by then the refusal has stored
            // the real kind. One wrong answer and one wasted round trip that puts a live
            // single-use code in one of our own request bodies.
            let request = HandoverProof(
                action: "release_number", label: done, kind: proof?.kind ?? .email
            ) { digits in
                _ = try await repo.releaseNumber(companyId, numberId: numberId, code: digits)
            }
            let outcome = await attemptHandover(
                scope: scope, proof: request, code: code, alreadyOpen: proof != nil
            )
            switch outcome {
            case .done:
                proof = nil
                codeRejected = false
                scope.showMessage(done)
                onReleased()

            case let .needsCode(kind, refused):
                codeRejected = refused
                proof = request.with(kind: kind)

            case let .failed(message):
                proof = nil
                error = message
            }
            pending = false
        }
    }

    private func resendCode(_ pendingProof: HandoverProof) {
        Task {
            try? await scope.repo.requestHandoverCode(
                scope.companyId, action: pendingProof.action
            )
            // Said either way. Whether an address exists is not ours to leak.
            scope.showMessage(AppStrings.translate(appLocale, "settingsMore.codeSent"))
        }
    }
}

// MARK: - #106 access sheet

private enum AccessMode: CaseIterable {
    case everyone
    case membersView
    case admins
    case users

    /// The catalogue key for this option's name.
    ///
    /// A KEY rather than the sentence, because an enum outside a view has no
    /// locale to read. It doubles as the stable `ForEach` id the list needs —
    /// which is what the English used to be, and would have started changing
    /// under the reader the moment it became translated.
    var labelKey: String {
        switch self {
        case .everyone: "settingsMore.accessEveryone"
        case .membersView: "settingsMore.accessMembersView"
        case .admins: "settingsMore.accessAdmins"
        case .users: "settingsMore.accessUsers"
        }
    }

    var detailKey: String {
        switch self {
        case .everyone: "settingsMore.accessEveryoneDetail"
        case .membersView: "settingsMore.accessMembersViewDetail"
        case .admins: "settingsMore.accessAdminsDetail"
        case .users: "settingsMore.accessUsersDetail"
        }
    }
}

private struct NumberAccessSheet: View {
    let scope: SettingsScope
    let number: PhoneNumberSummary
    let onDismiss: @MainActor () -> Void

    @State private var loaded: LoadState<[Member]> = .loading
    @State private var retryKey = 0
    @State private var mode: AccessMode = .everyone
    @State private var level = NumberAccessLevel.text
    @State private var pickedUserIds: Set<String> = []
    @State private var pending = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private var display: String {
        number.number_e164.map(formatPhone)
            ?? AppStrings.translate(appLocale, "settingsMore.thisNumber")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(AppStrings.translate(appLocale, "settingsMore.adminsAlwaysUse"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer().frame(height: 8)
                    switch loaded {
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    case .failed(let message):
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button(AppStrings.translate(appLocale, "common.retry")) {
                            retryKey += 1
                        }
                            .buttonStyle(.bordered)
                            .padding(.top, 8)
                    case .ready(let members):
                        modeOptions
                        if mode == .users {
                            Spacer().frame(height: 8)
                            userPicker(members)
                        }
                    }
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle(
                AppStrings.translate(
                    appLocale, "settingsMore.whoCanUseNumber", ["number": display]
                )
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                        .disabled(pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        AppStrings.translate(
                            appLocale,
                            pending ? "common.saving" : "common.save"
                        )
                    ) { save() }
                        .disabled(!isReady || pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        .task(id: "\(number.id)|\(retryKey)") {
            loaded = .loading
            do {
                let access = try await scope.repo.numberAccess(scope.companyId, numberId: number.id)
                let members = try await scope.repo.members(scope.companyId)
                    .data.filter { $0.deactivated_at == nil && $0.role == MemberRole.member }
                if access.access == NumberAccessKind.everyone {
                    mode = .everyone
                } else if access.access == NumberAccessKind.role && access.role == MemberRole.admin {
                    mode = .admins
                } else if access.access == NumberAccessKind.role {
                    mode = .membersView
                } else {
                    mode = .users
                }
                level = access.level ?? NumberAccessLevel.text
                pickedUserIds = Set(access.user_ids)
                loaded = .ready(members)
            } catch {
                loaded = .failed(error.userMessage)
            }
        }
    }

    private var isReady: Bool {
        if case .ready = loaded { return true }
        return false
    }

    private var modeOptions: some View {
        ForEach(AccessMode.allCases, id: \.labelKey) { option in
            Button {
                mode = option
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: mode == option ? "largecircle.fill.circle" : "circle")
                        .foregroundStyle(mode == option ? BrandColor.olive : Color.secondary)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(AppStrings.translate(appLocale, option.labelKey))
                            .font(.callout)
                            .foregroundStyle(Color.primary)
                        Text(AppStrings.translate(appLocale, option.detailKey))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
            .disabled(pending)
        }
    }

    @ViewBuilder
    private func userPicker(_ members: [Member]) -> some View {
        if members.isEmpty {
            Text(AppStrings.translate(appLocale, "settingsMore.noMembersToPick"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            ForEach(members, id: \.id) { member in
                let checked = pickedUserIds.contains(member.user_id)
                Button {
                    if checked {
                        pickedUserIds.remove(member.user_id)
                    } else {
                        pickedUserIds.insert(member.user_id)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: checked ? "checkmark.square.fill" : "square")
                            .foregroundStyle(checked ? BrandColor.olive : Color.secondary)
                        Text(
                            member.display_name.isBlank
                                ? AppStrings.translate(appLocale, "settingsMore.teammate")
                                : member.display_name
                        )
                            .font(.callout)
                            .foregroundStyle(Color.primary)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                .disabled(pending)
            }
            Spacer().frame(height: 6)
            ForEach([NumberAccessLevel.text, NumberAccessLevel.note], id: \.self) { value in
                Button {
                    level = value
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: level == value ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(level == value ? BrandColor.olive : Color.secondary)
                        Text(
                            AppStrings.translate(
                                appLocale,
                                value == NumberAccessLevel.text
                                    ? "settingsMore.levelText"
                                    : "settingsMore.levelNote"
                            )
                        )
                            .font(.callout)
                            .foregroundStyle(Color.primary)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
                .disabled(pending)
            }
        }
    }

    private func save() {
        guard case .ready(let members) = loaded else { return }
        // Stale/deactivated selections are silently dropped (web parity).
        let activeMemberIds = Set(members.map(\.user_id))
        let picked = Array(pickedUserIds.intersection(activeMemberIds))
        if mode == .users && picked.isEmpty {
            error = AppStrings.translate(appLocale, "settingsMore.pickAtLeastOne")
            return
        }
        pending = true
        error = nil
        let body = accessBody(mode: mode, level: level, pickedUserIds: picked)
        Task {
            do {
                _ = try await scope.repo.setNumberAccess(scope.companyId, numberId: number.id, body: body)
                scope.showMessage(
                    AppStrings.translate(
                        appLocale, "settingsMore.accessUpdated", ["number": display]
                    )
                )
                onDismiss()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

private func accessBody(mode: AccessMode, level: String, pickedUserIds: [String]) -> JSONValue {
    switch mode {
    case .everyone:
        return .object(["access": .string(NumberAccessKind.everyone)])
    case .membersView:
        return .object([
            "access": .string(NumberAccessKind.role),
            "role": .string(MemberRole.member),
            "level": .string(NumberAccessLevel.note),
        ])
    case .admins:
        // Admins always have full access; the level is moot — send 'text'.
        return .object([
            "access": .string(NumberAccessKind.role),
            "role": .string(MemberRole.admin),
            "level": .string(NumberAccessLevel.text),
        ])
    case .users:
        return .object([
            "access": .string(NumberAccessKind.users),
            "user_ids": .array(pickedUserIds.map { .string($0) }),
            "level": .string(level),
        ])
    }
}

// MARK: - Add a number (buy) + remediation

private struct AddNumberCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let numbers: [PhoneNumberSummary]
    let onChanged: @MainActor () -> Void

    @State private var picking = false
    @State private var idempotencyKey = ""
    @State private var pending = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    /// #522: three cases, and the third is the one that matters. With no
    /// recognised plan there is NO figure to name, and this card is a consent
    /// surface — so it states the shape of the charge rather than inventing an
    /// amount, which is the one thing a consent surface must never do. Mirrors
    /// the same three branches on Android.
    private func extraDescription(
        nextIsExtra: Bool,
        extraPrice: String?
    ) -> String {
        if !nextIsExtra {
            return AppStrings.translate(appLocale, "settingsMore.addNumberIncluded")
        }
        if let extraPrice {
            return AppStrings.translate(
                appLocale, "settingsMore.addNumberPriced", ["price": extraPrice]
            )
        }
        return AppStrings.translate(appLocale, "settingsMore.addNumberBilled")
    }

    var body: some View {
        if SettingsRoleGate.canManageNumbers(scope.role),
           company.subscriptionActive,
           // The currency is required rather than defaulted (#328), so this
           // call site has to say whose money it is even though it reads only
           // `facts.numbers`. That is the point of the requirement: the day
           // this card starts printing a price, it prints the right one.
           let facts = planFacts(company.plan, company.billedIn) {
            let liveCount = numbers.filter { $0.status != NumberStatus.released }.count
            let starterAtCap = company.plan == "starter" && liveCount >= 2
            let nextIsExtra = liveCount >= facts.numbers
            // #464: the rule here was `!(country == "US" && us_texting_enabled)`,
            // which is the bug that issue reported — `us_texting_enabled` is the
            // 10DLC gate and is never true for a Canadian workspace, so it
            // refused every Canadian customer forever and told them an extra
            // number "is a US number", which is not true. The API, the web app
            // and Android all moved to the shared rule; this client did not.
            let extraBlockedReason = extraNumberBlockedReason(
                country: company.country,
                usTextingEnabled: company.us_texting_enabled,
                billingCurrency: company.billing_currency
            )
            if !starterAtCap, nextIsExtra, let extraBlockedReason {
                SettingsCard(
                    title: AppStrings.translate(appLocale, "settingsMore.addNumber")
                ) {
                    ReadOnlyLine(
                        AppStrings.translate(
                            appLocale,
                            "settingsMore.planNumbersInUse",
                            ["reason": extraBlockedReason]
                        )
                    )
                }
            } else if !starterAtCap {
                // #522: this was `company.plan == "pro" ? "$4/mo" : "$5/mo"` —
                // two prices typed into the one card that asks for consent to
                // the charge, in a currency the workspace may not be billed in.
                // The extra-number book is USD-only, so a Canadian owner read
                // "$5" (which to them means CA$5) for a line their card takes
                // US$5 for.
                let extraPrice = extraNumberMonthly(
                    company.plan,
                    audience: company.billedIn
                )
                SettingsCard(
                    title: AppStrings.translate(appLocale, "settingsMore.addNumber"),
                    description: extraDescription(
                        nextIsExtra: nextIsExtra,
                        extraPrice: extraPrice
                    )
                ) {
                    Button(AppStrings.translate(appLocale, "settingsMore.chooseNumber")) {
                        // One key per attempt-intent: reused across retries of
                        // THIS sheet, regenerated the next time it opens.
                        idempotencyKey = UUID().uuidString
                        error = nil
                        picking = true
                    }
                    .buttonStyle(.bordered)
                }
                .sheet(isPresented: $picking) {
                    NumberPickerSheet(
                        scope: scope,
                        country: company.country,
                        initialAreaCode: company.requested_area_code.isEmpty ? nil : company.requested_area_code,
                        title: AppStrings.translate(appLocale, "settingsMore.chooseNumber"),
                        pending: pending,
                        error: error,
                        onDismiss: {
                            if !pending { picking = false }
                        },
                        onPick: { choice in provision(choice) }
                    )
                }
            }
        }
    }

    private func provision(_ choice: NumberChoice) {
        pending = true
        error = nil
        let key = idempotencyKey
        Task {
            do {
                switch choice {
                case .exact(let e164):
                    _ = try await scope.repo.provisionNumber(
                        scope.companyId,
                        idempotencyKey: key,
                        chosenNumberE164: e164
                    )
                case .areaCode(let code):
                    _ = try await scope.repo.provisionNumber(
                        scope.companyId,
                        idempotencyKey: key,
                        requestedAreaCode: code
                    )
                }
                picking = false
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.numberBeingSetUp")
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

private struct RemediateNumberSheet: View {
    let scope: SettingsScope
    let number: PhoneNumberSummary
    let onDone: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var pending = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        NumberPickerSheet(
            scope: scope,
            country: number.country,
            initialAreaCode: number.requested_area_code,
            title: AppStrings.translate(appLocale, "settingsMore.chooseNumberFinish"),
            pending: pending,
            error: error,
            onDismiss: {
                if !pending { onDismiss() }
            },
            onPick: { choice in remediate(choice) }
        )
    }

    private func remediate(_ choice: NumberChoice) {
        pending = true
        error = nil
        Task {
            do {
                switch choice {
                case .exact(let e164):
                    _ = try await scope.repo.remediateNumber(
                        scope.companyId,
                        numberId: number.id,
                        chosenNumberE164: e164
                    )
                case .areaCode(let code):
                    _ = try await scope.repo.remediateNumber(
                        scope.companyId,
                        numberId: number.id,
                        requestedAreaCode: code
                    )
                }
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.setupRestarted")
                )
                onDone()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

/// #235 — what a degraded number is told to its owner.
///
/// Ported 1:1 from web's `number-health-notice.tsx` and Android's
/// `numberHealthCopy`, because a crew with two devices must not read two
/// different accounts of the same problem.
///
/// It never says "spam" or "flagged": we know delivery fell, we do not know
/// which vendor labelled it or whether one did, and naming a cause we have not
/// established would be a guess dressed as a diagnosis. It also promises no
/// self-serve fix — remediation is registry paperwork that takes days.
func numberHealthCopy(_ health: NumberHealth) -> String {
    let opening: String
    if let rate = health.delivery_rate {
        opening = "About \(Int((rate * 100).rounded()))% of your recent texts were "
            + "delivered, which is below normal for this number."
    } else {
        opening = "Fewer of your texts are getting through than usual."
    }
    return opening
        + " Carriers sometimes start filtering a number — often one that was "
        + "reused from a previous business. We've been alerted and we're on it; "
        + "you don't need to do anything yet."
}

/**
 #286 — what this member cannot reach, and why.

 Hand-port of `apps/web/src/components/settings/my-access-card.tsx` and
 `NumbersSection.kt`'s card.

 Only the RESTRICTED rows: the numbers they can fully use are the cards above
 this one, and repeating them would make this a second copy of that list rather
 than an answer to the question the reader actually has.

 Renders nothing for anybody who reaches everything — every owner and admin,
 and most members. A panel reassuring somebody about a problem they do not have
 is furniture, and furniture is not read.
 */
private struct MyAccessCard: View {
    let scope: SettingsScope

    @State private var rows: [NumberAccessExplanation] = []

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if let note = numberAccessSelfNote(rows) {
            SettingsCard(
                title: AppStrings.translate(appLocale, "settingsMore.whatYouReach"),
                description: AppStrings.translate(
                    appLocale, "settingsMore.whatYouReachDesc"
                )
            ) {
                Text(note).font(.body)
                ForEach(rows.sortedForOwner().filter { $0.level != "text" }) { row in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 10) {
                            Text(
                                row.number_e164.map(formatPhone)
                                    ?? AppStrings.translate(
                                        appLocale, "settingsMore.aNumber"
                                    )
                            )
                                .font(.body)
                            Text(numberAccessLevelLabel(row.level))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Text(numberAccessReason(row.decided_by, row.principal, isSelf: true))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .task { await load() }
        } else {
            // Nothing to explain — but the read still has to happen once, or
            // the card could never appear for the member who does need it.
            Color.clear.frame(height: 0).task { await load() }
        }
    }

    private func load() async {
        // A read that fails hides the card rather than showing an error about
        // a screen the member did not ask for.
        rows = (try? await scope.repo.myNumberAccess(scope.companyId).numbers) ?? []
    }
}
