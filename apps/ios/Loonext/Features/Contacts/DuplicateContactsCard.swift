import SwiftUI

/// #246 — the duplicates this workspace has, offered rather than hunted for.
///
/// # Why it sits above the contact list and not behind its own screen
///
/// "The workspace can find its likely duplicates without knowing they exist."
/// Somebody who does not know they have duplicates will not navigate to a
/// screen about them. The card appears above the list only when there is
/// something to act on, which makes it a finding rather than a feature — a
/// workspace with no duplicates sees the list exactly as it always did.
///
/// *Applying: Meaningful Highlights & Context — the pair IS the insight, so it
/// is one line each with the server's reason attached. Zen of Clarity — no card
/// at all when there is nothing to merge.*
@MainActor
struct DuplicateContactsCard: View {
    let mutations: ContactMutations
    let companyId: String
    /// #246: merging needs settings.manage. A member still sees the finding.
    let canMerge: Bool
    /// Handed the result rather than a bare signal, because the opt-out union
    /// is the one outcome the crew has to be told about — a merged contact can
    /// come out opted out when neither record they were looking at said so.
    let onMerged: @MainActor (ContactMergeResult) -> Void

    @State private var pairs: [DuplicatePair] = []
    @State private var refreshKey = 0
    @State private var merging: DuplicatePair?

    var body: some View {
        // The card is absent, not empty: no skeleton and no "you have no
        // duplicates" state. Both would be a screenful of nothing for the
        // workspaces this feature has no findings for, which is most of them.
        //
        // A VStack rather than a Group so the container is in the hierarchy
        // even with nothing to show — the fetch below hangs off it, and a
        // modifier on a view that resolved to EmptyView is not reliably run.
        VStack(spacing: 0) {
            if !pairs.isEmpty {
                PaperCard {
                    VStack(alignment: .leading, spacing: 0) {
                        header
                        ForEach(pairs) { pair in
                            RowDivider()
                            row(pair)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 6)
            }
        }
        .task(id: "\(companyId)|\(refreshKey)") {
            do {
                pairs = try await mutations.duplicates(companyId: companyId).data
            } catch {
                // A finding nobody asked for must never become an error
                // somebody has to dismiss. Silence is the honest failure here.
                pairs = []
            }
        }
        .sheet(item: $merging) { pair in
            MergeContactsSheet(
                mutations: mutations,
                companyId: companyId,
                pair: pair,
                onMerged: { result in
                    merging = nil
                    refreshKey += 1
                    onMerged(result)
                }
            )
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.2")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrandColor.muted500)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    pairs.count == 1
                        ? "These two look like the same customer"
                        : "\(pairs.count) pairs look like the same customer"
                )
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                Text("Merging keeps every message, task and photo from both, under one record.")
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
    }

    private func row(_ pair: DuplicatePair) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    describeContact(pair.name_a, pair.phone_a)
                        + " and "
                        + describeContact(pair.name_b, pair.phone_b)
                )
                .font(.golos(13))
                .foregroundStyle(BrandColor.ink)
                .lineLimit(2)
                // The reason, in the words the server used. A suggestion
                // somebody cannot verify is one they learn to dismiss.
                Text(pair.reason)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canMerge {
                Button("Merge") { merging = pair }
                    .buttonStyle(.plain)
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(BrandColor.insetDeep, in: Capsule())
                    .accessibilityLabel(
                        "Merge \(describeContact(pair.name_a, pair.phone_a)) and "
                            + describeContact(pair.name_b, pair.phone_b)
                    )
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
    }
}

/// A contact as somebody recognises it: the name if there is one, else the number.
func describeContact(_ name: String?, _ phone: String) -> String {
    let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let trimmed, !trimmed.isEmpty else { return formatPhone(phone) }
    return "\(trimmed) (\(formatPhone(phone)))"
}

/// # Ethical Friction, and which direction the sheet states
///
/// A merge moves somebody's whole history under a different record. The undo
/// restores the second contact but NOT which thread came from which, so this
/// says out loud what survives and names the direction in the way people get
/// backwards ("merge A into B" is ambiguous to almost everyone).
///
/// Both numbers keep working either way — the fact that makes the decision safe
/// and the one most likely to be assumed wrong.
///
/// *Applying: Ethical Friction — a destructive action gets a deliberate,
/// stated confirmation. Smart Defaults — the survivor is preselected, so this
/// is never an unanswered form.*
@MainActor
private struct MergeContactsSheet: View {
    let mutations: ContactMutations
    let companyId: String
    let pair: DuplicatePair
    let onMerged: @MainActor (ContactMergeResult) -> Void

    @State private var keepFirst = true
    @State private var saving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private var survivorId: String { keepFirst ? pair.contact_a : pair.contact_b }
    private var foldedId: String { keepFirst ? pair.contact_b : pair.contact_a }
    private var survivorLabel: String {
        keepFirst
            ? describeContact(pair.name_a, pair.phone_a)
            : describeContact(pair.name_b, pair.phone_b)
    }
    private var foldedLabel: String {
        keepFirst
            ? describeContact(pair.name_b, pair.phone_b)
            : describeContact(pair.name_a, pair.phone_a)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Merge these two customers")
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(
                "Everything from both — messages, tasks, photos, notes — ends up "
                    + "under the record you keep. Both phone numbers keep working."
            )
            .font(.golos(12.5))
            .foregroundStyle(BrandColor.muted600)
            .fixedSize(horizontal: false, vertical: true)

            Text("Which one to keep")
                .font(.golos(11.5, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
                .padding(.top, 2)

            ForEach([true, false], id: \.self) { first in
                let label = first
                    ? describeContact(pair.name_a, pair.phone_a)
                    : describeContact(pair.name_b, pair.phone_b)
                Button {
                    keepFirst = first
                } label: {
                    HStack(spacing: 9) {
                        Image(
                            systemName: keepFirst == first
                                ? "largecircle.fill.circle"
                                : "circle"
                        )
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(
                            keepFirst == first ? BrandColor.olive : BrandColor.muted300
                        )
                        Text(label)
                            .font(.golos(13))
                            .foregroundStyle(BrandColor.ink)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(saving)
                .accessibilityAddTraits(keepFirst == first ? [.isSelected] : [])
            }

            // Said back in the direction people get backwards.
            Text("\(foldedLabel) stops being a separate customer. Its history moves to \(survivorLabel).")
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            if let error {
                Text(error)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.plain)
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                    .disabled(saving)
                Button(saving ? "Merging…" : "Merge") { merge() }
                    .buttonStyle(.plain)
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.paper)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .background(BrandColor.ink, in: Capsule())
                    .disabled(saving)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium])
    }

    private func merge() {
        saving = true
        error = nil
        Task {
            do {
                let result = try await mutations.merge(
                    companyId: companyId,
                    fromContactId: foldedId,
                    intoContactId: survivorId
                )
                onMerged(result)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Previews

#Preview("Duplicate contacts card") {
    let graph = AppGraph()
    ScrollView {
        DuplicateContactsCard(
            mutations: ContactMutations(
                api: graph.api,
                multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
            ),
            companyId: "preview-co",
            canMerge: true,
            onMerged: { _ in }
        )
    }
    .background(BrandColor.canvas)
}
