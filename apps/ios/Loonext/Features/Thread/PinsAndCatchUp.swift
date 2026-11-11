import SwiftUI

// #716: pins as one collapsed row, and Lou's catch-up as one line above the
// composer. Neither stacks chrome above the first message: the pins are one row
// until opened, and the catch-up offer sits beside the input.

// MARK: - Rules

/// Pins newest-pin-first, as the web stack lists them.
func pinsNewestFirst(_ messages: [Message]) -> [Message] {
    messages
        .filter { $0.pinned_at != nil }
        .sorted { ($0.pinned_at ?? "") > ($1.pinned_at ?? "") }
}

/// The newest customer-visible message somebody else sent. The hint comes back
/// when this changes: the member's own reply is not news they need a recap of.
func newestMessageIdFromOthers(_ messages: [Message], meUserId: String) -> String? {
    let others = messages.filter {
        ($0.direction == MessageDirection.inbound || $0.direction == MessageDirection.outbound)
            && $0.sent_by_user_id != meUserId
    }
    let newest = others.max { lhs, rhs in
        let l = parseWireTimestamp(lhs.created_at) ?? Date.distantPast
        let r = parseWireTimestamp(rhs.created_at) ?? Date.distantPast
        return l == r ? lhs.id < rhs.id : l < r
    }
    return newest?.id
}

/// Whether the one-line offer shows: the shared offer rule says so, nothing is
/// being asked or already answered on screen, and the newest message from
/// someone else is one the reader has not already waved the offer off for.
func catchUpHintShown(
    offered: Bool,
    recapOpen: Bool,
    newestFromOthersId: String?,
    answeredId: String?
) -> Bool {
    offered && !recapOpen && newestFromOthersId != nil && answeredId != newestFromOthersId
}

// MARK: - Remembered per conversation

/// Whether each conversation was left with its pins open on this device.
enum PinsOpenStore {
    static func key(_ conversationId: String) -> String {
        "loonext.thread-pins-open.\(conversationId)"
    }

    static func read(_ conversationId: String, defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: key(conversationId))
    }

    static func write(_ open: Bool, conversationId: String, defaults: UserDefaults = .standard) {
        defaults.set(open, forKey: key(conversationId))
    }
}

/// The message each conversation's catch-up hint was last answered for.
enum CatchUpAnswerStore {
    static func key(_ conversationId: String) -> String {
        "loonext.catch-up-answered.\(conversationId)"
    }

    static func read(_ conversationId: String, defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: key(conversationId))
    }

    static func write(_ messageId: String, conversationId: String, defaults: UserDefaults = .standard) {
        defaults.set(messageId, forKey: key(conversationId))
    }
}

// MARK: - Pinned stack

/// Pins as a stack. One row shows the newest pin and how many more there are,
/// and opens the full list on demand; each conversation remembers whether it
/// was left open. A single pin is just that pin, one tap from the message.
/// Pinned lives in the warm cream well ("Paper & Olive").
@MainActor
struct PinnedStack: View {
    let conversationId: String
    let pinned: [Message]
    let onJump: @MainActor (String) -> Void

    @State private var expanded: Bool
    @Environment(\.appLocale) private var appLocale

    init(
        conversationId: String,
        pinned: [Message],
        onJump: @escaping @MainActor (String) -> Void
    ) {
        self.conversationId = conversationId
        self.pinned = pinned
        self.onJump = onJump
        _expanded = State(initialValue: PinsOpenStore.read(conversationId))
    }

    /// A media-only pinned message is named by what it carries, not "Photo".
    private func pinnedPreview(_ message: Message) -> String {
        guard message.body.isBlank else { return message.body }
        let kinds = message.attachments.map { MediaKind.of($0.content_type) }
        guard !kinds.isEmpty else { return message.body }
        return attachmentLabel(
            kind: sharedMediaKind(kinds) ?? .file,
            count: kinds.count
        )
    }

    var body: some View {
        if let newest = pinned.first {
            let older = pinned.count - 1
            VStack(spacing: 0) {
                if older == 0 {
                    Button {
                        onJump(newest.id)
                    } label: {
                        collapsedRow(newest, older: 0)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(pinnedPreview(newest))
                } else {
                    Button {
                        withAnimation { expanded.toggle() }
                        PinsOpenStore.write(expanded, conversationId: conversationId)
                    } label: {
                        collapsedRow(newest, older: older)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "\(pinnedPreview(newest)), \(moreLabel(older))"
                    )
                    .accessibilityHint(
                        AppStrings.translate(
                            appLocale,
                            expanded ? "thread.collapsePinned" : "thread.expandPinned"
                        )
                    )

                    if expanded {
                        ForEach(pinned, id: \.id) { message in
                            Button {
                                onJump(message.id)
                            } label: {
                                HStack(spacing: 8) {
                                    Text(pinnedPreview(message))
                                        .font(.golos(12.5))
                                        .foregroundStyle(BrandColor.ink)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(bubbleTime(message.created_at))
                                        .font(.golos(10.5))
                                        .foregroundStyle(BrandColor.muted400)
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .background(BrandColor.cream, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
        }
    }

    private func moreLabel(_ count: Int) -> String {
        AppStrings.translate(appLocale, "thread.morePinnedAria", ["count": String(count)])
    }

    private func collapsedRow(_ newest: Message, older: Int) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "pin.fill")
                .font(.scaled(IconSize.small))
                .foregroundStyle(BrandColor.muted700)
            Text(pinnedPreview(newest))
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.muted900)
                .lineLimit(1)
            Spacer(minLength: 8)
            if older > 0 {
                CountPill("+\(older)")
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.scaled(IconSize.small, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

// MARK: - Catch-up hint

/// Lou offering a catch-up, as one line above the composer. It asks for nothing
/// by itself: Recap is the press that spends a call, and Not now is never a
/// dead end, because the conversation sheet keeps Catch me up.
@MainActor
struct CatchUpHint: View {
    let onRecap: @MainActor () -> Void
    let onNotNow: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(spacing: 8) {
            AiOrb(state: .idle, size: 14)
            Text(AppStrings.translate(appLocale, "thread.catchUpHint"))
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted700)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button(action: onRecap) {
                Text(AppStrings.translate(appLocale, "thread.catchUpRecap"))
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .padding(.horizontal, 6)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: onNotNow) {
                Text(AppStrings.translate(appLocale, "thread.notNow"))
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted500)
                    .padding(.horizontal, 6)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .background(
            BrandColor.inset,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .padding(.horizontal, 18)
        .padding(.vertical, 3)
    }
}

extension ThreadCatchUpState {
    /// Nothing has been asked, or the answer was put away.
    var isIdle: Bool {
        if case .idle = self { return true }
        return false
    }
}
