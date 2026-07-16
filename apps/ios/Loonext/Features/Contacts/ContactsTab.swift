import SwiftUI

/// Contacts list with debounced name/phone search + opted-out badges.
@MainActor
struct ContactsTab: View {
    let graph: AppGraph
    let companyId: String

    @State private var query = ""
    @State private var state: LoadState<[Contact]> = .loading
    @State private var refreshKey = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search name or number", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
            case .ready(let contacts):
                if contacts.isEmpty {
                    Text(query.isBlank ? "No contacts yet." : "No matches for \"\(query)\".")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(contacts, id: \.id) { contact in
                            ContactRow(contact: contact)
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
        .task(id: "\(companyId)|\(query)|\(refreshKey)") { await reload() }
    }

    private func reload() async {
        if !query.isEmpty {
            // Debounce typing.
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
        }
        do {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let page = try await graph.contactsApi.contacts(
                companyId: companyId,
                q: trimmed.isEmpty ? nil : trimmed
            )
            state = .ready(page.data)
        } catch {
            state = .failed(error.userMessage)
        }
    }
}

private struct ContactRow: View {
    let contact: Contact

    private var name: String {
        contact.name ?? formatPhone(contact.phone_e164)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            InitialsAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.body)
                Text(formatPhone(contact.phone_e164))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                if let lastActivity = contact.last_activity_at {
                    Text(relativeTime(lastActivity))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if contact.opted_out {
                    Text("Opted out")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.quaternary.opacity(0.6), in: Capsule())
                }
            }
        }
        .padding(.vertical, 4)
    }
}
