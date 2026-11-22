import SwiftUI
import UIKit

struct CopyablePhoneNumber: View {
    let number: String?
    var label: String? = nil
    var struckThrough = false
    var minimumHeight: CGFloat? = nil

    var body: some View {
        Text(label ?? formatPhone(number))
            .strikethrough(struckThrough)
            .frame(minHeight: minimumHeight, alignment: .leading)
            .phoneNumberCopyOnHold(number)
    }
}

extension View {
    @MainActor
    @ViewBuilder
    func phoneNumberCopyOnHold(_ number: String?) -> some View {
        if let number, !number.isEmpty {
            modifier(PhoneNumberCopyGesture(number: number))
        } else {
            self
        }
    }
}

@MainActor
private struct PhoneNumberCopyGesture: ViewModifier {
    let number: String

    @Environment(\.appLocale) private var appLocale

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .onLongPressGesture(perform: copy)
            .accessibilityAction(named: Text(AppStrings.translate(appLocale, "contactsTasks.copyNumber"))) { copy() }
    }

    private func copy() {
        UIPasteboard.general.string = number
        UISelectionFeedbackGenerator().selectionChanged()
        UIAccessibility.post(notification: .announcement, argument: AppStrings.translate(appLocale, "thread.numberCopied"))
    }
}
