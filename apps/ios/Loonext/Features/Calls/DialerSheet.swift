import SwiftUI

private let keypadRows: [[String]] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
]

/// Classic keypad letter hints (spec 03) — display-only.
private let keypadLetters: [String: String] = [
    "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO",
    "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+",
]

/// The dialer — call ANY US/CA number. From-number chips appear only when the
/// company owns several active numbers (a single-number company lets the
/// server imply it). The mic permission is preflighted BEFORE authorizing, so
/// a denial never reserves the line or bills a minute.
/// Paper & Olive reskin per spec 03: paper key circles, lime call button.
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
                .fill(BrandColor.insetDeep)
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            Text(digits.isEmpty ? "Enter a number" : formatAsYouDial(digits))
                .font(.display(31))
                .foregroundStyle(digits.isEmpty ? BrandColor.muted400 : BrandColor.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
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
                                    .font(.golos(11.5, weight: .semibold))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(
                                        selected ? BrandColor.ink : BrandColor.inset,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        selected ? BrandColor.paper : BrandColor.muted700
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 8)
            }

            VStack(spacing: 12) {
                ForEach(keypadRows, id: \.self) { row in
                    HStack(spacing: 24) {
                        ForEach(row, id: \.self) { key in
                            Button {
                                if digits.count < 15 { digits += key }
                            } label: {
                                VStack(spacing: 0) {
                                    Text(key)
                                        .font(.golos(24, weight: .semibold))
                                        .foregroundStyle(
                                            (key == "*" || key == "#")
                                                ? BrandColor.muted500
                                                : BrandColor.ink
                                        )
                                    if let letters = keypadLetters[key] {
                                        Text(letters)
                                            .font(.golos(8.5, weight: .bold))
                                            .kerning(1.4)
                                            .foregroundStyle(BrandColor.muted300)
                                    }
                                }
                                .frame(width: 72, height: 72)
                                .background(BrandColor.paper, in: Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            HStack {
                Spacer()
                    .frame(maxWidth: .infinity)
                Button(action: preflightThenCall) {
                    Group {
                        if calling {
                            ProgressView()
                                .tint(BrandColor.onLime)
                        } else {
                            Image(systemName: "phone")
                                .font(.system(size: 24, weight: .medium))
                        }
                    }
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 68, height: 68)
                    .background(BrandColor.lime, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(dialable == nil || calling)
                .opacity(dialable == nil ? 0.4 : 1)
                .accessibilityLabel("Call")
                HStack {
                    Spacer()
                    Button {
                        digits = String(digits.dropLast())
                    } label: {
                        Image(systemName: "delete.left")
                            .font(.system(size: 20, weight: .regular))
                            .foregroundStyle(BrandColor.muted500)
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
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            Spacer(minLength: 16)
        }
        .padding(.horizontal, 24)
        .presentationDetents([.large])
        .presentationBackground(BrandColor.canvas)
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

// MARK: - Previews (inline mock numbers — nothing dials until Call is tapped)

private func previewNumber(id: String, e164: String) -> PhoneNumberSummary {
    PhoneNumberSummary(
        id: id,
        status: NumberStatus.active,
        country: "US",
        number_e164: e164,
        requested_area_code: nil,
        created_at: "2026-07-01T00:00:00Z",
        source: nil,
        voice_enabled: true,
        suspended_at: nil,
        released_at: nil,
        failure_reason: nil,
        provision_attempts: nil,
        retrying: nil
    )
}

#Preview("Dialer · two from-numbers") {
    DialerSheet(
        manager: CallsManager.get(graph: AppGraph()),
        numbers: [
            previewNumber(id: "num-1", e164: "+14155550111"),
            previewNumber(id: "num-2", e164: "+14155550122"),
        ]
    )
}

#Preview("Dialer · single number") {
    DialerSheet(
        manager: CallsManager.get(graph: AppGraph()),
        numbers: [previewNumber(id: "num-1", e164: "+14155550111")]
    )
}
