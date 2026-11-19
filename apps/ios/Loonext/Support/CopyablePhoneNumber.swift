import SwiftUI
import UIKit

struct CopyablePhoneNumber: View {
    let number: String?
    var label: String? = nil
    var struckThrough = false
    var minimumHeight: CGFloat? = nil

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let text = label ?? formatPhone(number)
        if let number, !number.isEmpty {
            Button {
                UIPasteboard.general.string = number
            } label: {
                Text(text)
                    .strikethrough(struckThrough)
                    .frame(minHeight: minimumHeight, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text)
            .accessibilityHint(AppStrings.translate(appLocale, "contactsTasks.copyNumber"))
        } else {
            Text(text).strikethrough(struckThrough)
        }
    }
}

extension View {
    func phoneNumberCopyMenu(_ number: String?) -> some View {
        contextMenu {
            if let number, !number.isEmpty {
                CopyPhoneNumberAction(number: number)
            }
        }
    }
}

struct CopyPhoneNumberAction: View {
    let number: String
    var label: String? = nil

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Button(label ?? AppStrings.translate(appLocale, "contactsTasks.copyNumber"), systemImage: "doc.on.doc") {
            UIPasteboard.general.string = number
        }
    }
}
