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

/// Height the full-size dialer layout needs (#180). Viewports at or above it
/// render the spec exactly; shorter/square ones scale the keys, spacing, the
/// readout, and the call disc down proportionally so everything stays reachable
/// (the Android DialerSheet twin — design height 620, floor 0.55).
private let dialerDesignHeight: CGFloat = 620

/// Floor for the proportional scale; below it the backstop scroll takes over.
private let minDialerScale: CGFloat = 0.55

/// The dialer — call ANY US/CA number. From-number chips appear only when the
/// company owns several active numbers (a single-number company lets the
/// server imply it). The mic permission is preflighted BEFORE authorizing, so
/// a denial never reserves the line or bills a minute.
/// Paper & Olive reskin per spec 03: paper key circles, lime call button.
@MainActor
struct DialerSheet: View {
    let manager: CallsManager
    let numbers: [PhoneNumberSummary]
    /// #459: who the typed digits could be, best first. The caller searches
    /// the crew's own contacts with `t9: true` so the keypad's letters find
    /// names, and ranks the result through the shared matcher — "dial by name"
    /// IS this list.
    var lookupMatches: (@MainActor (String) async -> [DialerMatch])?
    /// Offer "Add contact" for a dialable, unmatched typed number (#186 item 5).
    var onAddContact: (@MainActor (String) -> Void)?
    /// #459: text this number instead of calling it.
    var onMessage: (@MainActor (String) -> Void)?
    /// #459: open a contact we already have on file.
    var onOpenContact: (@MainActor (String) -> Void)?
    /// #459: leave the keypad for the contacts list.
    var onOpenContacts: (@MainActor () -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    @State private var digits = ""
    @State private var fromId: String?
    @State private var calling = false
    @State private var errorText: String?
    /// #459: the ranked matches for what has been typed.
    @State private var matches: [DialerMatch] = []
    /// Whoever was tapped in the list. Separate from the digits so editing the
    /// number after picking somebody drops the pick — a call that went to the
    /// person you tapped rather than the number on screen would be a call
    /// nobody could explain.
    @State private var picked: DialerMatch?

    init(
        manager: CallsManager,
        numbers: [PhoneNumberSummary],
        lookupMatches: (@MainActor (String) async -> [DialerMatch])? = nil,
        onAddContact: (@MainActor (String) -> Void)? = nil,
        onMessage: (@MainActor (String) -> Void)? = nil,
        onOpenContact: (@MainActor (String) -> Void)? = nil,
        onOpenContacts: (@MainActor () -> Void)? = nil
    ) {
        self.manager = manager
        self.numbers = numbers
        self.lookupMatches = lookupMatches
        self.onAddContact = onAddContact
        self.onMessage = onMessage
        self.onOpenContact = onOpenContact
        self.onOpenContacts = onOpenContacts
        _fromId = State(initialValue: numbers.first?.id)
    }

    /// Who the actions act on: whoever was picked, else the best match.
    private var target: DialerMatch? { picked ?? matches.first }
    private var matchedName: String? { target?.name }

    private var dialable: String? { dialableE164(digits) }

    var body: some View {
        // #180: the keypad derives from the available space. At or above the
        // design height scale == 1 and the sheet is pixel-identical to the
        // spec; on short/square viewports the keys, spacing, readout, and call
        // disc shrink together. The vertical scroll is the backstop below the
        // scale floor, so every control stays reachable at any ratio.
        GeometryReader { proxy in
            let scale = min(max(proxy.size.height / dialerDesignHeight, minDialerScale), 1)
            let keySpacing = 24 * scale
            let keySize = min(72 * scale, (proxy.size.width - 48 - keySpacing * 2) / 3)
            ScrollView {
                dialerColumn(scale: scale, keySize: keySize, keySpacing: keySpacing)
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
            }
        }
        // Opens FULLY EXPANDED (#186 item 5) — the single large detent.
        .presentationDetents([.large])
        .presentationBackground(BrandColor.canvas)
        // Debounced live contact correlation as the digits change.
        .task(id: digits) {
            guard let lookupMatches else { return }
            let typed = digits.filter(\.isNumber)
            // TWO digits, not four: two keys is a normal way to reach for a
            // name. The matcher keeps the four-digit floor for a NUMBER match.
            if typed.count < 2 {
                matches = []
                return
            }
            try? await Task.sleep(for: .milliseconds(250)) // debounce keypad taps
            if Task.isCancelled { return }
            matches = await lookupMatches(String(typed))
        }
    }

    /// The dialer column, its geometry scaled from the available height (#180).
    @ViewBuilder
    private func dialerColumn(scale: CGFloat, keySize: CGFloat, keySpacing: CGFloat) -> some View {
        VStack(spacing: 8 * scale) {
            Capsule()
                .fill(BrandColor.insetDeep)
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            Text(
                digits.isEmpty
                    ? t("contactsTasks.enterANumber")
                    : formatAsYouDial(digits)
            )
                .font(.display(31 * scale))
                .foregroundStyle(digits.isEmpty ? BrandColor.muted400 : BrandColor.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity)
                .padding(.top, 12 * scale)
                .padding(.bottom, 2)
                .monospacedDigit()

            // Live correlation (#186 item 5): the matched contact name while
            // dialing, or an Add-contact affordance once the number is dialable
            // and unknown. Fixed height so the keypad never jumps.
            correlationRow
                .frame(height: 26)
                .padding(.bottom, 4 * scale)

            // #459: who this could be, best first — the list that makes the
            // keypad a name search. Between the readout and the keys, where
            // every system dialer has put it for fifteen years. Capped at four
            // by the matcher; the height cap keeps the keys reachable when all
            // four land.
            if !matches.isEmpty {
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(matches) { match in
                            matchRow(match)
                        }
                    }
                }
                .frame(maxHeight: 132)
                .padding(.horizontal, 8)
                .padding(.bottom, 6 * scale)
            }

            if numbers.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(numbers, id: \.id) { number in
                            let selected = fromId == number.id
                            Button {
                                Haptics.tap()
                                fromId = number.id
                            } label: {
                                Text(
                                    t(
                                        "contactsTasks.fromNumber",
                                        ["number": formatPhone(number.number_e164)]
                                    )
                                )
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

            VStack(spacing: 12 * scale) {
                ForEach(keypadRows, id: \.self) { row in
                    HStack(spacing: keySpacing) {
                        ForEach(row, id: \.self) { key in
                            Button {
                                Haptics.tap()
                                if digits.count < 15 {
                                    picked = nil
                                    digits += key
                                }
                            } label: {
                                VStack(spacing: 0) {
                                    Text(key)
                                        .font(.golos(keySize * 0.34, weight: .semibold))
                                        .foregroundStyle(
                                            (key == "*" || key == "#")
                                                ? BrandColor.muted500
                                                : BrandColor.ink
                                        )
                                    if let letters = keypadLetters[key] {
                                        Text(letters)
                                            .font(.golos(keySize * 0.12, weight: .bold))
                                            .kerning(1.4)
                                            .foregroundStyle(BrandColor.muted300)
                                    }
                                }
                                .frame(width: keySize, height: keySize)
                                .background(BrandColor.paper, in: Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            HStack {
                // #459: the other verb, mirroring backspace on the right so the
                // call disc stays centred. A trades crew texts more than it
                // calls; this is secondary only because the screen is the
                // dialer, not because texting matters less.
                HStack {
                    Spacer()
                    if let onMessage {
                        Button {
                            Haptics.tap()
                            if let to = picked?.number ?? dialable {
                                dismiss()
                                onMessage(to)
                            }
                        } label: {
                            Image(systemName: "message")
                                .font(.scaled(20, weight: .regular))
                                .foregroundStyle(BrandColor.muted500)
                        }
                        .disabled(dialable == nil && picked == nil)
                        .accessibilityLabel(t("contactsTasks.sendMessageInstead"))
                    }
                    Spacer()
                }
                .frame(maxWidth: .infinity)
                Button(action: preflightThenCall) {
                    Group {
                        if calling {
                            ProgressView()
                                .tint(BrandColor.onLime)
                        } else {
                            Image(systemName: "phone")
                                .font(.scaled(24 * scale, weight: .medium))
                        }
                    }
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 68 * scale, height: 68 * scale)
                    .background(BrandColor.lime, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(dialable == nil || calling)
                .opacity(dialable == nil ? 0.4 : 1)
                .accessibilityLabel(t("contactsTasks.call"))
                HStack {
                    Spacer()
                    Button {
                        Haptics.tap()
                        picked = nil
                        digits = String(digits.dropLast())
                    } label: {
                        Image(systemName: "delete.left")
                            .font(.scaled(20, weight: .regular))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .disabled(digits.isEmpty)
                    .accessibilityLabel(t("contactsTasks.deleteLastDigit"))
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.top, 8 * scale)

            // #459: the two ways out of the keypad. "Add contact" appears only
            // for a dialable number we do NOT have, because offering to save
            // somebody already on file is an offer that does nothing.
            HStack {
                if let onOpenContacts {
                    Button {
                        dismiss()
                        onOpenContacts()
                    } label: {
                        Label(t("contactsTasks.contactsTitle"), systemImage: "person.2")
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.muted700)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                if let contactId = target?.contactId, let onOpenContact {
                    Button {
                        dismiss()
                        onOpenContact(contactId)
                    } label: {
                        Text(t("contactsTasks.openContact"))
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .buttonStyle(.plain)
                } else if target == nil, let onAddContact, let addTarget = dialable {
                    Button {
                        onAddContact(addTarget)
                    } label: {
                        Label(
                            t("contactsTasks.addContact"),
                            systemImage: "person.badge.plus"
                        )
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 6)

            if let errorText {
                Text(errorText)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            Spacer(minLength: 16)
        }
    }

    /// One row of the #459 match list: who this could be, and the number it
    /// dials. The number sits beside the name rather than behind it — a crew
    /// has the same customer under two numbers often enough that a name alone
    /// is not an answer, and the row's whole promise is that tapping it dials
    /// the right one.
    @ViewBuilder
    private func matchRow(_ match: DialerMatch) -> some View {
        Button {
            picked = match
            digits = String(match.number.filter(\.isNumber).prefix(15))
        } label: {
            HStack(spacing: 10) {
                Text(match.name)
                    .font(.golos(14, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(formatPhone(match.number))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(
                picked?.number == match.number ? BrandColor.inset : BrandColor.canvas,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The matched contact name. Empty otherwise — the fixed-height slot holds
    /// the layout. "Add contact" lives in the row below the keypad now: two
    /// identical offers on one screen is one too many.
    @ViewBuilder
    private var correlationRow: some View {
        if let matchedName {
            Text(matchedName)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .lineLimit(1)
        } else {
            Color.clear
        }
    }

    /// Mic first, then authorize — a denial never reserves the line.
    private func preflightThenCall() {
        guard dialable != nil else { return }
        // COMMITTED, and fired before the permission detour rather than after
        // the call connects: this is the beat that answers "did it take my
        // press", on the one screen where the answer can otherwise be a
        // permission sheet appearing several hundred milliseconds later.
        Haptics.confirm()
        if manager.hasMicPermission {
            placeCall()
            return
        }
        Task {
            if await manager.requestMicPermission() {
                placeCall()
            } else {
                errorText = t("contactsTasks.micNeededToPlace")
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

// #180 responsive matrix — fixed frames drive the GeometryReader scale so the
// keypad, readout, and call disc stay reachable at every ratio.

#Preview("Dialer · 1:1 square") {
    DialerSheet(
        manager: CallsManager.get(graph: AppGraph()),
        numbers: [previewNumber(id: "num-1", e164: "+14155550111")]
    )
    .frame(width: 380, height: 380)
    .background(BrandColor.canvas)
}

#Preview("Dialer · landscape") {
    DialerSheet(
        manager: CallsManager.get(graph: AppGraph()),
        numbers: [
            previewNumber(id: "num-1", e164: "+14155550111"),
            previewNumber(id: "num-2", e164: "+14155550122"),
        ]
    )
    .frame(width: 740, height: 360)
    .background(BrandColor.canvas)
}

#Preview("Dialer · small phone") {
    DialerSheet(
        manager: CallsManager.get(graph: AppGraph()),
        numbers: [previewNumber(id: "num-1", e164: "+14155550111")]
    )
    .frame(width: 320, height: 568)
    .background(BrandColor.canvas)
}
