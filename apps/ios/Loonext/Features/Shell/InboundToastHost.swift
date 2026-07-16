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
func inboundToastLine(
    contactName: String?,
    body: String?,
    hasAttachments: Bool,
    maxLength: Int = 90
) -> String {
    let trimmedName = contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let who = trimmedName.isEmpty ? "New message" : trimmedName
    let text = (body ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    let snippet: String
    if !text.isEmpty {
        snippet = text
    } else if hasAttachments {
        snippet = "Sent a photo"
    } else {
        snippet = "Sent a message"
    }
    let line = "\(who): \(snippet)"
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

    var body: some View {
        ZStack {
            if let toast {
                HStack(spacing: 12) {
                    Text(toast.line)
                        .font(.subheadline)
                        .lineLimit(1)
                    Button("View") {
                        self.toast = nil
                        onView(toast.conversationId)
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect()
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

            toast = InboundToast(
                conversationId: conversationId,
                line: inboundToastLine(
                    contactName: detail.contact.name ?? formatPhone(detail.contact.phone_e164),
                    body: newestInbound.body,
                    hasAttachments: !newestInbound.attachments.isEmpty
                )
            )
        }
    }
}
