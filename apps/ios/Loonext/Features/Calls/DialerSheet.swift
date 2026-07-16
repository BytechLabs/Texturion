import SwiftUI

private let keypadRows: [[String]] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
]

/// The dialer — call ANY US/CA number. From-number chips appear only when the
/// company owns several active numbers (a single-number company lets the
/// server imply it). The mic permission is preflighted BEFORE authorizing, so
/// a denial never reserves the line or bills a minute.
@MainActor
struct DialerSheet: View {
    let manager: CallsManager
    let numbers: [PhoneNumberSummary]

    @Environment(\.dismiss) private var dismiss

    @State private var digits = ""
    @State private var fromId: String?
    @State private var calling = false
    @State private var errorText: String?

    init(manager: CallsManager, numbers: [PhoneNumberSummary]) {
        self.manager = manager
        self.numbers = numbers
        _fromId = State(initialValue: numbers.first?.id)
    }

    private var dialable: String? { dialableE164(digits) }

    var body: some View {
        VStack(spacing: 8) {
            Capsule()
                .fill(.quaternary)
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            Text(digits.isEmpty ? "Enter a number" : formatAsYouDial(digits))
                .font(.title2.weight(.semibold))
                .foregroundStyle(digits.isEmpty ? Color.secondary : Color.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .monospacedDigit()

            if numbers.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(numbers, id: \.id) { number in
                            let selected = fromId == number.id
                            Button {
                                fromId = number.id
                            } label: {
                                Text("From \(formatPhone(number.number_e164))")
                                    .font(.caption)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(
                                        selected
                                            ? AnyShapeStyle(BrandColor.petrolContainer)
                                            : AnyShapeStyle(.quaternary.opacity(0.5)),
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        selected
                                            ? BrandColor.onPetrolContainer
                                            : Color.secondary
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 8)
            }

            ForEach(keypadRows, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            if digits.count < 15 { digits += key }
                        } label: {
                            Text(key)
                                .font(.title2)
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                    }
                }
            }

            HStack {
                Spacer()
                    .frame(maxWidth: .infinity)
                Button(action: preflightThenCall) {
                    if calling {
                        ProgressView()
                            .tint(BrandColor.onPetrol)
                            .frame(width: 30, height: 30)
                            .padding(17)
                    } else {
                        Image(systemName: "phone.fill")
                            .font(.title2)
                            .foregroundStyle(BrandColor.onPetrol)
                            .frame(width: 30, height: 30)
                            .padding(17)
                    }
                }
                .glassEffect(.regular.tint(BrandColor.petrol).interactive())
                .disabled(dialable == nil || calling)
                .opacity(dialable == nil ? 0.4 : 1)
                .accessibilityLabel("Call")
                HStack {
                    Spacer()
                    Button {
                        digits = String(digits.dropLast())
                    } label: {
                        Image(systemName: "delete.left")
                            .font(.title3)
                    }
                    .disabled(digits.isEmpty)
                    .accessibilityLabel("Delete last digit")
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.top, 8)

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            Spacer(minLength: 16)
        }
        .padding(.horizontal, 24)
        .presentationDetents([.large])
    }

    /// Mic first, then authorize — a denial never reserves the line.
    private func preflightThenCall() {
        guard dialable != nil else { return }
        if manager.hasMicPermission {
            placeCall()
            return
        }
        Task {
            if await manager.requestMicPermission() {
                placeCall()
            } else {
                errorText = "Loonext needs the microphone to place calls. "
                    + "Allow it in Settings › Loonext."
            }
        }
    }

    private func placeCall() {
        guard let to = dialable else { return }
        errorText = nil
        calling = true
        Task {
            defer { calling = false }
            do {
                try await manager.placeCall(
                    displayName: formatPhone(to),
                    to: to,
                    // Pin a caller-ID number only when the company owns
                    // several; otherwise the server implies the one number.
                    phoneNumberId: numbers.count > 1 ? fromId : nil
                )
                dismiss()
            } catch {
                // Gate refusals arrive coded (usage_cap_reached,
                // subscription_inactive, conflict "line on another call",
                // validation_failed) with honest server copy — show it.
                errorText = error.userMessage
            }
        }
    }
}
