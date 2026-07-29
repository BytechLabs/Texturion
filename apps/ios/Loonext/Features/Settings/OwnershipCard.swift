import SwiftUI

/// Ownership (#332) — on the Team screen, because that is where somebody
/// already is when they think about who runs this place.
///
/// Three things, in falling order of urgency:
///
///   1. A HANDOVER IN FLIGHT, shown to EVERYBODY — including a plain member
///      who is neither side of it. The colleague who knows the owner is only
///      on holiday is the alarm, and a takeover nobody was shown is
///      indistinguishable from a handover.
///   2. Who owns it, and the backup slot (owner only).
///   3. The two actions: hand it over, or ask to take over.
///
/// Every permission is a boolean the SERVER decided. Nothing here works out
/// for itself whether somebody may claim a business.
@MainActor
struct OwnershipCard: View {
    let scope: SettingsScope
    let state: Ownership
    let members: [Member]
    let onChanged: @MainActor () -> Void

    @State private var busy = false
    @State private var confirming: HandoverConfirm?
    @State private var offerTo: Member?
    @State private var actionError: String?

    private var others: [Member] {
        members.filter { $0.deactivated_at == nil && $0.id != state.owner_member_id }
    }

    private func name(for memberId: String?) -> String {
        guard let memberId,
              let found = members.first(where: { $0.id == memberId }),
              !found.display_name.isBlank
        else { return "a teammate" }
        return found.display_name
    }

    var body: some View {
        SettingsCard(
            title: "Ownership",
            description: "The owner controls billing, the spending cap, and your numbers. "
                + "Only they can hand that on."
        ) {
            VStack(alignment: .leading, spacing: 14) {
                if let pending = state.pending {
                    PendingHandoverNotice(
                        pending: pending,
                        who: name(for: pending.to_member_id),
                        isOwner: state.isOwner,
                        canCancel: state.canCancel,
                        busy: busy,
                        onAccept: { accept() },
                        onCancel: { cancel() }
                    )
                }

                HStack {
                    Text("Owner")
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                    Spacer()
                    Text(state.isOwner ? "You" : name(for: state.owner_member_id))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.ink)
                }

                if state.isOwner {
                    Divider()
                    backupSection
                    if state.canOffer, !others.isEmpty {
                        Divider()
                        offerSection
                    }
                }

                if state.canClaim {
                    Divider()
                    claimSection
                }
            }
        }
        // Both of these hand a business to somebody. Neither gets a one-tap
        // path — the pause is the point, and the copy is what a person needs
        // to have read before they press it.
        .sheet(item: $confirming) { current in
            ConfirmSheet(
                title: current.kind == HandoverKind.offer
                    ? "Hand this workspace to \(current.who)?"
                    : "Ask to take over this workspace?",
                message: current.kind == HandoverKind.offer
                    ? "Nothing changes until they accept. When they do, they control "
                        + "billing, the spending cap, and your numbers — and you stay on "
                        + "the team as an admin. You can cancel any time before they "
                        + "accept, and everyone will be told either way."
                    : "The owner will be emailed straight away and can stop this with one "
                        + "click for the next 7 days. Everyone on the team is told too. If "
                        + "nobody stops it, you can complete the takeover after 7 days. "
                        + "Only do this if the owner genuinely cannot act.",
                confirmLabel: current.kind == HandoverKind.offer
                    ? "Offer it" : "Ask to take over",
                pending: busy,
                error: actionError,
                onConfirm: { confirm(current) },
                onDismiss: { confirming = nil }
            )
        }
    }

    // MARK: - Sections

    private var backupSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Backup owner")
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                if state.backup_member_id == nil {
                    StatusPill(label: "Nobody named", tone: .warn)
                }
            }
            // Loss aversion, stated once and plainly: this is the difference
            // between a bad week and a business nobody can run.
            ReadOnlyLine(
                "If you ever can't get in — you lose your email, or worse — this is the "
                    + "one person who can ask to take over. They wait a week, you can stop "
                    + "it with one click, and everyone gets told. Nothing changes today."
            )
            if others.isEmpty {
                ReadOnlyLine("Invite someone first — a backup has to be on the team.")
            } else {
                Menu {
                    Button("Nobody") { setBackup(nil) }
                    ForEach(others, id: \.id) { member in
                        Button(member.display_name.isBlank ? "A teammate" : member.display_name) {
                            setBackup(member)
                        }
                    }
                } label: {
                    PickerLabel(text: state.backup_member_id.map { name(for: $0) } ?? "Nobody")
                }
                .disabled(busy)
            }
        }
    }

    private var offerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hand the workspace over")
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            ReadOnlyLine("They have to accept. You stay on the team as an admin.")
            Menu {
                ForEach(others, id: \.id) { member in
                    Button(member.display_name.isBlank ? "A teammate" : member.display_name) {
                        offerTo = member
                    }
                }
            } label: {
                PickerLabel(
                    text: offerTo.map { $0.display_name.isBlank ? "A teammate" : $0.display_name }
                        ?? "Choose a teammate"
                )
            }
            .disabled(busy)
            Button("Hand it over") {
                guard let target = offerTo else { return }
                confirming = HandoverConfirm(
                    kind: HandoverKind.offer,
                    who: target.display_name.isBlank ? "them" : target.display_name
                )
            }
            .buttonStyle(.bordered)
            .disabled(busy || offerTo == nil)
        }
    }

    private var claimSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("You are the backup owner")
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            ReadOnlyLine(
                "If the owner can't act, you can ask to take over. They get a week to "
                    + "stop it, and everyone on the team is told straight away."
            )
            Button("Ask to take over") {
                confirming = HandoverConfirm(kind: HandoverKind.claim, who: "")
            }
            .buttonStyle(.bordered)
            .disabled(busy)
        }
    }

    // MARK: - Actions

    // The closure is explicitly @MainActor rather than left to inference: it
    // captures `scope`, which is main-actor state, and this file cannot be
    // compiled on the machine it was written on (no Xcode here), so nothing
    // is left for the concurrency checker to decide.
    private func run(
        _ done: String,
        _ work: @escaping @MainActor () async throws -> Ownership
    ) {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await work()
                confirming = nil
                scope.showMessage(done)
                onChanged()
            } catch {
                actionError = error.userMessage
                if confirming == nil { scope.showMessage(error.userMessage) }
            }
            busy = false
        }
    }

    private func setBackup(_ member: Member?) {
        let label = member.map { "\(name(for: $0.id)) is your backup owner." }
            ?? "Backup owner cleared."
        run(label) {
            try await scope.repo.setBackupOwner(scope.companyId, memberId: member?.id)
        }
    }

    private func accept() {
        run("You now own this workspace.") {
            try await scope.repo.acceptOwnership(scope.companyId)
        }
    }

    private func cancel() {
        run("Stopped. Nothing changed hands.") {
            try await scope.repo.cancelOwnershipTransfer(scope.companyId)
        }
    }

    private func confirm(_ current: HandoverConfirm) {
        if current.kind == HandoverKind.offer {
            guard let target = offerTo else { return }
            run("Offered to \(name(for: target.id)). They have 7 days to accept.") {
                try await scope.repo.offerOwnership(scope.companyId, memberId: target.id)
            }
        } else {
            run("Asked. The owner has 7 days to stop it.") {
                try await scope.repo.claimOwnership(scope.companyId)
            }
        }
    }
}

/// `.sheet(item:)` needs an Identifiable, and the recipient's name rides along
/// so the copy cannot change under a refetch between press and read.
private struct HandoverConfirm: Identifiable {
    let kind: String
    let who: String
    var id: String { kind }
}

/// The one thing on this screen that everybody sees, whether or not they can
/// do anything about it. Tinted rather than folded into the body copy:
/// somebody scrolling past should not be able to miss that their workspace is
/// changing hands.
@MainActor
private struct PendingHandoverNotice: View {
    let pending: PendingHandover
    let who: String
    let isOwner: Bool
    let canCancel: Bool
    let busy: Bool
    let onAccept: @MainActor () -> Void
    let onCancel: @MainActor () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 17))
                .foregroundStyle(BrandColor.overdueAmber)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 6) {
                Text(handoverHeadline(pending.kind, who: who))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.ink)
                Text(
                    handoverDetail(
                        pending.kind,
                        ready: pending.isReady,
                        ripensAt: pending.ripens_at,
                        expiresAt: pending.expires_at
                    )
                )
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                if (pending.isMine && pending.isReady) || canCancel {
                    HStack(spacing: 10) {
                        if pending.isMine, pending.isReady {
                            Button(
                                pending.kind == HandoverKind.offer
                                    ? "Accept ownership" : "Complete the takeover"
                            ) { onAccept() }
                                .buttonStyle(.borderedProminent)
                                .tint(BrandColor.olive)
                                .disabled(busy)
                        }
                        if canCancel {
                            Button(
                                handoverCancelLabel(isOwner: isOwner, isMine: pending.isMine)
                            ) { onCancel() }
                                .buttonStyle(.bordered)
                                .disabled(busy)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.amberBg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A Menu's label, shaped like the bordered control it stands in for.
private struct PickerLabel: View {
    let text: String

    var body: some View {
        HStack {
            Text(text)
                .font(.golos(13))
                .foregroundStyle(BrandColor.ink)
            Spacer()
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11))
                .foregroundStyle(BrandColor.muted600)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
