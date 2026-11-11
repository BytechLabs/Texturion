import SwiftUI

/// #736: arranging the For you page, on the phone.
///
/// ## What binds it
///
/// *Direct manipulation* — every tap saves and the screen changes under the
/// member's thumb; there is no Save step to forget. The change is announced to
/// VoiceOver without moving focus.
///
/// *Zen of Clarity* — none of this is on screen until "Edit layout" is pressed.
/// The page is one column on a phone, so "move earlier / later" replaces
/// dragging (a drag cannot be done with VoiceOver, and a long list scrolls under
/// the finger), and the stored width — a third, two thirds or full — is the one
/// the laptop draws, cycled by one button.
///
/// *Chunking* — four controls per panel in two short rows, each a 44pt target.
///
/// Mirrors `apps/android/.../features/foryou/LayoutEditor.kt` and
/// `apps/web/src/components/for-you/for-you-view.tsx`.

/// The four controls above one panel while the page is being arranged.
@MainActor
struct PanelEditBar: View {
    let label: String
    let sizeLabel: String
    let onEarlier: @MainActor () -> Void
    let onLater: @MainActor () -> Void
    let onResize: @MainActor () -> Void
    let onRemove: @MainActor () -> Void
    /// A panel with content shows its own heading; only an empty one needs
    /// naming here. The controls' spoken names carry it either way.
    var showsName: Bool = true

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if showsName {
                    Text(label)
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Spacer(minLength: 0)
                }
                iconButton("xmark", name: removeName, action: onRemove)
            }
            HStack(spacing: 4) {
                iconButton("chevron.up", name: earlierName, action: onEarlier)
                iconButton("chevron.down", name: laterName, action: onLater)
                Spacer(minLength: 0)
                resizeButton
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .padding(.vertical, 2)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 14))
    }

    private var earlierName: String {
        AppStrings.translate(appLocale, "inbox.forYouMoveEarlier", ["panel": label])
    }

    private var laterName: String {
        AppStrings.translate(appLocale, "inbox.forYouMoveLater", ["panel": label])
    }

    private var removeName: String {
        AppStrings.translate(appLocale, "inbox.forYouRemovePanel", ["panel": label])
    }

    private var resizeName: String {
        AppStrings.translate(
            appLocale,
            "inbox.forYouResizePanel",
            ["panel": label, "size": sizeLabel]
        )
    }

    private func iconButton(
        _ symbol: String,
        name: String,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.scaled(IconSize.standard, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
    }

    private var resizeButton: some View {
        Button(action: onResize) {
            Text(sizeLabel)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(resizeName)
    }
}

/// "Waiting on you: 4 waiting, not on your page" and the way to bring it back.
@MainActor
struct OffPageLine: View {
    let text: String
    let action: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: action) {
                Text(AppStrings.translate(appLocale, "inbox.forYouShowPanel"))
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 6)
    }
}

/// The hint, the panels that can be added, and the way back to the default.
@MainActor
struct LayoutToolbar: View {
    let addable: [String]
    let failed: Bool
    let onAdd: @MainActor (String) -> Void
    let onReset: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(AppStrings.translate(appLocale, "inbox.forYouEditingHintPhone"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .padding(.horizontal, 6)
            if failed {
                Text(AppStrings.translate(appLocale, "inbox.forYouLayoutSaveFailed"))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.destructive)
                    .padding(.horizontal, 6)
            }
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(label: AppStrings.translate(appLocale, "inbox.forYouAddPanel"))
                PaperCard {
                    if addable.isEmpty {
                        Text(AppStrings.translate(appLocale, "inbox.forYouAddPanelNone"))
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted500)
                            .padding(12)
                    }
                    ForEach(Array(addable.enumerated()), id: \.element) { index, id in
                        if index > 0 { RowDivider() }
                        addRow(id)
                    }
                }
            }
            Button(action: onReset) {
                Text(AppStrings.translate(appLocale, "inbox.forYouResetLayout"))
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(BrandColor.paper, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private func addRow(_ id: String) -> some View {
        let label = DashboardLayouts.label(id, locale: appLocale)
        let note = DashboardLayouts.note(id, locale: appLocale)
        return Button(action: { onAdd(id) }) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.golos(13.5, weight: .medium))
                        .foregroundStyle(BrandColor.muted700)
                    Text(note)
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "plus")
                    .font(.scaled(IconSize.small, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label). \(note)")
        .accessibilityAddTraits(.isButton)
    }
}
