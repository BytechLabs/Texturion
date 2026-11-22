import SwiftUI

/// #733: a header's secondary action: a 44pt paper circle with one symbol (back,
/// attach, edit layout). Pages draw these through this one view;
/// `PageHeaderPatternGuardTests` fails a screen that keeps a paper circle of its own.
/// The tab's main action is `MainActionButton`, never this.
struct PaperIconButton: View {
    let systemImage: String
    let label: String
    var foreground: Color = BrandColor.ink
    let action: @MainActor () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            Self.icon(systemImage: systemImage, foreground: foreground)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    static func icon(systemImage: String, foreground: Color) -> some View {
        Image(systemName: systemImage)
            .font(.scaled(IconSize.standard, weight: .medium))
            .foregroundStyle(foreground)
            .frame(width: 44, height: 44)
            .background(Circle().fill(BrandColor.paper))
    }
}
