import SwiftUI

/// Signed-in devices (#236) — the iOS half of the web's /settings/devices and
/// the Android twin's DevicesSection.
///
/// A phone is the primary device for this product, and phones get lost,
/// stolen, sold, and handed to the next person when a tech quits. This is
/// where somebody answers "what is signed in right now, and how do I kill it".
///
/// Two lists, in the order the two questions get asked: your own devices first
/// (everybody wonders), then the crew's (only an owner or admin can act on
/// that, so only they are shown it).

/// Both lists, loaded together so the screen paints once.
private struct DevicesData {
    let mine: [DeviceSession]
    /// nil for a plain member — the crew list is admin+.
    let crew: [WorkspaceSession]?
    let members: [Member]
}

@MainActor
struct DevicesSectionView: View {
    let scope: SettingsScope

    @State private var state: LoadState<DevicesData> = .loading
    @State private var refreshKey = 0

    private var canManage: Bool { SettingsRoleGate.canManageTeam(scope.role) }

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
                // #289: this phone's own data plan, above the device list. It
                // is the only setting on this screen that changes what the app
                // DOES rather than what is signed in, so it goes first — a
                // reader who came here for it should not have to scroll past a
                // list of sessions to find it.
                DataUseCard(scope: scope)
                MyDevicesCard(scope: scope, sessions: data.mine) { refreshKey += 1 }
                if let crew = data.crew {
                    CrewDevicesCard(scope: scope, sessions: crew, members: data.members) {
                        refreshKey += 1
                    }
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                let mine = try await scope.repo.mySessions().data
                let crew: [WorkspaceSession]?
                let members: [Member]
                if canManage {
                    crew = try await scope.repo.workspaceSessions(scope.companyId).data
                    members = try await scope.repo.members(scope.companyId).data
                } else {
                    crew = nil
                    members = []
                }
                state = .ready(DevicesData(mine: mine, crew: crew, members: members))
            } catch {
                if case .ready = state {
                    scope.showMessage(error.userMessage)
                } else {
                    state = .failed(error.userMessage)
                }
            }
        }
    }
}

// MARK: - Your devices

@MainActor
private struct MyDevicesCard: View {
    let scope: SettingsScope
    let sessions: [DeviceSession]
    let onChanged: @MainActor () -> Void

    @State private var busy = false
    @State private var confirmingAll = false
    @State private var actionError: String?

    private var ordered: [DeviceSession] { orderMyDevices(sessions) }
    private var others: Int { sessions.filter { !$0.isCurrent }.count }

    var body: some View {
        SettingsCard(
            title: "Your devices",
            description: "Anything signed in as you, in any workspace. "
                + "Signing one out takes effect on its next tap."
        ) {
            VStack(alignment: .leading, spacing: 0) {
                if ordered.isEmpty {
                    ReadOnlyLine(
                        "Nothing is signed in — which cannot be true, since you are reading "
                            + "this. Pull to refresh and check again."
                    )
                }
                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, session in
                    if index > 0 { Divider() }
                    DeviceRow(
                        client: session.clientKind,
                        secondary: session.location ?? "Location not available",
                        signedInAt: session.signed_in_at,
                        lastActiveAt: session.last_active_at,
                        userAgent: session.user_agent,
                        current: session.isCurrent
                    ) {
                        // No confirm on a single device of your own: it is
                        // small and reversible (they sign back in). The pause
                        // is spent on the two actions that are not.
                        if !session.isCurrent {
                            Button("Sign out") { signOut(session.id) }
                                .font(.golos(13))
                                .foregroundStyle(BrandColor.muted600)
                                .disabled(busy)
                        }
                    }
                }

                if others > 0 {
                    Button("Sign out everywhere else") { confirmingAll = true }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .padding(.top, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        // Ethical friction, once: everything-at-once is not reversible in the
        // way one device is, so it gets a pause and a sentence about what
        // actually happens.
        .sheet(isPresented: $confirmingAll) {
            ConfirmSheet(
                title: "Sign out everywhere else?",
                message: "\(deviceCountLabel(others)) will stop working on the next tap, and "
                    + "stop receiving your customers' messages. You stay signed in here. "
                    + "Anyone who should still have access can sign back in.",
                confirmLabel: "Sign them out",
                destructive: true,
                pending: busy,
                error: actionError,
                onConfirm: { signOutEverywhereElse() },
                onDismiss: { confirmingAll = false }
            )
        }
    }

    private func signOut(_ sessionId: String) {
        busy = true
        Task {
            do {
                _ = try await scope.repo.revokeMySession(sessionId: sessionId)
                scope.showMessage("Signed that device out.")
                onChanged()
            } catch {
                scope.showMessage(error.userMessage)
            }
            busy = false
        }
    }

    private func signOutEverywhereElse() {
        busy = true
        actionError = nil
        Task {
            do {
                let result = try await scope.repo.revokeMyOtherSessions()
                confirmingAll = false
                scope.showMessage(
                    result.endedSessions == 0
                        ? "Nothing else was signed in."
                        : "Signed out \(deviceCountLabel(result.endedSessions))."
                )
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}

// MARK: - The crew's devices

@MainActor
private struct CrewDevicesCard: View {
    let scope: SettingsScope
    let sessions: [WorkspaceSession]
    let members: [Member]
    let onChanged: @MainActor () -> Void

    @State private var target: RevokeTarget?
    @State private var busy = false
    @State private var actionError: String?

    private var nameByMember: [String: String] {
        Dictionary(uniqueKeysWithValues: members.map {
            ($0.id, $0.display_name.isEmpty ? "A crew member" : $0.display_name)
        })
    }

    private func name(for memberId: String?) -> String {
        guard let memberId else { return "A crew member" }
        return nameByMember[memberId] ?? "A crew member"
    }

    var body: some View {
        SettingsCard(
            title: "The crew's devices",
            description: "Everything signed in to this workspace. Removing someone already "
                + "ends their access — this is for a phone that went missing while they are "
                + "still on the team."
        ) {
            VStack(alignment: .leading, spacing: 0) {
                if sessions.isEmpty {
                    ReadOnlyLine("Nobody on the crew has anything signed in right now.")
                }
                ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                    if index > 0 { Divider() }
                    let who = name(for: session.member_id)
                    DeviceRow(
                        client: session.clientKind,
                        // The person comes first here: an owner is looking for
                        // WHOSE phone, then where it is.
                        secondary: session.location.map { "\(who) · \($0)" } ?? who,
                        signedInAt: session.signed_in_at,
                        lastActiveAt: session.last_active_at,
                        userAgent: nil,
                        current: false
                    ) {
                        if let memberId = session.member_id {
                            Button("Sign out") {
                                target = RevokeTarget(memberId: memberId, name: who)
                            }
                            .font(.golos(13))
                            .foregroundStyle(BrandColor.muted600)
                            .disabled(busy)
                        }
                    }
                }
            }
        }
        .sheet(item: $target) { current in
            let count = sessions.filter { $0.member_id == current.memberId }.count
            ConfirmSheet(
                title: "Sign \(current.name) out?",
                message: "Every device they are signed in on — \(deviceCountLabel(count)) right "
                    + "now — stops working on its next tap and stops receiving this "
                    + "workspace's messages. They keep their seat and can sign back in; a "
                    + "call they are on right now is not cut off.",
                confirmLabel: "Sign them out",
                destructive: true,
                pending: busy,
                error: actionError,
                onConfirm: { signOutMember(current.memberId, who: current.name) },
                onDismiss: { target = nil }
            )
        }
    }

    private func signOutMember(_ memberId: String, who: String) {
        busy = true
        actionError = nil
        Task {
            do {
                let result = try await scope.repo.revokeMemberSessions(
                    scope.companyId, memberId: memberId
                )
                target = nil
                scope.showMessage(
                    result.endedSessions == 0
                        ? "They had nothing signed in."
                        : "Signed \(who) out of \(deviceCountLabel(result.endedSessions))."
                )
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}

/// `.sheet(item:)` needs an Identifiable. The name rides along so the sheet's
/// copy does not have to re-resolve it while the list underneath is being
/// refetched — the confirmation must keep naming the person it named when the
/// button was pressed.
private struct RevokeTarget: Identifiable {
    let memberId: String
    let name: String
    var id: String { memberId }
}

// MARK: - One row

/// Built for RECOGNITION: the reader is scanning for the one that is not
/// theirs, so which app and roughly where are the headline. The user agent is
/// kept but last — it settles an argument, it does not start one.
@MainActor
private struct DeviceRow<Action: View>: View {
    let client: String
    let secondary: String
    let signedInAt: String
    let lastActiveAt: String
    let userAgent: String?
    let current: Bool
    let action: () -> Action

    // Explicit rather than memberwise: the trailing closure is a ViewBuilder,
    // and this file cannot be compiled on the box it was written on (there is
    // no Xcode here — see docs), so nothing is left to inference that can be
    // spelled out.
    init(
        client: String,
        secondary: String,
        signedInAt: String,
        lastActiveAt: String,
        userAgent: String?,
        current: Bool,
        @ViewBuilder action: @escaping () -> Action
    ) {
        self.client = client
        self.secondary = secondary
        self.signedInAt = signedInAt
        self.lastActiveAt = lastActiveAt
        self.userAgent = userAgent
        self.current = current
        self.action = action
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: deviceClientSymbol(client))
                .font(.system(size: 17))
                .foregroundStyle(current ? BrandColor.olive : BrandColor.muted600)
                .frame(width: 22)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(deviceClientLabel(client))
                        .font(.golos(15))
                        .foregroundStyle(BrandColor.ink)
                    if current {
                        // Said before anything else about this row: the one
                        // device nobody should worry about.
                        StatusPill(label: "This device", tone: .positive)
                    }
                }
                Text(secondary)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .lineLimit(1)
                Text(
                    "Last active \(relativeTime(lastActiveAt)) · signed in "
                        + relativeTime(signedInAt)
                )
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted600)
                if let userAgent {
                    Text(userAgent)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted600)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            action()
        }
        .padding(.vertical, 10)
    }
}

/**
 #289 — "download photos on Wi-Fi only, at minimum".

 One switch, and deliberately narrow. #240 made a thread and a gallery fetch a
 bounded preview, so the expensive fetch left is the full-size original behind a
 tap — which means this can wait for Wi-Fi without ever making the app look
 broken on a job site. The supporting line says so, because a setting whose
 blast radius is unclear is one nobody dares turn on.

 *Applying: Zen of Clarity — one control, and the sentence that makes it safe to
 touch.*
 */
private struct DataUseCard: View {
    let scope: SettingsScope

    var body: some View {
        SettingsCard(
            title: "Mobile data",
            description: "This phone only. Your other devices keep their own answer."
        ) {
            Toggle(isOn: Binding(
                get: { scope.graph.prefs.wifiOnlyOriginals },
                set: { scope.graph.prefs.wifiOnlyOriginals = $0 }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(MeteredMedia.settingLabel).font(.body)
                    Text(MeteredMedia.settingDescription)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
