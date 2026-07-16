import SwiftUI

// MARK: - Pure gallery helpers (Android GalleryLogic.kt twin)

/// The gallery's two views (web parity: an Images | Files toggle).
enum GalleryViewMode: String, CaseIterable, Identifiable, Sendable {
    case images = "Images"
    case files = "Files"

    var id: String { rawValue }
    var label: String { rawValue }
}

/// Server-tagged kind — `kind` is authoritative ("image" vs "file").
func isGalleryImage(_ item: GalleryItem) -> Bool {
    item.kind == "image"
}

/// The rows one toggle position shows.
func galleryItemsFor(_ view: GalleryViewMode, _ items: [GalleryItem]) -> [GalleryItem] {
    switch view {
    case .images: items.filter { isGalleryImage($0) }
    case .files: items.filter { !isGalleryImage($0) }
    }
}

/// A file row's display name — MMS attachments have no file_name on record.
func galleryFileName(_ item: GalleryItem) -> String {
    if let name = item.file_name, !name.isBlank { return name }
    return item.source == "mms" ? "Text-message attachment" : "Attachment"
}

/// "312 B" / "48 KB" / "2.4 MB" — nil when the size wasn't recorded.
func gallerySizeLabel(_ sizeBytes: Int?) -> String? {
    guard let sizeBytes, sizeBytes >= 0 else { return nil }
    if sizeBytes < 1024 { return "\(sizeBytes) B" }
    if sizeBytes < 1024 * 1024 { return "\((sizeBytes + 512) / 1024) KB" }
    let mb = Double(sizeBytes) / (1024.0 * 1024.0)
    return String(format: "%.1f MB", locale: Locale(identifier: "en_US_POSIX"), mb)
}

// MARK: - Screen

/// "Photos & files": the conversation gallery over
/// GET /v1/conversations/:id/attachments — MMS photos + note/task files in one
/// newest-first stream, split by an Images | Files toggle. Every visit
/// refetches, which is the per-view signed-URL mint (item URLs are short-lived
/// by design and never cached). Items open externally via the system opener.
@MainActor
struct AttachmentsGalleryView: View {
    let repo: MessagingRepository
    let companyId: String
    let conversationId: String
    let contactName: String
    let onBack: @MainActor () -> Void

    @State private var view: GalleryViewMode = .images
    @State private var state: LoadState<[GalleryItem]> = .loading
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var refreshKey = 0
    // Presented full-screen, so quiet failures need their own toast — the
    // thread's notice channel would be invisible beneath the cover.
    @State private var noticeText: String?
    @State private var noticeDismissTask: Task<Void, Never>?

    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                header
                Picker("View", selection: $view) {
                    ForEach(GalleryViewMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)

                content
            }
            if let noticeText {
                Text(noticeText)
                    .font(.footnote)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 24)
                    .onTapGesture { self.noticeText = nil }
            }
        }
        .task(id: "\(conversationId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                let page = try await repo.gallery(
                    companyId: companyId,
                    conversationId: conversationId
                )
                nextCursor = page.next_cursor
                state = .ready(page.data)
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("Back to conversation")
            VStack(alignment: .leading, spacing: 1) {
                Text("Photos & files")
                    .font(.subheadline.weight(.semibold))
                Text(contactName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { refreshKey += 1 }
        case .ready(let items):
            let rows = galleryItemsFor(view, items)
            if rows.isEmpty {
                // Honest empty state; with older pages unloaded the copy says
                // "yet loaded" and offers the next page.
                VStack(spacing: 12) {
                    Text(emptyLabel)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    if nextCursor != nil {
                        loadMoreRow
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if view == .images {
                imagesGrid(rows)
            } else {
                filesList(rows)
            }
        }
    }

    private var emptyLabel: String {
        switch (view, nextCursor != nil) {
        case (.images, true): "No photos loaded yet."
        case (.images, false): "No photos in this conversation yet."
        case (.files, true): "No files loaded yet."
        case (.files, false): "No files in this conversation yet."
        }
    }

    private func imagesGrid(_ items: [GalleryItem]) -> some View {
        ScrollView {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3),
                spacing: 4
            ) {
                ForEach(items, id: \.id) { item in
                    Button {
                        open(item)
                    } label: {
                        Color(.secondarySystemFill)
                            .overlay(
                                AsyncImage(url: URL(string: item.url)) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image.resizable().aspectRatio(contentMode: .fill)
                                    case .failure:
                                        Image(systemName: "photo")
                                            .foregroundStyle(.secondary)
                                    default:
                                        ProgressView()
                                    }
                                }
                            )
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.file_name ?? "Photo")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            if nextCursor != nil {
                loadMoreRow
            }
        }
    }

    private func filesList(_ items: [GalleryItem]) -> some View {
        List {
            ForEach(items, id: \.id) { item in
                Button {
                    open(item)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "doc")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(galleryFileName(item))
                                .font(.body)
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Text(
                                [gallerySizeLabel(item.size_bytes), relativeTime(item.created_at)]
                                    .compactMap { $0 }
                                    .filter { !$0.isEmpty }
                                    .joined(separator: " · ")
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            if nextCursor != nil {
                loadMoreRow
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
    }

    private var loadMoreRow: some View {
        HStack {
            Spacer()
            if loadingMore {
                ProgressView()
            } else {
                Button("Load more") { loadMore() }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandColor.petrol)
            }
            Spacer()
        }
        .padding(.vertical, 8)
    }

    private func loadMore() {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        Task {
            do {
                let page = try await repo.gallery(
                    companyId: companyId,
                    conversationId: conversationId,
                    cursor: cursor
                )
                nextCursor = page.next_cursor
                if case .ready(let existing) = state {
                    state = .ready(appendPage(existing, page.data) { $0.id })
                }
            } catch {
                notify(error.userMessage)
            }
            loadingMore = false
        }
    }

    private func open(_ item: GalleryItem) {
        guard let url = URL(string: item.url) else {
            notify("This file can't be opened.")
            return
        }
        openURL(url)
    }

    private func notify(_ text: String) {
        noticeText = text
        noticeDismissTask?.cancel()
        noticeDismissTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { noticeText = nil }
        }
    }
}

#Preview("Files list") {
    List {
        ForEach(
            [
                GalleryItem(
                    id: "a",
                    source: "note",
                    kind: "file",
                    file_name: "quote.pdf",
                    content_type: "application/pdf",
                    size_bytes: 48 * 1024,
                    created_at: "2026-07-15T12:00:00Z",
                    url: "https://signed.example/a"
                ),
                GalleryItem(
                    id: "b",
                    source: "mms",
                    kind: "file",
                    file_name: nil,
                    content_type: nil,
                    size_bytes: nil,
                    created_at: "2026-07-14T09:00:00Z",
                    url: "https://signed.example/b"
                ),
            ],
            id: \.id
        ) { item in
            HStack(spacing: 12) {
                Image(systemName: "doc")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(galleryFileName(item))
                        .font(.body)
                    Text(gallerySizeLabel(item.size_bytes) ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
    .listStyle(.plain)
}
