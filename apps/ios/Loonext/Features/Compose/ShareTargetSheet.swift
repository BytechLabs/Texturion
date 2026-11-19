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
        SearchablePickerSheet(
            options: threads.map { thread in
                PickerOption(thread.id, title: thread.contact.name ?? formatPhone(thread.contact.phone_e164))
            },
            selected: nil,
            title: AppStrings.translate(locale, "thread.shareToThread"),
            searchPrompt: AppStrings.translate(locale, "common.pickerSearch"),
            onPick: onSelect,
            onDismiss: onCancel,
            search: $search,
            loading: loading,
            loadError: loadError,
            emptyMessage: AppStrings.translate(locale, "thread.noShareThreads")
        )
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
