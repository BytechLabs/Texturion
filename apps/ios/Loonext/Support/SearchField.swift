import SwiftUI

/// #733: the one search box. A magnifier inside on the left, a clear button on the
/// right once there is something to clear, and focus kept in the field when it is
/// cleared so the keyboard does not drop. Every list, picker and the settings home
/// draw this (web: `SearchField`).
///
/// The caller passes the placeholder it already resolves from the catalogue, and a
/// `maxLength` where the server caps the query. A system `.searchable` on a
/// navigation stack is a different control and stays where a screen uses it; the
/// guard names those.
struct SearchField: View {
    @Binding var query: String
    let placeholder: String
    var maxLength: Int?
    var clearLabel: String?

    @FocusState private var focused: Bool
    @Environment(\.appLocale) private var appLocale

    init(
        query: Binding<String>,
        placeholder: String,
        maxLength: Int? = nil,
        clearLabel: String? = nil
    ) {
        self._query = query
        self.placeholder = placeholder
        self.maxLength = maxLength
        self.clearLabel = clearLabel
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(IconSize.standard, weight: .medium))
                .foregroundStyle(BrandColor.muted700)
                .accessibilityHidden(true)
            TextField(placeholder, text: $query)
                .font(.golos(13.5))
                .foregroundStyle(BrandColor.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                // The whole height of the box is the field, not the line of text.
                .frame(minHeight: 44)
                .accessibilityLabel(placeholder)
                .onChange(of: query) { _, next in
                    if let maxLength, next.count > maxLength {
                        query = String(next.prefix(maxLength))
                    }
                }
            if !query.isEmpty {
                Button {
                    query = ""
                    focused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.scaled(IconSize.standard))
                        .foregroundStyle(BrandColor.muted700)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(
                    clearLabel ?? AppStrings.translate(appLocale, "common.clearSearch")
                )
            }
        }
        .padding(.leading, 15)
        .padding(.trailing, query.isEmpty ? 15 : 2)
        .background(BrandColor.paper, in: Capsule())
    }
}

#Preview("Search field") {
    @Previewable @State var query = "Rivera"
    return SearchField(query: $query, placeholder: "Search")
        .padding()
        .background(BrandColor.canvas)
}
