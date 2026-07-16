import SwiftUI
import UIKit

/// The actions a message's context menu can fire (iOS idiom for the Android
/// long-press sheet — same actions, same gating rules).
struct MessageBubbleActions {
    let onToggleDone: @MainActor () -> Void
    let onTogglePin: @MainActor () -> Void
    let onRetry: @MainActor () -> Void
    let onMakeTask: @MainActor () -> Void
    let onCopied: @MainActor () -> Void
}

/// One message bubble: inbound hairline left, outbound flat petrol right,
/// note amber centered. Long-press opens the standard iOS context menu with
/// copy / done / pin / retry / make-a-task (the Android action sheet's twin).
struct MessageBubble: View {
    let message: Message
    let authorName: String?
    let doneByName: String?
    let noteFilesState: LoadState<[Attachment]>?
    let onLoadNoteFiles: @MainActor () -> Void
    let onOpenFile: @MainActor (Attachment) -> Void
    let mintAttachmentUrl: @MainActor (String) async throws -> String
    let actions: MessageBubbleActions

    private var outbound: Bool { message.direction == MessageDirection.outbound }
    private var note: Bool { message.direction == MessageDirection.note }
    private var done: Bool { message.done_at != nil }

    var body: some View {
        VStack(alignment: horizontalAlignment, spacing: 2) {
            bubble
                .contextMenu { menuItems }
            MessageMetaLine(message: message, doneByName: doneByName, onRetry: actions.onRetry)
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
        .padding(.horizontal, 16)
        .padding(.vertical, 3)
    }

    private var horizontalAlignment: HorizontalAlignment {
        if note { return .center }
        return outbound ? .trailing : .leading
    }

    private var frameAlignment: Alignment {
        if note { return .center }
        return outbound ? .trailing : .leading
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if note {
                HStack(spacing: 4) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(NoteAmber.ink)
                    Text(authorName ?? "Internal note")
                        .font(.caption)
                        .foregroundStyle(NoteAmber.ink)
                }
            }

            // Inline MMS images — signed URL minted per view, never cached.
            ForEach(imageAttachments, id: \.id) { attachment in
                SignedAttachmentImage(attachmentId: attachment.id, mintUrl: mintAttachmentUrl)
            }

            if !message.body.isBlank {
                Text(message.body)
                    .font(.body)
                    .foregroundStyle(bodyColor)
                    .strikethrough(done)
            }

            if note {
                NoteFilesSection(
                    noteId: message.id,
                    state: noteFilesState,
                    onLoad: onLoadNoteFiles,
                    onOpenFile: onOpenFile
                )
                if let taskLink = message.task ?? message.promoted_task {
                    Text("on: \(taskLink.title)")
                        .font(.caption)
                        .foregroundStyle(NoteAmber.ink)
                        .padding(.top, 2)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(bubbleBackground)
        .frame(maxWidth: note ? 340 : 300, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var imageAttachments: [AttachmentSummary] {
        message.attachments.filter { $0.content_type.hasPrefix("image/") }
    }

    private var bodyColor: Color {
        if note { return .primary }
        return outbound ? BrandColor.onPetrol : .primary
    }

    @ViewBuilder
    private var bubbleBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 16)
        if note {
            shape
                .fill(NoteAmber.bg)
                .overlay(shape.strokeBorder(NoteAmber.line, lineWidth: 1))
        } else if outbound {
            shape.fill(BrandColor.petrol)
        } else {
            shape
                .fill(Color(.systemBackground))
                .overlay(shape.strokeBorder(Color(.separator), lineWidth: 0.5))
        }
    }

    @ViewBuilder
    private var menuItems: some View {
        if !message.body.isBlank {
            Button {
                UIPasteboard.general.string = message.body
                actions.onCopied()
            } label: {
                Label("Copy text", systemImage: "doc.on.doc")
            }
        }
        Button {
            actions.onToggleDone()
        } label: {
            Label(
                message.done_at == nil ? "Mark done" : "Mark not done",
                systemImage: message.done_at == nil ? "circle" : "checkmark.circle.fill"
            )
        }
        Button {
            actions.onTogglePin()
        } label: {
            Label(
                message.pinned_at == nil ? "Pin message" : "Unpin message",
                systemImage: "pin"
            )
        }
        if message.retryable {
            Button {
                actions.onRetry()
            } label: {
                Label("Retry send", systemImage: "arrow.clockwise")
            }
        }
        if !message.has_task, message.promoted_task == nil,
           message.direction != MessageDirection.note {
            Button {
                actions.onMakeTask()
            } label: {
                Label("Make a task", systemImage: "checklist")
            }
        }
    }
}

/// The quiet line under a bubble: time · delivery state · done · pin · task.
private struct MessageMetaLine: View {
    let message: Message
    let doneByName: String?
    let onRetry: @MainActor () -> Void

    private var metaText: String {
        var parts = [bubbleTime(message.created_at)]
        if message.direction == MessageDirection.outbound, let delivery = deliveryLabel(message) {
            parts.append(delivery)
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        let failed = message.status == MessageStatus.failed
        let optedOut = failed && message.error_code == carrierOptOutErrorCode

        HStack(spacing: 6) {
            if message.pinned_at != nil {
                Image(systemName: "pin.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Pinned")
            }
            if message.has_task || message.promoted_task != nil {
                Image(systemName: "checklist")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Has a task")
            }
            Text(metaText)
                .font(.caption2)
                .foregroundStyle(
                    failed && !optedOut
                        ? AnyShapeStyle(BrandColor.destructive)
                        : AnyShapeStyle(Color.secondary)
                )
            if message.retryable {
                Button("Retry", action: onRetry)
                    .font(.caption2)
                    .foregroundStyle(BrandColor.destructive)
                    .buttonStyle(.plain)
            }
            if message.done_at != nil {
                Text("Done" + (doneByName.map { " · \($0)" } ?? ""))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// A locally-queued send awaiting the server's queued row.
struct PendingBubble: View {
    let pending: PendingSend

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            VStack(alignment: .leading, spacing: 2) {
                if pending.mediaCount > 0 {
                    Text(pending.mediaCount == 1 ? "1 photo" : "\(pending.mediaCount) photos")
                        .font(.caption)
                        .foregroundStyle(BrandColor.onPetrol)
                }
                if !pending.body.isBlank {
                    Text(pending.body)
                        .font(.body)
                        .foregroundStyle(BrandColor.onPetrol)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(BrandColor.petrol.opacity(0.65))
            )
            .frame(maxWidth: 300, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)

            Text("Sending…")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, 16)
        .padding(.vertical, 3)
    }
}

/// Centered system event line ("Dana moved this to Closed").
struct EventLine: View {
    let text: String
    let timeIso: String

    var body: some View {
        Text("\(text) · \(bubbleTime(timeIso))")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 6)
    }
}

/// Hairline day divider with a centered label.
struct DayDividerLine: View {
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(Color(.separator))
                .frame(height: 0.5)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize()
            Rectangle()
                .fill(Color(.separator))
                .frame(height: 0.5)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

/// Inline MMS image via a short-lived signed URL minted per view (BINDING:
/// never cached). One automatic re-mint on load failure covers expiry races;
/// after that, an honest tap-to-retry chip.
struct SignedAttachmentImage: View {
    let attachmentId: String
    let mintUrl: @MainActor (String) async throws -> String

    @State private var url: URL?
    @State private var mintKey = 0
    @State private var autoRetried = false
    @State private var failed = false

    var body: some View {
        Group {
            if failed {
                Text("Photo unavailable — tap to retry")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .onTapGesture {
                        autoRetried = false
                        url = nil
                        mintKey += 1
                    }
            } else if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(maxWidth: 240)
                            .frame(height: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    case .failure:
                        loadingPlaceholder
                            .onAppear {
                                if autoRetried {
                                    failed = true
                                } else {
                                    autoRetried = true
                                    self.url = nil
                                    mintKey += 1
                                }
                            }
                    default:
                        loadingPlaceholder
                    }
                }
            } else {
                loadingPlaceholder
            }
        }
        .task(id: "\(attachmentId)|\(mintKey)") {
            guard url == nil, !failed else { return }
            do {
                let minted = try await mintUrl(attachmentId)
                url = URL(string: minted)
                if url == nil { failed = true }
            } catch {
                failed = true
            }
        }
        .padding(.bottom, 4)
    }

    private var loadingPlaceholder: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Color(.secondarySystemFill))
            .frame(width: 220, height: 140)
            .overlay(ProgressView())
    }
}

/// The Files section on a note bubble (D19 generic attachments).
struct NoteFilesSection: View {
    let noteId: String
    let state: LoadState<[Attachment]>?
    let onLoad: @MainActor () -> Void
    let onOpenFile: @MainActor (Attachment) -> Void

    var body: some View {
        Group {
            switch state {
            case .ready(let files) where !files.isEmpty:
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(files, id: \.id) { file in
                        Button {
                            onOpenFile(file)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "doc.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(NoteAmber.ink)
                                Text(file.file_name ?? "File")
                                    .font(.caption)
                                    .foregroundStyle(NoteAmber.ink)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 6)
            default:
                // Loading/failed stay quiet: the note body is the content.
                EmptyView()
            }
        }
        .onAppear { onLoad() }
    }
}
