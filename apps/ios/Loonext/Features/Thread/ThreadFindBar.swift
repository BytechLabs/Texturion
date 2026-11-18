import SwiftUI

struct ThreadFindResults: Decodable, Sendable {
    struct Match: Decodable, Sendable {
        let id: String
    }

    let data: [Match]
    let truncated: Bool
}

@MainActor
struct ThreadFindBar: View {
    let initialQuery: String
    let initialMessage: String?
    let find: (String) async throws -> ThreadFindResults
    let onJump: (String) -> Void
    let onClose: () -> Void

    @State private var edit: String?
    @State private var selected: String?
    @State private var result: ThreadFindResults?
    @State private var failed = false
    @Environment(\.appLocale) private var appLocale

    private var input: String { edit ?? initialQuery }
    private var query: String { input.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var matches: [ThreadFindResults.Match] { result?.data ?? [] }
    private var index: Int? {
        matches.firstIndex { $0.id == (selected ?? (edit == nil ? initialMessage : nil)) }
    }

    private var status: String {
        guard !query.isEmpty else { return "" }
        if failed { return t("thread.findError") }
        guard let result else { return t("thread.findSearching") }
        let count = String(matches.count) + (result.truncated ? "+" : "")
        if let index {
            return t("thread.findPosition", ["position": String(index + 1), "count": count])
        }
        return t("thread.findMatches", ["count": count])
    }

    var body: some View {
        HStack(spacing: 4) {
            SearchField(
                query: Binding(get: { input }, set: { value in
                    let changed = value.trimmingCharacters(in: .whitespacesAndNewlines) != query
                    edit = value
                    if changed {
                        selected = nil
                        result = nil
                        failed = false
                    }
                }),
                placeholder: t("thread.findInThread"),
                maxLength: 200,
                clearLabel: t("common.clearSearch")
            )
            if !status.isEmpty {
                Text(status).font(.golos(11)).foregroundStyle(BrandColor.muted600)
            }
            findButton("chevron.up", label: "thread.findPrevious") { step(-1) }
                .disabled(matches.isEmpty)
            findButton("chevron.down", label: "thread.findNext") { step(1) }
                .disabled(matches.isEmpty)
            findButton("xmark", label: "thread.findClose", action: onClose)
        }
        .padding(.horizontal, 10)
        .task(id: query) {
            let current = query
            guard !current.isEmpty else { return }
            do {
                try await Task.sleep(for: .milliseconds(250))
                let hits = try await find(current)
                if !Task.isCancelled { result = hits }
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }

    private func t(_ key: String, _ values: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, values)
    }

    private func findButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.scaled(IconSize.small, weight: .medium))
                .frame(width: 36, height: 44)
        }
        .accessibilityLabel(t(label))
    }

    private func step(_ offset: Int) {
        guard !matches.isEmpty else { return }
        let current = index ?? (offset < 0 ? 0 : -1)
        let match = matches[(current + offset + matches.count) % matches.count]
        selected = match.id
        onJump(match.id)
    }
}
