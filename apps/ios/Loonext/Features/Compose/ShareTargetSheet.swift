import SwiftUI

struct ShareTargetSheet: View {
    let repository: MessagingRepository
    let companyId: String
    let onSelect: (String) -> Void
    let onCancel: () -> Void

    @Environment(\.appLocale) private var locale
    @State private var search = ""
    @State private var threads: [ConversationListItem] = []
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    ProgressView()
                } else if let loadError {
                    Text(loadError)
                } else if threads.isEmpty {
                    Text(AppStrings.translate(locale, "thread.noShareThreads"))
                } else {
                    ForEach(threads, id: \.id) { thread in
                        Button {
                            onSelect(thread.id)
                        } label: {
                            Text(thread.contact.name ?? formatPhone(thread.contact.phone_e164))
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: Text(AppStrings.translate(locale, "common.pickerSearch")))
            .navigationTitle(AppStrings.translate(locale, "thread.shareToThread"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(locale, "common.cancel"), action: onCancel)
                }
            }
        }
        .interactiveDismissDisabled()
        .task(id: search) {
            loading = true
            loadError = nil
            do {
                let query = String(search.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
                if !query.isEmpty { try await Task.sleep(for: .milliseconds(250)) }
                let page = try await repository.shareTargets(companyId: companyId, search: query)
                try Task.checkCancellation()
                threads = page.data
            } catch {
                if Task.isCancelled { return }
                loadError = error.userMessage(locale)
            }
            loading = false
        }
    }
}
