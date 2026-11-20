import AVKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private let maximumZoom: CGFloat = 4
private let zoomStep: CGFloat = 0.5

func attachmentFileName(_ contentType: String) -> String {
    let mime = contentType.split(separator: ";").first.map(String.init) ?? ""
    let fileExtension: String?
    switch mime.lowercased() {
    case "text/vcard", "text/x-vcard": fileExtension = "vcf"
    case "text/calendar": fileExtension = "ics"
    case "audio/mp4": fileExtension = "m4a"
    case "audio/3gpp", "video/3gpp": fileExtension = "3gp"
    default: fileExtension = UTType(mimeType: mime)?.preferredFilenameExtension
    }
    return fileExtension.map { "attachment.\($0)" } ?? "attachment"
}

@MainActor
struct AttachmentViewer: View {
    let label: String
    let contentType: String
    var fileName: String?
    var preview: URL?
    var previewImage: Image?
    let mintOriginal: @MainActor () async throws -> String

    @Environment(\.appLocale) private var appLocale
    @Environment(\.dismiss) private var dismiss
    @State private var original: URL?
    @State private var attempt = 0
    @State private var failed = false
    @State private var zoom: CGFloat = 1

    private var video: Bool { MediaKind.of(contentType) == .video }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(label)
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Spacer()
                iconButton("xmark", key: "common.close") { dismiss() }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 6)

            ZStack(alignment: .bottom) {
                if video, let original, !failed {
                    AttachmentVideo(url: original) { failed = true }
                } else if !video, previewImage != nil || preview != nil || original != nil {
                    ZoomableAttachmentPhoto(
                        label: label, preview: preview, previewImage: previewImage,
                        original: original, zoom: $zoom
                    ) { failed = true }
                } else if !failed {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if failed {
                    Button(text("thread.mediaRetry")) { attempt += 1 }
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .padding(12)
                        .background(BrandColor.paper, in: Capsule())
                        .padding(12)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BrandColor.canvas)

            HStack(spacing: 4) {
                if !video {
                    iconButton("minus.magnifyingglass", key: "thread.zoomOut") {
                        zoom = max(1, zoom - zoomStep)
                    }
                    .disabled(zoom <= 1)
                    Button { zoom = 1 } label: {
                        Text("\(Int((zoom * 100).rounded()))%")
                            .monospacedDigit()
                            .font(.golos(13, weight: .semibold))
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(text("thread.resetZoom"))
                    .disabled(zoom <= 1)
                    iconButton("plus.magnifyingglass", key: "thread.zoomIn") {
                        zoom = min(maximumZoom, zoom + zoomStep)
                    }
                    .disabled((original == nil && preview == nil && previewImage == nil) || zoom >= maximumZoom)
                }
                Spacer(minLength: 2)
                AttachmentSaveButton(
                    fileName: fileName ?? attachmentFileName(contentType),
                    mintOriginal: mintOriginal,
                    withLabel: true
                )
            }
            .foregroundStyle(BrandColor.ink)
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
        }
        .background(BrandColor.paper.ignoresSafeArea())
        .task(id: attempt) {
            original = nil
            failed = false
            do {
                let source = try await mintOriginal()
                try Task.checkCancellation()
                guard let url = URL(string: source), url.scheme == "https" else {
                    throw URLError(.badURL)
                }
                original = url
            } catch is CancellationError {
                return
            } catch {
                failed = true
            }
        }
    }

    private func iconButton(_ icon: String, key: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.scaled(IconSize.standard, weight: .medium))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .foregroundStyle(BrandColor.ink)
        .accessibilityLabel(text(key))
    }

    private func text(_ key: String) -> String { AppStrings.translate(appLocale, key) }
}

private struct ZoomableAttachmentPhoto: View {
    let label: String
    let preview: URL?
    let previewImage: Image?
    let original: URL?
    @Binding var zoom: CGFloat
    let onFailure: () -> Void

    @GestureState private var magnification: CGFloat = 1

    var body: some View {
        GeometryReader { geometry in
            let scale = clampedZoom(zoom * magnification)
            ScrollView([.horizontal, .vertical]) {
                AsyncImage(url: original) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                    case .failure:
                        fallback.onAppear(perform: onFailure)
                    default:
                        fallback
                    }
                }
                .frame(width: geometry.size.width * scale, height: geometry.size.height * scale)
                .accessibilityLabel(label)
            }
            .defaultScrollAnchor(.center)
            .scrollDisabled(scale <= 1)
            .simultaneousGesture(
                MagnifyGesture()
                    .updating($magnification) { value, state, _ in state = value.magnification }
                    .onEnded { value in zoom = clampedZoom(zoom * value.magnification) }
            )
        }
    }

    @ViewBuilder
    private var fallback: some View {
        if let previewImage {
            previewImage.resizable().scaledToFit()
        } else {
            AsyncImage(url: preview) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFit()
                } else if case .empty = phase {
                    ProgressView()
                }
            }
        }
    }

    private func clampedZoom(_ value: CGFloat) -> CGFloat {
        min(maximumZoom, max(1, value))
    }
}

@MainActor
private struct AttachmentVideo: View {
    let url: URL
    let onFailure: () -> Void
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player, let item = player.currentItem {
                VideoPlayer(player: player)
                    .onReceive(item.publisher(for: \.status)) { status in
                        if status == .failed { onFailure() }
                    }
                    .onReceive(NotificationCenter.default.publisher(
                        for: AVPlayerItem.failedToPlayToEndTimeNotification, object: item
                    )) { _ in onFailure() }
            } else {
                ProgressView()
            }
        }
        .task(id: url) { player = AVPlayer(url: url) }
        .onDisappear { player?.pause() }
    }
}

@MainActor
struct AttachmentSaveButton: View {
    let fileName: String
    let mintOriginal: @MainActor () async throws -> String
    var withLabel = false

    @Environment(\.appLocale) private var appLocale
    @State private var saving = false
    @State private var failed = false
    @State private var savedURL: URL?
    @State private var sharing = false

    var body: some View {
        let label = AppStrings.translate(appLocale, "thread.saveAttachment")
        Button {
            saving = true
            Task { await save() }
        } label: {
            Group {
                if saving {
                    ProgressView().accessibilityLabel(AppStrings.translate(appLocale, "thread.savingAttachment"))
                } else if withLabel {
                    Label(label, systemImage: "square.and.arrow.down")
                        .font(.golos(13, weight: .semibold))
                } else {
                    Image(systemName: "square.and.arrow.down")
                        .font(.scaled(IconSize.standard, weight: .medium))
                        .accessibilityLabel(label)
                }
            }
            .foregroundStyle(BrandColor.ink)
            .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.plain)
        .disabled(saving || sharing)
        .sheet(isPresented: $sharing, onDismiss: {
            if let savedURL { try? FileManager.default.removeItem(at: savedURL.deletingLastPathComponent()) }
            savedURL = nil
        }) {
            if let savedURL { AttachmentShareSheet(url: savedURL) }
        }
        .alert(AppStrings.translate(appLocale, "thread.mediaSaveFailed"), isPresented: $failed) {
            Button(AppStrings.translate(appLocale, "common.close"), role: .cancel) {}
        }
    }

    private func save() async {
        defer { saving = false }
        do {
            let source = try await mintOriginal()
            guard let url = URL(string: source), url.scheme == "https" else {
                throw URLError(.badURL)
            }
            let (temporary, response) = try await URLSession.shared.download(from: url)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let name = fileName.replacingOccurrences(of: "/", with: "_")
            let file = directory.appending(path: name.isEmpty || name == "." || name == ".." ? "attachment" : name)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            do {
                try FileManager.default.moveItem(at: temporary, to: file)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
            savedURL = file
            sharing = true
        } catch {
            failed = true
        }
    }
}

private struct AttachmentShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
