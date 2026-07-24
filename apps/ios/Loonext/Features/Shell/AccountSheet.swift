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
    /// #180: collapse the sheet's vertical rhythm on a compact-height viewport
    /// (landscape / square) so every card — including Sign out — stays reachable
    /// without a long scroll.
    @Environment(\.verticalSizeClass) private var vSizeClass

    private var compactHeight: Bool { vSizeClass == .compact }

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
            VStack(alignment: .leading, spacing: compactHeight ? 10 : 14) {
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
            .padding(.top, compactHeight ? 10 : 18)
            .padding(.bottom, 24)
            // Keep the cards from stretching edge-to-edge on a regular-width
            // (iPad) sheet — capped and centered (#180).
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
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
                // Styled segmented control (ink pill), matching Android/web (#186).
                ThemeSegmentedControl(theme: $prefs.theme)
                    .frame(maxWidth: 230)
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
            // Sign out styled destructive (red) — founder-feedback polish (#186).
            linkRow(
                icon: "rectangle.portrait.and.arrow.right",
                label: "Sign out",
                destructive: true
            ) {
                onSignOut()
                dismiss()
            }
        }
    }

    /// Spec-08 row: 36pt inset icon tile, 13.5 semibold label, olive count or
    /// quiet chevron; coral dot on the icon marks unread. A destructive row
    /// tints the icon and label red (#186 item 7).
    private func linkRow(
        icon: String,
        label: String,
        trailing: String? = nil,
        showDot: Bool = false,
        destructive: Bool = false,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon)
                        .font(.system(size: 15))
                        .foregroundStyle(destructive ? BrandColor.destructive : BrandColor.muted900)
                        .frame(width: 36, height: 36)
                        .background(
                            destructive
                                ? AnyShapeStyle(BrandColor.destructive.opacity(0.1))
                                : AnyShapeStyle(BrandColor.inset),
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                    if showDot {
                        AttentionDot(size: 9)
                            .offset(x: 3, y: -3)
                    }
                }
                Text(label)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(destructive ? BrandColor.destructive : BrandColor.ink)
                Spacer()
                if let trailing {
                    Text(trailing)
                        .font(.golos(11, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.olive)
                } else if !destructive {
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

// MARK: - Previews (inline mock Me — nothing here touches the network)

private func previewAccountMe() -> Me {
    Me(
        user_id: "u-preview",
        display_name: "Dana Whitcomb",
        memberships: [
            Membership(
                company_id: "co-1",
                name: "Northgate Plumbing",
                role: "owner",
                subscription_status: SubscriptionStatus.active
            ),
        ],
        company: nil
    )
}

@MainActor
private func previewAccountSheet() -> AccountSheet {
    AccountSheet(
        prefs: AppPrefs(),
        me: previewAccountMe(),
        companyId: "co-1",
        readState: CompanyReadState(),
        onOpenContacts: {},
        onOpenNotifications: {},
        onOpenSettings: {},
        onSwitchWorkspace: { _ in },
        onSignOut: {}
    )
}

// #180 responsive matrix — fixed frames prove every card (Sign out included)
// stays reachable via scroll at each ratio; the compact-height variant forces
// the collapsed rhythm branch.

#Preview("Account · tall phone") {
    previewAccountSheet()
        .frame(width: 390, height: 720)
        .background(BrandColor.canvas)
}

#Preview("Account · 1:1 square") {
    previewAccountSheet()
        .frame(width: 380, height: 380)
        .background(BrandColor.canvas)
}

#Preview("Account · landscape (compact height)") {
    previewAccountSheet()
        .frame(width: 720, height: 360)
        .environment(\.verticalSizeClass, UserInterfaceSizeClass.compact)
        .background(BrandColor.canvas)
}

#Preview("Account · iPad width") {
    previewAccountSheet()
        .frame(width: 900, height: 820)
        .background(BrandColor.canvas)
}
