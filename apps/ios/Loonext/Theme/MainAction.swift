import SwiftUI

/// #732: a tab's ONE main action. Inbox "New text", Calls "Dial", Tasks "New
/// task" and Contacts "New contact" are each this button, in the same corner:
/// a 54pt ink circle at the bottom-trailing edge, clear of the nav pill. Only
/// the symbol and its spoken label differ. The web draws the same thing as the
/// single filled button at the trailing end of the page header.
///
/// Every tab reaches it through `.mainAction(...)` and nothing else;
/// `MainActionWiringTests` pins that, so a fifth hand-built circle cannot appear.
enum MainAction {
    static let size: CGFloat = 54
    static let trailing: CGFloat = 18
    static let bottom: CGFloat = 12
}

struct MainActionButton: View {
    let systemImage: String
    let label: String
    let action: @MainActor () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.scaled(IconSize.large, weight: .medium))
                .foregroundStyle(BrandColor.paper)
                .frame(width: MainAction.size, height: MainAction.size)
                .background(BrandColor.ink, in: Circle())
                .shadow(color: BrandColor.inkFixed.opacity(0.28), radius: 14, x: 0, y: 8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension View {
    /// The tab's main action, bottom-trailing. `isVisible` is for the one case
    /// where it yields: the inbox hides it while global search is showing.
    func mainAction(
        systemImage: String,
        label: String,
        isVisible: Bool = true,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        overlay(alignment: .bottomTrailing) {
            if isVisible {
                MainActionButton(systemImage: systemImage, label: label, action: action)
                    .padding(.trailing, MainAction.trailing)
                    .padding(.bottom, MainAction.bottom)
            }
        }
    }
}
