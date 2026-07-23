import SwiftUI
import UIKit

/// The 'You' sheet (#100): workspace tile + copyable numbers, workspace
/// switcher (multi-membership only), Calls / Notifications / Settings
/// entries (Android AccountSheet parity), theme, sign out. The open-surface
/// callbacks swap the shell's presented sheet in place, so they never call
/// `dismiss()` themselves.
@MainActor
struct AccountSheet: View {
    @Bindable var prefs: AppPrefs
    let me: Me
    let companyId: String
    /// The shared unread state (#201) — the same instance the shell avatar dot
    /// and the notifications screen read, so this row's dot and count stay in
    /// lockstep with every other surface.
    let readState: CompanyReadState
    let onOpenContacts: @MainActor () -> Void
    let onOpenNotifications: @MainActor () -> Void
    let onOpenSettings: @MainActor () -> Void
    let onSwitchWorkspace: @MainActor (String) -> Void
    let onSignOut: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss

    /// Live unread count from the shared state — reading it here makes this
    /// sheet re-render the instant a mark-read clears the badge.
    private var unreadNotifications: Int {
        readState.unreadCount
    }

    private var membership: Membership? {
        me.memberships.first { $0.company_id == companyId }
    }

    private var displayName: String {
        me.display_name.isBlank ? (me.memberships.first?.name ?? "You") : me.display_name
    }

    private var activeNumbers: [PhoneNumberSummary] {
        me.company?.numbers.filter {
            $0.status == NumberStatus.active && $0.number_e164 != nil
        } ?? []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                identityCard

                if !activeNumbers.isEmpty {
                    numbersCard
                }

                // Workspace switcher only when >1 membership.
                if me.memberships.count > 1 {
                    workspacesCard
                }

                themeCard

                // Feature surfaces (#161 calls / D24 notifications / #163
                // settings) — mirrors the Android sheet's Calls · Notifications
                // (n new) · Settings links, plus Sign out (spec 08 rows).
                linksCard
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 24)
        }
        .background(BrandColor.canvas)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// Ink identity header: workspace avatar tile, name, "you · role" line.
    private var identityCard: some View {
        HStack(spacing: 12) {
            Text(initialsOf(membership?.name ?? displayName))
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.paper)
                .frame(width: 44, height: 44)
                .background(
                    BrandColor.paper.opacity(0.14),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(membership?.name ?? displayName)
                    .font(.golos(14, weight: .semibold))
                    .foregroundStyle(BrandColor.paper)
                if let membership {
                    Text("\(displayName) · \(membership.role)")
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.paper.opacity(0.55))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.ink, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// Workspace numbers with copy buttons.
    private var numbersCard: some View {
        PaperCard {
            ForEach(Array(activeNumbers.enumerated()), id: \.element.id) { index, number in
                if index > 0 { RowDivider() }
                HStack(spacing: 12) {
                    Text(formatPhone(number.number_e164))
                        .font(.golos(13.5, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.ink)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = number.number_e164 ?? ""
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 14))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Copy number")
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 12)
            }
        }
    }

    private var workspacesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Workspaces", count: me.memberships.count)
            PaperCard {
                ForEach(Array(me.memberships.enumerated()), id: \.element.company_id) { index, workspace in
                    if index > 0 { RowDivider() }
                    Button {
                        guard workspace.company_id != companyId else { return }
                        onSwitchWorkspace(workspace.company_id)
                        dismiss()
                    } label: {
                        HStack(spacing: 10) {
                            InitialsAvatar(name: workspace.name, size: 30)
                            Text(workspace.name)
                                .font(.golos(13.5, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                            Spacer()
                            if workspace.company_id == companyId {
                                DsChip(text: "Current")
                            }
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(workspace.company_id == companyId)
                }
            }
        }
    }

    private var themeCard: some View {
        PaperCard {
            HStack(spacing: 12) {
                Text("Theme")
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                Picker("Theme", selection: $prefs.theme) {
                    Text("System").tag(AppPrefs.Theme.system)
                    Text("Light").tag(AppPrefs.Theme.light)
                    Text("Dark").tag(AppPrefs.Theme.dark)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 220)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
        }
    }

    private var linksCard: some View {
        PaperCard {
            linkRow(
                icon: "bell",
                label: "Notifications",
                trailing: unreadNotifications > 0 ? "\(unreadNotifications) new" : nil,
                showDot: unreadNotifications > 0,
                action: onOpenNotifications
            )
            RowDivider()
            // Spec 08 row order: Notifications · Contacts · Settings · Sign out.
            // Calls left this sheet when it became a nav tab (#redesign IA).
            linkRow(icon: "person.2", label: "Contacts", action: onOpenContacts)
            RowDivider()
            linkRow(icon: "gearshape", label: "Settings", action: onOpenSettings)
            RowDivider()
            linkRow(icon: "rectangle.portrait.and.arrow.right", label: "Sign out", muted: true) {
                onSignOut()
                dismiss()
            }
        }
    }

    /// Spec-08 row: 36pt inset icon tile, 13.5 semibold label, olive count or
    /// quiet chevron; coral dot on the icon marks unread.
    private func linkRow(
        icon: String,
        label: String,
        trailing: String? = nil,
        showDot: Bool = false,
        muted: Bool = false,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon)
                        .font(.system(size: 15))
                        .foregroundStyle(muted ? BrandColor.muted500 : BrandColor.muted900)
                        .frame(width: 36, height: 36)
                        .background(
                            BrandColor.inset,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                    if showDot {
                        AttentionDot(size: 9)
                            .offset(x: 3, y: -3)
                    }
                }
                Text(label)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(muted ? BrandColor.muted500 : BrandColor.ink)
                Spacer()
                if let trailing {
                    Text(trailing)
                        .font(.golos(11, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.olive)
                } else if !muted {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted250)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
