import SwiftUI

// MARK: - Pure decision + copy (the Android InboundToastLogic.kt twin)

/// Toast only a real customer text that landed OUTSIDE the thread the user is
/// looking at:
///  - `message.created` events only,
///  - inbound direction only (own sends and notes are not news),
///  - never for the conversation currently on screen (its thread shows the
///    bubble itself — a toast on top would be noise),
///  - a payload with no conversation id can't be routed — skip it.
///
/// The realtime payload is treated as an ID-only routing hint (SPEC §8):
/// these fields steer WHETHER to toast; the toast's content comes from a
/// refetch through the authed API.
func shouldToastInbound(
    eventName: String,
    conversationId: String?,
    direction: String?,
    viewedConversationId: String?
) -> Bool {
    if eventName != "message.created" { return false }
    guard conversationId != nil else { return false }
    if direction != MessageDirection.inbound { return false }
    return conversationId != viewedConversationId
}

/// The toast's one line: "Dana: Sure, 3pm works" — name (or formatted
/// number), a colon, and the message body trimmed to one line. A media-only
/// text says what arrived instead of showing an empty snippet.
///
/// #228: STILL ENGLISH, and deliberately left out of the catalogue for now.
/// The media half of this sentence is assembled from `attachmentLabel` — which
/// lives outside this file and is read by the inbox, the thread and the media
/// view too — and then given an English article by a rule that reads the noun's
/// first letter. French needs gender rather than a vowel ("une photo", "un
/// PDF", "un message vocal"), so translating this is a rewrite of a shared
/// label vocabulary rather than an extraction of these lines. Recorded here
/// rather than half-done: a French toast with an English noun in the middle of
/// it is worse than an English toast.
private func inboundToastNounKey(_ kind: MediaKind?, many: Bool) -> String {
    let suffix = many ? "Many" : "One"
    let stem = switch kind {
    case .image: "Image"
    case .audio: "Audio"
    case .video: "Video"
    case .contact: "Contact"
    case .calendar: "Calendar"
    case .document: "Document"
    case .text: "Text"
    case .file, .none: "File"
    }
    return "shell.inboundToast\(stem)\(suffix)"
}

func inboundToastLine(
    contactName: String?,
    body: String?,
    hasAttachments: Bool,
    maxLength: Int = 90,
    /// #271: the kind that arrived, when known; nil takes the neutral wording.
    attachmentKind: MediaKind? = nil,
    attachmentCount: Int = 1,
    locale: String = MessageLocale.en
) -> String {
    let trimmedName = contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let who = trimmedName.isEmpty
        ? AppStrings.translate(locale, "shell.inboundToastNewMessage")
        : trimmedName
    let text = (body ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    let snippet: String
    if !text.isEmpty {
        snippet = text
    } else if hasAttachments {
        // #271: "Sent a photo" was wrong for every non-image attachment, a
        // voice message included. iOS already shipped attachmentLabel and
        // sharedMediaKind and used them in the inbox, the thread, the bubbles
        // and the media view — the toast was the one caller that was missed,
        // so a 20-second voice message announced itself as a snapshot.
        // Ported from the Android twin so both banners read identically.
        let many = attachmentCount > 1
        let noun = AppStrings.translate(
            locale,
            inboundToastNounKey(attachmentKind, many: many)
        )
        snippet = AppStrings.translate(
            locale,
            many ? "shell.inboundToastSentMany" : "shell.inboundToastSentOne",
            ["count": String(max(attachmentCount, 1)), "noun": noun]
        )
    } else {
        snippet = AppStrings.translate(locale, "shell.inboundToastSentMessage")
    }
    let line = AppStrings.translate(
        locale,
        "shell.inboundToastLine",
        ["who": who, "snippet": snippet]
    )
    if line.count <= maxLength { return line }
    var head = String(line.prefix(maxLength - 1))
    while let last = head.last, last.isWhitespace {
        head.removeLast()
    }
    return head + "…"
}

// MARK: - Host

private struct InboundToast: Equatable {
    let id = UUID()
    let conversationId: String
    let line: String
}

/// The global inbound-message toast (#165) — Android's
/// InboundMessageToastHost ported: while the app is open, a customer text
/// landing in any conversation the user is NOT looking at surfaces as a
/// one-line banner with a View action (the web's toast-outside-the-thread
/// parity). The realtime payload only routes; the line's content (who + what)
/// is refetched through the authed API, and the toast is suppressed when its
/// thread is on screen (`AppRouter.shared.viewedConversationId`).
///
/// The shell mounts this ONCE above the tab bar (alongside `CallsOverlay`);
/// `onView` routes into the thread.
@MainActor
struct InboundToastHost: View {
    let graph: AppGraph
    let companyId: String
    let onView: @MainActor (String) -> Void

    @State private var toast: InboundToast?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ZStack {
            if let toast {
                HStack(spacing: 12) {
                    Text(toast.line)
                        .font(.golos(13, weight: .medium))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    Button {
                        self.toast = nil
                        onView(toast.conversationId)
                    } label: {
                        Text(AppStrings.translate(appLocale, "shell.toastView"))
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(BrandColor.paper, in: Capsule())
                .shadow(color: BrandColor.inkFixed.opacity(0.18), radius: 12, x: 0, y: 4)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.default, value: toast)
        .task(id: companyId) { await listen() }
        .task(id: toast?.id) {
            // Auto-dismiss — the Android SnackbarDuration.Short twin.
            guard toast != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { toast = nil }
        }
    }

    private func listen() async {
        let repo = MessagingRepository(api: graph.api)
        for await event in await graph.realtime.events() {
            let conversationId = event.payload["conversation_id"]?.stringValue
            let direction = event.payload["direction"]?.stringValue
            guard shouldToastInbound(
                eventName: event.event,
                conversationId: conversationId,
                direction: direction,
                viewedConversationId: AppRouter.shared.viewedConversationId
            ), let conversationId else { continue }

            // ID-only payload → refetch who + what through the API. A fetch
            // failure just skips the toast — the push/badge paths still tell
            // the story, and a wrong guess would be worse than silence.
            guard let detail = try? await repo.detail(
                companyId: companyId,
                conversationId: conversationId
            ) else { continue }
            guard let newestInbound = detail.messages.data.first(where: {
                $0.direction == MessageDirection.inbound
            }) else { continue }

            // Re-check after the fetch: the user may have opened this thread
            // while the detail was in flight.
            if AppRouter.shared.viewedConversationId == conversationId { continue }

            // #271: the kinds, so the banner names what arrived. Mirrors the
            // Android call site exactly.
            let kinds = newestInbound.attachments.map { MediaKind.of($0.content_type) }
            toast = InboundToast(
                conversationId: conversationId,
                line: inboundToastLine(
                    contactName: detail.contact.name ?? formatPhone(detail.contact.phone_e164),
                    body: newestInbound.body,
                    hasAttachments: !kinds.isEmpty,
                    attachmentKind: sharedMediaKind(kinds),
                    attachmentCount: kinds.count,
                    locale: appLocale
                )
            )
        }
    }
}
