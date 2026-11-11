import SwiftUI

/// #740: the photos and files shared with this contact, from their thread's gallery.
/// First rows only, with "Show all" for the rest; a tap opens the file in whatever app
/// handles it. A contact with no thread has none. The Android twin is
/// `ContactFilesSection.kt`.
@MainActor
struct ContactFilesSection: View {
    let graph: AppGraph
    let companyId: String
    let conversationId: String?

    @State private var state: LoadState<[GalleryItem]> = .loading
    @State private var showAll = false
    @State private var refreshKey = 0

    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        content
            // Signed URLs expire, so every visit reads a fresh page rather than a cache.
            .task(id: "\(conversationId ?? "")|\(refreshKey)") { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if conversationId == nil {
            empty
        } else {
            switch state {
            case .loading:
                HStack {
                    Spacer()
                    ProgressView().controlSize(.small)
                    Spacer()
                }
                .padding(.vertical, 12)
            case .failed(let message):
                LoadError(message: message, variant: .inline) { refreshKey += 1 }
                    .padding(.horizontal, 6)
            case .ready(let items):
                if items.isEmpty {
                    empty
                } else {
                    list(items)
                }
            }
        }
    }

    private var empty: some View {
        EmptyState(
            title: AppStrings.translate(appLocale, "contactsTasks.noFilesYet"),
            description: AppStrings.translate(appLocale, "contactsTasks.noFilesYetDetail"),
            systemImage: "photo.on.rectangle",
            size: .panel
        )
    }

    private func list(_ items: [GalleryItem]) -> some View {
        let shown = cappedContactRows(items, showAll: showAll)
        return VStack(alignment: .leading, spacing: 6) {
            PaperCard {
                ForEach(shown, id: \.id) { item in
                    row(item)
                    if item.id != shown.last?.id {
                        RowDivider()
                    }
                }
            }
            if shown.count < items.count {
                Button(
                    AppStrings.translate(
                        appLocale,
                        "contactsTasks.showAll",
                        ["count": String(items.count)]
                    )
                ) { showAll = true }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 6)
            }
        }
    }

    private func row(_ item: GalleryItem) -> some View {
        Button {
            if let url = URL(string: item.url) { openURL(url) }
        } label: {
            HStack(spacing: 11) {
                Image(systemName: isGalleryImage(item) ? "photo" : "doc")
                    .font(.scaled(IconSize.standard))
                    .foregroundStyle(BrandColor.muted500)
                    .accessibilityHidden(true)
                Text(galleryFileName(item))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 15)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let conversationId else { return }
        do {
            let page = try await MessagingRepository(api: graph.api)
                .gallery(companyId: companyId, conversationId: conversationId)
            state = .ready(page.data)
        } catch {
            if case .ready = state {
                // Keep the stale list on a quiet refetch failure.
            } else {
                state = .failed(error.userMessage)
            }
        }
    }
}
