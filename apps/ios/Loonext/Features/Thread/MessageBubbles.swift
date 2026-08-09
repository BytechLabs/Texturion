import SwiftUI
import UIKit

/// The actions a message bubble can fire: the context-menu items (iOS idiom
/// for the Android long-press sheet — same actions, same gating rules) plus
/// opening the message's linked task from its tappable task indicator (#217).
struct MessageBubbleActions {
    let onToggleDone: @MainActor () -> Void
    let onTogglePin: @MainActor () -> Void
    let onRetry: @MainActor () -> Void
    let onMakeTask: @MainActor () -> Void
    let onCopied: @MainActor () -> Void
    /// Open the detail of the task this message links to (#217).
    let onOpenTask: @MainActor (String) -> Void
}

/// One message bubble: inbound paper left, outbound ink right, internal note
/// a cream well centered ("Paper & Olive", screens 21/30). Long-press opens
/// the standard iOS context menu with copy / done / pin / retry / make-a-task
/// (the Android action sheet's twin).
struct MessageBubble: View {
    let message: Message
    let authorName: String?
    let doneByName: String?
    let noteFilesState: LoadState<[Attachment]>?
    let onLoadNoteFiles: @MainActor () -> Void
    let onOpenFile: @MainActor (Attachment) -> Void
    /// #240: (attachmentId, variant) — see AttachmentMedia.
    let mintAttachmentUrl: @MainActor (String, String) async throws -> String
    let actions: MessageBubbleActions

    private var outbound: Bool { message.direction == MessageDirection.outbound }
    private var note: Bool { message.direction == MessageDirection.note }
    private var done: Bool { message.done_at != nil }

    var body: some View {
        VStack(alignment: horizontalAlignment, spacing: 2) {
            bubble
                .contextMenu { menuItems }
            MessageMetaLine(
                message: message,
                authorName: authorName,
                doneByName: doneByName,
                onRetry: actions.onRetry,
                onOpenTask: actions.onOpenTask
            )
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
                    Image(systemName: "lock")
                        .font(.scaled(10, weight: .medium))
                        .foregroundStyle(BrandColor.muted700)
                    Text(authorName ?? "Internal note")
                        .font(.golos(11, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                }
            }

            // Inline MMS images — signed URL minted per view, never cached.
            ForEach(imageAttachments, id: \.id) { attachment in
                SignedAttachmentImage(attachmentId: attachment.id, mintUrl: mintAttachmentUrl)
            }

            // Audio plays inline. Everything else that is not an image gets a
            // chip that opens it. Before this, the bubble rendered images only,
            // so a voice message or a PDF a customer sent showed as an empty
            // bubble with nothing in it at all.
            ForEach(audioAttachments, id: \.id) { attachment in
                SignedAudioAttachment(
                    attachmentId: attachment.id,
                    sizeBytes: attachment.size_bytes,
                    mintUrl: mintAttachmentUrl
                )
            }
            ForEach(otherAttachments, id: \.id) { attachment in
                AttachmentFileChip(attachment: attachment, mintUrl: mintAttachmentUrl)
            }

            if !message.body.isBlank {
                Text(message.body)
                    .font(.golos(14))
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
                    Button {
                        actions.onOpenTask(taskLink.id)
                    } label: {
                        Text("on: \(taskLink.title)")
                            .font(.golos(11, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .padding(.top, 2)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open task \(taskLink.title)")
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(bubbleBackground)
        .frame(maxWidth: note ? 340 : 300, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var imageAttachments: [AttachmentSummary] {
        message.attachments.filter { MediaKind.of($0.content_type) == .image }
    }

    private var audioAttachments: [AttachmentSummary] {
        message.attachments.filter { MediaKind.of($0.content_type) == .audio }
    }

    private var otherAttachments: [AttachmentSummary] {
        message.attachments.filter {
            let kind = MediaKind.of($0.content_type)
            return kind != .image && kind != .audio
        }
    }

    private var bodyColor: Color {
        if note { return BrandColor.ink }
        return outbound ? BrandColor.canvas : BrandColor.ink
    }

    @ViewBuilder
    private var bubbleBackground: some View {
        if note {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandColor.cream)
        } else if outbound {
            UnevenRoundedRectangle(
                topLeadingRadius: 20,
                bottomLeadingRadius: 20,
                bottomTrailingRadius: 6,
                topTrailingRadius: 20,
                style: .continuous
            )
            .fill(BrandColor.ink)
        } else {
            UnevenRoundedRectangle(
                topLeadingRadius: 20,
                bottomLeadingRadius: 6,
                bottomTrailingRadius: 20,
                topTrailingRadius: 20,
                style: .continuous
            )
            .fill(BrandColor.paper)
            .shadow(color: BrandColor.inkFixed.opacity(0.05), radius: 2, y: 1)
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
        // #465: done and pinned are STATES, not commands, and as plain Buttons
        // they were indistinguishable from "Copy text" above them. A Toggle in
        // a Menu is the platform's own answer: it draws the checkmark itself,
        // and the label names the state rather than flipping between two verbs.
        Toggle(
            isOn: Binding(
                get: { message.done_at != nil },
                set: { _ in actions.onToggleDone() }
            )
        ) {
            Label("Done", systemImage: "checkmark.circle")
        }
        Toggle(
            isOn: Binding(
                get: { message.pinned_at != nil },
                set: { _ in actions.onTogglePin() }
            )
        ) {
            Label("Pinned", systemImage: "pin")
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
    /// The teammate who sent this, for an outbound message in a shared inbox.
    let authorName: String?
    let doneByName: String?
    let onRetry: @MainActor () -> Void
    let onOpenTask: @MainActor (String) -> Void

    /// The stone task indicator (shared by the plain and tappable arms so the
    /// visual is identical whether or not a link id resolved).
    private var taskIcon: some View {
        Image(systemName: "checklist")
            .font(.scaled(10))
            .foregroundStyle(BrandColor.muted300)
    }

    private var metaText: String {
        // "Dana · 7:18 AM · Delivered", matching the web's order.
        var parts: [String] = []
        if message.direction == MessageDirection.outbound, let authorName {
            parts.append(authorName)
        }
        parts.append(bubbleTime(message.created_at))
        if message.direction == MessageDirection.outbound, let delivery = deliveryLabel(message) {
            parts.append(delivery)
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        let failed = message.status == MessageStatus.failed
        // #241: the reason, not the vendor code it was derived from.
        let optedOut = failed
            && failureReasonOf(message.error_reason, message.error_code) == .optOut

        HStack(spacing: 6) {
            if message.pinned_at != nil {
                Image(systemName: "pin.fill")
                    .font(.scaled(10))
                    .foregroundStyle(BrandColor.muted300)
                    .accessibilityLabel("Pinned")
            }
            if message.has_task || message.promoted_task != nil {
                if let taskId = message.linkedTaskId {
                    Button {
                        onOpenTask(taskId)
                    } label: {
                        // Pad the 10pt glyph to a ~22pt hit target (a bare icon
                        // is far under the 44pt HIG minimum); negative margin
                        // keeps the visual footprint unchanged. Mirrors Android.
                        taskIcon
                            .padding(6)
                            .contentShape(Rectangle())
                            .padding(-6)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open task")
                } else {
                    taskIcon.accessibilityLabel("Has a task")
                }
            }
            Text(metaText)
                .font(.golos(10.5))
                .foregroundStyle(
                    failed && !optedOut
                        ? AnyShapeStyle(BrandColor.destructive)
                        : AnyShapeStyle(BrandColor.muted300)
                )
            if message.retryable {
                Button(action: onRetry) {
                    Text("Retry")
                        .font(.golos(10.5, weight: .bold))
                        .foregroundStyle(BrandColor.destructive)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                        .background(BrandColor.destructiveContainer, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            if message.done_at != nil {
                Text("Done" + (doneByName.map { " · \($0)" } ?? ""))
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted300)
            }
        }
    }
}

/// A locally-queued send awaiting the server's queued row.
///
/// #234: the actions appear only once the message is DURABLY queued — waiting
/// for signal, or stopped and asking. A send that is simply in flight is a
/// second long and offering to cancel it invites a race with its own success.
/// *Applying: the Zen of Clarity — a control appears when there is a decision
/// to make, not on every row that might one day have one.*
struct PendingBubble: View {
    let pending: PendingSend
    var onSendNow: @MainActor () -> Void = {}
    var onDelete: @MainActor () -> Void = {}

    private var statusLine: String {
        if let reason = pending.blockedReason { return reason }
        return pending.queued ? "Queued — will send when you're back online" : "Sending…"
    }

    private var isWaiting: Bool { pending.queued || pending.blockedReason != nil }

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            VStack(alignment: .leading, spacing: 2) {
                if pending.mediaCount > 0 {
                    Text(pending.mediaCount == 1 ? "1 photo" : "\(pending.mediaCount) photos")
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.canvas)
                }
                if !pending.body.isBlank {
                    Text(pending.body)
                        .font(.golos(14))
                        .foregroundStyle(BrandColor.canvas)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                UnevenRoundedRectangle(
                    topLeadingRadius: 20,
                    bottomLeadingRadius: 20,
                    bottomTrailingRadius: 6,
                    topTrailingRadius: 20,
                    style: .continuous
                )
                .fill(BrandColor.ink.opacity(0.65))
            )
            .frame(maxWidth: 300, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)

            // #234: three states, three sentences. A queued message must never
            // read as one that is on its way — that is the whole point of the
            // outbox, and "Sending…" for a phone with no bars is a lie the
            // person only discovers when the customer says nobody got back to
            // them.
            Text(statusLine)
                .font(.golos(10.5))
                .foregroundStyle(
                    pending.blockedReason != nil ? BrandColor.destructive : BrandColor.muted300
                )

            if isWaiting {
                HStack(spacing: 14) {
                    // "Send now" leads because it is what the person wants in
                    // every case that put a control here: the bars came back,
                    // the cap reset, the old message still matters.
                    Button("Send now", action: onSendNow)
                        .font(.golos(11, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                    Button("Delete", action: onDelete)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                }
                .buttonStyle(.plain)
                .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, 16)
        .padding(.vertical, 3)
    }
}

/// Centered system event line ("Dana moved this to Closed").
///
/// #465: a line that NAMES something the reader can go to (a task, the message
/// a done line quotes) takes them there. The rest state has to say so on its
/// own — there is no hover on a phone — so the sentence carries a dotted
/// underline. Lines that name nothing stay exactly as quiet as they were, and
/// stay plain `Text` so VoiceOver does not announce a button that isn't one.
struct EventLine: View {
    let text: String
    let timeIso: String
    /// A transcribed voicemail's words, shown under the line. Nil otherwise.
    var transcript: String?
    /// Where this line goes, if anywhere. Nil leaves the line inert.
    var onTap: (@MainActor () -> Void)?
    /// Read out in place of the bare sentence, so the target is spoken too.
    var tapLabel: String?

    // `.underline` is a Text modifier and must be applied while this is still
    // a Text — after `.foregroundStyle` it no longer is.
    private var sentence: some View {
        Text("\(text) · \(bubbleTime(timeIso))")
            .underline(onTap != nil, pattern: .dot)
            .font(.golos(11))
            .foregroundStyle(BrandColor.muted400)
    }

    var body: some View {
        VStack(spacing: 3) {
            if let onTap {
                Button(action: onTap) { sentence }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tapLabel ?? text)
                    .accessibilityAddTraits(.isButton)
            } else {
                sentence
            }
            // The voicemail's words, right where the message is. Without them
            // this line only says a voicemail exists, which still leaves the
            // reader having to go and play it.
            if let transcript {
                VoicemailTranscript(text: transcript, prominent: true)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 6)
    }
}

/// Centered tracked-uppercase day label ("TODAY") — screens 21/30 drop the
/// hairlines; the label alone carries the break.
struct DayDividerLine: View {
    let label: String

    var body: some View {
        Text(label.uppercased())
            .font(.golos(10.5, weight: .semibold))
            .kerning(1.0)
            .foregroundStyle(BrandColor.muted300)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
    }
}

/// Inline MMS image via a short-lived signed URL minted per view (BINDING:
/// never cached). One automatic re-mint on load failure covers expiry races;
/// after that, an honest tap-to-retry chip.
struct SignedAttachmentImage: View {
    let attachmentId: String
    /// #240: (attachmentId, variant) — audio is streamed whole, so
    /// this one always asks for the original.
    let mintUrl: @MainActor (String, String) async throws -> String

    @State private var url: URL?
    @State private var mintKey = 0
    @State private var autoRetried = false
    @State private var failed = false

    var body: some View {
        Group {
            if failed {
                Text("Photo unavailable — tap to retry")
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
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
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
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
                let minted = try await mintUrl(attachmentId, "original")
                url = URL(string: minted)
                if url == nil { failed = true }
            } catch {
                failed = true
            }
        }
        .padding(.bottom, 4)
    }

    private var loadingPlaceholder: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(BrandColor.avatarTint)
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
                                Image(systemName: "doc")
                                    .font(.scaled(12, weight: .medium))
                                    .foregroundStyle(BrandColor.olive)
                                Text(file.file_name ?? "File")
                                    .font(.golos(11.5, weight: .medium))
                                    .foregroundStyle(BrandColor.olive)
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
