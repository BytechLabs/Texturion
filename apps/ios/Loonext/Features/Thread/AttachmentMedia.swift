import AVFoundation
import SwiftUI

/// A playable audio attachment in a thread bubble.
///
/// Founder report (live device): a customer sent a voice message and there was
/// nowhere in the app to hear it. Worse than the web chip, the iOS bubble
/// rendered only images, so an audio message was invisible: the thread showed
/// an empty bubble. A voice message is a message and belongs in the bubble.
///
/// The signed URL is minted per view and never cached, exactly like
/// `SignedAttachmentImage`. Playback streams from that URL, so nothing is
/// downloaded until someone presses play.
/// The audio row's caption.
///
/// #272: pure and shared-shaped so the failed wording is asserted rather than
/// assumed, and so it matches the Android twin exactly — a voice message should
/// read the same on both phones. Android's string carries a middle dot; iOS used
/// a comma, which is the sort of drift nobody notices until a screenshot puts
/// the two side by side.
func audioRowCaption(failed: Bool) -> String {
    failed ? "Audio unavailable · tap to retry" : "Audio message"
}

@MainActor
struct SignedAudioAttachment: View {
    let attachmentId: String
    let sizeBytes: Int?
    /// #240: (attachmentId, variant). "preview" for anything rendered in
    /// the timeline; "original" when the bytes leave for another app.
    let mintUrl: @MainActor (String, String) async throws -> String

    @State private var player: AVPlayer?
    @State private var playing = false
    @State private var progress: Double = 0
    @State private var mintKey = 0
    @State private var failed = false

    @Environment(\.appLocale) private var appLocale

    /// Drives the progress bar. A half-second tick is plenty for a clip and
    /// avoids a periodic time observer (which would have to hop actors).
    private let tick = Timer.publish(every: 0.5, on: .main, in: .common)
        .autoconnect()

    var body: some View {
        HStack(spacing: 10) {
            Button(action: toggle) {
                Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill")
                    .font(.scaled(30))
                    .foregroundStyle(BrandColor.olive)
            }
            .buttonStyle(.plain)
            .disabled(player == nil && !failed)
            .accessibilityLabel(
                AppStrings.translate(
                    appLocale,
                    playing ? "thread.pauseAudio" : "thread.playAudio"
                )
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(audioRowCaption(failed: failed))
                    .font(.golos(12.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                ProgressView(value: min(max(progress, 0), 1))
                    .tint(BrandColor.olive)
                    .frame(height: 2)
                let size = formatBytes(sizeBytes)
                if !size.isEmpty {
                    Text(size)
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
        }
        .frame(maxWidth: 240, alignment: .leading)
        .padding(.bottom, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            guard failed else { return }
            failed = false
            player = nil
            mintKey += 1
        }
        .task(id: "\(attachmentId)|\(mintKey)") {
            guard player == nil, !failed else { return }
            do {
                let minted = try await mintUrl(attachmentId, "preview")
                guard let url = URL(string: minted) else {
                    failed = true
                    return
                }
                player = AVPlayer(url: url)
            } catch {
                failed = true
            }
        }
        .onReceive(tick) { _ in
            guard playing, let player, let item = player.currentItem else { return }
            // #272: a URL that cannot be reached fails at LOAD, so no end-time
            // notification ever arrives. The status is the deterministic signal —
            // checked here rather than on a timeout heuristic, because "we waited
            // a while and nothing happened" is not the same claim.
            if item.status == .failed {
                markFailed()
                return
            }
            let duration = item.duration.seconds
            guard duration.isFinite, duration > 0 else { return }
            progress = player.currentTime().seconds / duration
        }
        // #272: the failure arm. AVPlayer(url:) never throws at construction and
        // nothing here observed the ITEM, so a dead zone or an expired signed URL
        // left the icon showing "pause", the bar at 0, no sound and no error —
        // and the retry tap was gated on `failed`, so it was unreachable. The
        // Android twin has surfaced this through setOnErrorListener all along.
        .onReceive(
            NotificationCenter.default.publisher(
                for: AVPlayerItem.failedToPlayToEndTimeNotification
            )
        ) { note in
            guard let item = note.object as? AVPlayerItem,
                  item === player?.currentItem else { return }
            markFailed()
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: AVPlayerItem.didPlayToEndTimeNotification
            )
        ) { note in
            // Only OUR item ending resets THIS row (a thread can hold several).
            guard let item = note.object as? AVPlayerItem,
                  item === player?.currentItem else { return }
            playing = false
            progress = 0
            player?.seek(to: .zero)
        }
        .onDisappear {
            player?.pause()
            playing = false
        }
    }

    /// #272: one place that puts the row into its failed state, so the three
    /// booleans cannot disagree — `playing` staying true while nothing plays is
    /// exactly what made the bug invisible. Dropping the player lets `.task`
    /// re-mint on retry.
    private func markFailed() {
        playing = false
        progress = 0
        player = nil
        failed = true
    }

    private func toggle() {
        guard let player, !failed else { return }
        // #272: an item that already failed to load must not flip the icon to
        // "pause". Surface the retry instead of pretending.
        if let item = player.currentItem, item.status == .failed {
            markFailed()
            return
        }
        if playing {
            player.pause()
            playing = false
            return
        }
        // Without .playback a clip is silenced by the ring/silent switch, which
        // reads as "the player is broken". Never touch the session while a call
        // owns it (.playAndRecord) — the softphone's audio comes first.
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord {
            try? session.setCategory(.playback, mode: .spokenAudio)
            try? session.setActive(true)
        }
        player.play()
        playing = true
    }
}

/// A non-image, non-audio MMS attachment: a calm chip that opens the signed URL
/// in the system viewer. Without this, a PDF or a contact card a customer sent
/// simply did not appear in the thread.
@MainActor
struct AttachmentFileChip: View {
    let attachment: AttachmentSummary
    /// MMS media has no generic `Attachment` row behind it, so the chip mints
    /// its own short-lived URL and hands it to the system viewer.
    /// #240: (attachmentId, variant). "preview" for anything rendered in
    /// the timeline; "original" when the bytes leave for another app.
    let mintUrl: @MainActor (String, String) async throws -> String

    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale
    @State private var opening = false

    private var kind: MediaKind { MediaKind.of(attachment.content_type) }

    var body: some View {
        Button {
            guard !opening else { return }
            opening = true
            Task {
                defer { opening = false }
                // Opening a chip hands the file to another app — that is
                // the FILE, not a picture of it.
                if let minted = try? await mintUrl(attachment.id, "original"),
                   let url = URL(string: minted) {
                    openURL(url)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: kind.symbolName)
                    .font(.scaled(13, weight: .medium))
                    .foregroundStyle(BrandColor.muted700)
                VStack(alignment: .leading, spacing: 1) {
                    Text(attachmentLabel(kind: kind, count: 1))
                        .font(.golos(12.5, weight: .medium))
                        .foregroundStyle(BrandColor.ink)
                    let size = formatBytes(attachment.size_bytes)
                    if !size.isEmpty {
                        Text(size)
                            .font(.golos(10.5))
                            .foregroundStyle(BrandColor.muted500)
                    }
                }
                Spacer(minLength: 0)
                if opening {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.down.circle")
                        .font(.scaled(13))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: 240, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BrandColor.cream)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            AppStrings.translate(
                appLocale,
                "thread.openAttachment",
                ["kind": attachmentLabel(kind: kind, count: 1).lowercased()]
            )
        )
        .padding(.bottom, 4)
    }
}
