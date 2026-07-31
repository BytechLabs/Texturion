import SwiftUI

/// Everything the team screen shows, loaded together.
private struct TeamData {
    let members: [Member]
    /// nil when the caller is a plain member (the invites list is admin+).
    let invites: [Invite]?
    /// #332: who owns it, and any handover in flight. Everyone sees this.
    let ownership: Ownership
}

private func expiryDate(_ iso: String) -> String {
    guard let date = parseWireTimestamp(iso) else { return iso }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMM d, yyyy"
    return formatter.string(from: date)
}

private func isExpired(_ invite: Invite, now: Date = Date()) -> Bool {
    guard let expires = parseWireTimestamp(invite.expires_at) else { return true }
    return expires < now
}

/// #315: every role names itself. The `default: "Member"` this replaced was a
/// catch-all, so a view-only teammate rendered as "Member" — the app telling
/// the owner the opposite of what they had set. An unknown role from a newer
/// server now reads as itself rather than as a role it is not.
private func roleLabel(_ role: String) -> String {
    switch role {
    case MemberRole.owner: "Owner"
    case MemberRole.admin: "Admin"
    case MemberRole.member: "Member"
    case MemberRole.readOnly: "View only"
    default: role.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

/// What each assignable role is FOR, in the words an owner picking one uses.
private func roleBlurb(_ role: String) -> String {
    switch role {
    case MemberRole.admin:
        "Everything except transferring ownership and closing the workspace"
    case MemberRole.readOnly:
        "Can see conversations, cannot reply or change anything"
    default: "Read and answer customers; no billing, team or settings"
    }
}

/// Team (#163): who can see and answer your customers' texts. Members list
/// with inline role change + deactivation (admin+), the invite form gated by
/// the seat formula, and the pending-invite list with the Copy-link fallback.
@MainActor
struct TeamSectionView: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var state: LoadState<TeamData> = .loading
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
                MembersCard(scope: scope, members: data.members) { refreshKey += 1 }
                // #332: everybody sees this, including a plain member — a
                // handover in flight is exactly the thing a colleague is best
                // placed to notice is wrong.
                OwnershipCard(
                    scope: scope,
                    state: data.ownership,
                    members: data.members
                ) { refreshKey += 1 }
                if canManage, let invites = data.invites {
                    InvitesCard(
                        scope: scope,
                        company: company,
                        members: data.members,
                        invites: invites
                    ) { refreshKey += 1 }
                } else {
                    SettingsCard(title: "Invites") {
                        ReadOnlyLine("Only owners and admins can invite or deactivate teammates.")
                    }
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                let members = try await scope.repo.members(scope.companyId).data
                let invites: [Invite]?
                if canManage {
                    invites = try await scope.repo.invites(scope.companyId).data
                } else {
                    invites = nil
                }
                let ownership = try await scope.repo.ownership(scope.companyId)
                state = .ready(
                    TeamData(members: members, invites: invites, ownership: ownership)
                )
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

// MARK: - Members

private struct MembersCard: View {
    let scope: SettingsScope
    let members: [Member]
    let onChanged: @MainActor () -> Void

    var body: some View {
        SettingsCard(
            title: "Members",
            description: "Who can see and answer your customers' texts."
        ) {
            let active = members.filter { $0.deactivated_at == nil }
            let deactivated = members.filter { $0.deactivated_at != nil }
            ForEach(Array(active.enumerated()), id: \.element.id) { index, member in
                if index > 0 { Divider() }
                MemberRow(scope: scope, member: member, onChanged: onChanged)
            }
            if !deactivated.isEmpty {
                Spacer().frame(height: 14)
                Text("Deactivated")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(deactivated, id: \.id) { member in
                        MemberRow(scope: scope, member: member, onChanged: onChanged)
                    }
                }
                .opacity(0.6)
            }
        }
    }
}

private struct MemberRow: View {
    let scope: SettingsScope
    let member: Member
    let onChanged: @MainActor () -> Void

    @State private var busy = false
    @State private var confirmingDeactivate = false
    @State private var actionError: String?
    // #348: what this person actually reaches, on demand.
    @State private var showingAccess = false

    private var isSelf: Bool { member.user_id == scope.me.user_id }
    private var name: String { member.display_name.isBlank ? "Teammate" : member.display_name }
    private var canChangeRole: Bool { SettingsRoleGate.canChangeRoleOf(actorRole: scope.role, target: member) }
    private var canDeactivate: Bool {
        SettingsRoleGate.canDeactivate(actorRole: scope.role, target: member, selfUserId: scope.me.user_id)
    }

    var body: some View {
        HStack(spacing: 12) {
            InitialsAvatar(name: name, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(isSelf ? "\(name) (you)" : name)
                    .font(.body)
                Text(
                    member.deactivated_at.map { "Deactivated \(relativeTime($0)) ago" }
                        ?? "Joined \(relativeTime(member.created_at)) ago"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            Spacer()
            // #348: the access model was complete and entirely invisible. Quiet
            // and text-only, because it answers a question rather than being an
            // action, and the row already carries a role menu.
            if member.deactivated_at == nil {
                Button("Numbers") { showingAccess = true }
                    .font(.footnote)
                    .foregroundStyle(BrandColor.muted500)
                    .buttonStyle(.plain)
            }
            if member.role == MemberRole.owner {
                StatusPill(label: "Owner", tone: .positive)
            } else if canChangeRole {
                Menu {
                    ForEach(
                        [MemberRole.admin, MemberRole.member, MemberRole.readOnly],
                        id: \.self
                    ) { role in
                        Button(roleLabel(role)) { changeRole(role) }
                    }
                } label: {
                    Text(busy ? "Saving…" : roleLabel(member.role))
                        .font(.subheadline)
                        .foregroundStyle(BrandColor.olive)
                }
                .disabled(busy)
            } else {
                Text(roleLabel(member.role))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if canDeactivate {
                Button("Deactivate") { confirmingDeactivate = true }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.borderless)
                    .disabled(busy)
            }
        }
        .padding(.vertical, 10)
        .sheet(isPresented: $confirmingDeactivate) {
            ConfirmSheet(
                title: "Deactivate \(name)?",
                message: "They lose access right away and their seat frees up. "
                    + "Conversations and messages they worked on stay put.",
                confirmLabel: "Deactivate",
                destructive: true,
                pending: busy,
                error: actionError,
                onConfirm: { deactivate() },
                onDismiss: { confirmingDeactivate = false }
            )
        }
        .sheet(isPresented: $showingAccess) {
            MemberAccessSheet(scope: scope, member: member, name: name)
        }
    }

    private func changeRole(_ role: String) {
        guard role != member.role else { return }
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.setMemberRole(scope.companyId, memberId: member.id, role: role)
                scope.showMessage("\(name) is now \(roleLabel(role).lowercased()).")
                onChanged()
            } catch {
                scope.showMessage(error.userMessage)
            }
            busy = false
        }
    }

    private func deactivate() {
        busy = true
        actionError = nil
        Task {
            do {
                try await scope.repo.deactivateMember(scope.companyId, memberId: member.id)
                confirmingDeactivate = false
                scope.showMessage("\(name) deactivated. Their seat is free.")
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}

// MARK: - Invites

private struct InvitesCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let members: [Member]
    let invites: [Invite]
    let onChanged: @MainActor () -> Void

    @State private var email = ""
    @State private var role = MemberRole.member
    @State private var sending = false
    @State private var formError: String?

    private var seat: SeatUsage {
        seatUsage(
            activeMembers: countActiveMembers(members),
            pendingInvites: pendingInviteCount(invites),
            plan: company.plan,
            // #392: the server's number wins. A client copy higher than the
            // API's tells an owner they have room and then the invite is
            // refused.
            servedLimit: company.seat_limit
        )
    }

    private var pending: [Invite] {
        invites.filter { $0.accepted_at == nil && $0.revoked_at == nil }
    }

    var body: some View {
        SettingsCard(title: "Invite a teammate", description: seat.line) {
            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(seat.full || sending)
            Spacer().frame(height: 8)
            HStack(spacing: 12) {
                Menu {
                    ForEach(
                        [MemberRole.member, MemberRole.admin, MemberRole.readOnly],
                        id: \.self
                    ) { option in
                        // #315: a named preset that does not say what it is for
                        // is just a word. An owner picking a role for their
                        // accountant should not have to infer it.
                        Button {
                            role = option
                        } label: {
                            Text(roleLabel(option))
                            Text(roleBlurb(option))
                        }
                    }
                } label: {
                    Text(roleLabel(role))
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
                .disabled(seat.full || sending)
                Button(sending ? "Inviting…" : "Invite") { invite() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(seat.full || sending || email.isBlank)
            }
            InlineError(formError)
            if seat.full {
                Spacer().frame(height: 6)
                ReadOnlyLine("All seats are taken. Deactivate a teammate or revoke a pending invite first.")
            }

            if !pending.isEmpty {
                Spacer().frame(height: 14)
                Text("Pending invites")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                ForEach(pending, id: \.id) { invite in
                    PendingInviteRow(scope: scope, invite: invite, onChanged: onChanged)
                    Divider()
                }
            }
        }
    }

    private func invite() {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("@"), trimmed.count >= 3 else {
            formError = "Enter the teammate's email address."
            return
        }
        sending = true
        formError = nil
        Task {
            do {
                let invite = try await scope.repo.createInvite(scope.companyId, email: trimmed, role: role)
                email = ""
                if invite.email_sent == false {
                    scope.showMessage(
                        "The invite email couldn't be sent. Use Copy link below and share it yourself."
                    )
                } else {
                    scope.showMessage("Invite sent to \(trimmed).")
                }
                onChanged()
            } catch {
                formError = error.userMessage
            }
            sending = false
        }
    }
}

private struct PendingInviteRow: View {
    let scope: SettingsScope
    let invite: Invite
    let onChanged: @MainActor () -> Void

    @State private var revoking = false

    var body: some View {
        let expired = isExpired(invite)
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(invite.email)
                    .font(.callout)
                Text(
                    "\(roleLabel(invite.role)) · "
                        + (expired ? "Expired, doesn't hold a seat" : "Expires \(expiryDate(invite.expires_at))")
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if !expired {
                Button("Copy link") {
                    copyToClipboard(inviteLink(invite.id))
                    scope.showMessage("Invite link copied.")
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
            }
            Button(revoking ? "Revoking…" : "Revoke") { revoke() }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .buttonStyle(.borderless)
                .disabled(revoking)
        }
        .padding(.vertical, 8)
    }

    private func revoke() {
        revoking = true
        Task {
            do {
                try await scope.repo.revokeInvite(scope.companyId, inviteId: invite.id)
                scope.showMessage("Invite revoked.")
                onChanged()
            } catch {
                scope.showMessage(error.userMessage)
            }
            revoking = false
        }
    }
}


/// #348 — what this person reaches on every number, and why.
///
/// A SHEET, not a section on the team list. Most workspaces have one to three
/// numbers and several people; inlining this would put a paragraph under every
/// row to answer a question an owner asks about one person, occasionally.
///
/// RESTRICTED ROWS FIRST. Somebody opening this is checking a suspicion, not
/// reading a report, and a list that opens with unrestricted rows buries the one
/// that answers them.
///
/// The reason line is the feature rather than decoration: PORTAL-UX §3.1 asks a
/// card to name the signal that placed it, and here the signal is the whole
/// screen. It also has to tell apart two states that read alike and are not —
/// nobody has restricted this number, versus somebody did and left this person
/// out.
@MainActor
private struct MemberAccessSheet: View {
    let scope: SettingsScope
    let member: Member
    let name: String

    @State private var rows: [NumberAccessExplanation]?
    @State private var failed = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("What they can do on each number, and the rule that decided it.")
                        .font(.footnote)
                        .foregroundStyle(BrandColor.muted500)
                    PaperCard {
                        if failed {
                            quiet("Couldn't load their access. Try again.")
                        } else if let rows {
                            if rows.isEmpty {
                                quiet("This workspace has no numbers yet.")
                            } else {
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { RowDivider() }
                                    accessRow(row)
                                }
                            }
                        } else {
                            quiet("Checking\u{2026}")
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(BrandColor.canvas)
            .navigationTitle("Numbers \(name) can reach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            do {
                let answer = try await scope.repo.memberNumberAccess(
                    scope.companyId,
                    userId: member.user_id
                )
                rows = answer.numbers.sortedForOwner()
            } catch {
                failed = true
            }
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.golos(12.5))
            .foregroundStyle(BrandColor.muted500)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
    }

    private func accessRow(_ row: NumberAccessExplanation) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.number_e164 ?? "Number")
                    .font(.golos(13.5))
                    .foregroundStyle(BrandColor.ink)
                Text(numberAccessReason(row.decided_by, row.principal))
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            // Muted rather than red for a restriction: this is a settings
            // readout, not an alarm, and most restrictions are somebody's
            // deliberate choice.
            StatusPill(
                label: numberAccessLevelLabel(row.level),
                tone: numberAccessIsRestricted(row.level) ? .neutral : .positive
            )
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
    }
}
