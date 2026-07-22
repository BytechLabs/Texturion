import SwiftUI

/// Everything the numbers screen shows, loaded together.
private struct NumbersData {
    let numbers: [PhoneNumberSummary]
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
                let cards = data.numbers.filter { number in
                    number.source == "provisioned" || number.status == NumberStatus.active
                }
                if cards.isEmpty && company.plan == nil {
                    SettingsCard(title: "Your number") {
                        Text("No number yet — it's created automatically when your subscription starts.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(cards, id: \.id) { number in
                    NumberCard(scope: scope, company: company, number: number, onChanged: refresh)
                }
                AddNumberCard(scope: scope, company: company, numbers: data.numbers, onChanged: refresh)
                PortsBlock(scope: scope, company: company, ports: data.ports, onChanged: refresh)
                TextEnableBlock(scope: scope, company: company, orders: data.textEnablements, onChanged: refresh)
                RegistrationBlock(scope: scope, company: company, registration: data.registration, onChanged: refresh)
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                state = .ready(
                    NumbersData(
                        numbers: try await scope.repo.numbers(scope.companyId).data,
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
    @State private var choosing = false

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canRelease: Bool { SettingsRoleGate.canReleaseNumber(scope.role) }
    private var released: Bool { number.status == NumberStatus.released }

    private var display: String {
        if let e164 = number.number_e164 { return formatPhone(e164) }
        if let code = number.requested_area_code { return "Area code \(code)" }
        return "Your number"
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
                        scope.showMessage("Number copied.")
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Copy number")
                }
            }

            statusBody

            if !released && number.status == NumberStatus.active {
                HStack(spacing: 12) {
                    if canManage {
                        Button("Who can use this number") { managingAccess = true }
                            .font(.subheadline)
                            .buttonStyle(.borderless)
                    }
                    if canRelease && number.number_e164 != nil {
                        Button("Release") { releasing = true }
                            .font(.subheadline)
                            .foregroundStyle(BrandColor.destructive)
                            .buttonStyle(.borderless)
                    }
                }
                .padding(.top, 6)
                if !canManage {
                    ReadOnlyLine("Only owners and admins can manage numbers.")
                }
            }
        }
        .sheet(isPresented: $releasing) {
            if number.number_e164 != nil {
                ReleaseNumberSheet(scope: scope, number: number) {
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
        case "ported": "Transferred in"
        case "hosted": "Text-enabled landline"
        default: "Loonext number"
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        switch number.status {
        case NumberStatus.active:
            StatusPill(label: "Active", tone: .positive)
        case NumberStatus.provisioning:
            StatusPill(label: "Setting up", tone: .warn)
        case NumberStatus.suspended:
            StatusPill(label: "Suspended", tone: .warn)
        case NumberStatus.released:
            StatusPill(label: "Released", tone: .neutral)
        case NumberStatus.provisionFailed:
            if !needsNumberChoice(number) {
                StatusPill(label: "Setting up", tone: .warn)
            } else if number.failure_reason == "timeout" {
                StatusPill(label: "Action needed", tone: .warn)
            } else {
                StatusPill(label: "Couldn't set up", tone: .bad)
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
                Text("Released \(relativeTime(at)) ago.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else if number.status == NumberStatus.suspended {
            Text(
                "This number is suspended. Update your payment method under "
                    + "Settings › Billing to bring it back."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else if number.status == NumberStatus.provisioning {
            Text("We're setting up your number. This usually takes under a minute.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if number.status == NumberStatus.provisionFailed {
            Text(failedNumberCopy(number))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if canManage && needsNumberChoice(number) {
                Button("Choose a number") { choosing = true }
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
    let onReleased: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var typed = ""
    @State private var pending = false
    @State private var error: String?

    private var display: String { formatPhone(number.number_e164) }

    private var matches: Bool {
        let expected = (number.number_e164 ?? "").filter(\.isNumber)
        let typedDigits = typed.filter(\.isNumber)
        return !expected.isEmpty && (typedDigits == expected || "1\(typedDigits)" == expected)
    }

    var body: some View {
        ConfirmSheet(
            title: "Release \(display)?",
            message: "This gives the number up for good. Customers who text it won't reach "
                + "you, and you can't get the same number back. It doesn't change your plan "
                + "or what you pay — a number is included, so you can set up a new one here "
                + "afterward. Type the number to confirm.",
            confirmLabel: "Release number",
            destructive: true,
            pending: pending,
            error: error,
            confirmEnabled: matches,
            dismissLabel: "Keep the number",
            onConfirm: { release() },
            onDismiss: { onDismiss() }
        ) {
            TextField("Type \(display) to confirm", text: $typed)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.phonePad)
                .disabled(pending)
                .padding(.top, 10)
        }
    }

    private func release() {
        pending = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.releaseNumber(scope.companyId, numberId: number.id)
                scope.showMessage("\(display) released.")
                onReleased()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

// MARK: - #106 access sheet

private enum AccessMode: CaseIterable {
    case everyone
    case membersView
    case admins
    case users

    var label: String {
        switch self {
        case .everyone: "Everyone"
        case .membersView: "Members: view & notes only"
        case .admins: "Admins only"
        case .users: "Specific people"
        }
    }

    var detail: String {
        switch self {
        case .everyone: "The whole team can text, like today."
        case .membersView: "Members can read and add notes, but not text. Admins still text."
        case .admins: "Members can't see this number at all."
        case .users: "Only the people you pick. Admins still text."
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

    private var display: String {
        number.number_e164.map(formatPhone) ?? "this number"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Owners and admins can always use every number.")
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
                        Button("Try again") { retryKey += 1 }
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
            .navigationTitle("Who can use \(display)?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pending ? "Saving…" : "Save") { save() }
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
        ForEach(AccessMode.allCases, id: \.label) { option in
            Button {
                mode = option
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: mode == option ? "largecircle.fill.circle" : "circle")
                        .foregroundStyle(mode == option ? BrandColor.olive : Color.secondary)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.label)
                            .font(.callout)
                            .foregroundStyle(Color.primary)
                        Text(option.detail)
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
            Text("No active members to pick — everyone else on the team is an owner or admin.")
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
                        Text(member.display_name.isBlank ? "Teammate" : member.display_name)
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
                        Text(value == NumberAccessLevel.text ? "Can text" : "View & notes only")
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
            error = "Pick at least one person, or choose Everyone."
            return
        }
        pending = true
        error = nil
        let body = accessBody(mode: mode, level: level, pickedUserIds: picked)
        Task {
            do {
                _ = try await scope.repo.setNumberAccess(scope.companyId, numberId: number.id, body: body)
                scope.showMessage("Access to \(display) updated.")
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

    var body: some View {
        if SettingsRoleGate.canManageNumbers(scope.role),
           company.subscriptionActive,
           let facts = planFacts(company.plan) {
            let liveCount = numbers.filter { $0.status != NumberStatus.released }.count
            let starterAtCap = company.plan == "starter" && liveCount >= 2
            if !starterAtCap {
                let nextIsExtra = liveCount >= facts.numbers
                let extraPrice = company.plan == "pro" ? "$4/mo" : "$5/mo"
                SettingsCard(
                    title: "Add a number",
                    description: nextIsExtra
                        ? "An extra number is \(extraPrice), billed today. Your message allowance is "
                            + "shared — an extra number doesn't add messages."
                        : "Choose the number your customers will text. It's included in your plan — "
                            + "no extra cost."
                ) {
                    Button("Choose a number") {
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
                        title: "Choose a number",
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
                scope.showMessage("Your number is being set up.")
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

    var body: some View {
        NumberPickerSheet(
            scope: scope,
            country: number.country,
            initialAreaCode: number.requested_area_code,
            title: "Choose a number to finish setup",
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
                scope.showMessage("Setup restarted — you won't be charged again.")
                onDone()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}
