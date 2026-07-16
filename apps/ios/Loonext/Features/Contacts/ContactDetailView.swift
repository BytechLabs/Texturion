import SwiftUI
import UIKit

/// Contact detail, the native sibling of the web's /contacts/[id]: auto-saving
/// Name/Address/Notes (800ms after the last keystroke, with a quiet
/// Saving…/Saved status line), the consent card ('Texted you first' vs
/// 'Consent recorded by {member}', the attester resolved against
/// GET /v1/members), the opted-out banner with 'Mark opted in again' and its
/// START caveat, opt-out and soft-delete behind confirm dialogs, and a
/// contextual primary button — 'Open conversation' when a thread already
/// exists (found via GET /v1/conversations?q=<phone>), otherwise 'Message'
/// into compose prefill. Both destinations are shell callbacks; the button
/// hides until the integrator wires them.
@MainActor
struct ContactDetailView: View {
    let graph: AppGraph
    let companyId: String
    let contactId: String
    let onOpenConversation: ((_ conversationId: String) -> Void)?
    let onComposeNew: ((_ contactId: String) -> Void)?

    private enum DetailState {
        case loading
        case failed(message: String, notFound: Bool)
        case ready(Contact)
    }

    @State private var state: DetailState = .loading
    @State private var members: [Member] = []
    @State private var conversationId: String?
    @State private var refreshKey = 0
    @State private var actionError: String?
    @State private var confirmOptOut = false
    @State private var confirmDelete = false
    @State private var working = false

    @Environment(\.dismiss) private var dismiss

    private var mutations: ContactMutations {
        ContactMutations(
            api: graph.api,
            multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
        )
    }

    private var contact: Contact? {
        if case .ready(let value) = state { return value }
        return nil
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message, let notFound):
                if notFound {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(24)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    CenteredError(message: message) { refreshKey += 1 }
                }
            case .ready(let contact):
                readyBody(contact)
            }
        }
        .navigationTitle("Contact")
        .navigationBarTitleDisplayMode(.inline)
        // The tab's list screen hides the bar; the pushed detail shows it.
        .toolbar(.visible, for: .navigationBar)
        .task(id: "\(contactId)|\(refreshKey)") { await load() }
        .task(id: companyId) {
            if let page = try? await mutations.members(companyId: companyId) {
                members = page.data
            }
        }
        // #82: the primary button is contextual — find this contact's
        // existing thread once the phone is known. A lookup failure just
        // leaves the compose fallback, which reuses the same thread on send.
        .task(id: contact?.phone_e164 ?? "") {
            guard let phone = contact?.phone_e164 else { return }
            if let found = try? await mutations.findConversation(
                companyId: companyId, phoneE164: phone
            ) {
                conversationId = found.id
            }
        }
        .alert("Opt out this contact?", isPresented: $confirmOptOut) {
            Button("Opt out", role: .destructive) {
                runAction {
                    _ = try await mutations.optOut(companyId: companyId, contactId: contactId)
                    refreshKey += 1
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "All texting to \(formatPhone(contact?.phone_e164)) is blocked until "
                    + "they're opted back in. Use this when a customer asks you to "
                    + "stop texting them."
            )
        }
        .alert("Delete this contact?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) {
                runAction {
                    try await mutations.delete(companyId: companyId, contactId: contactId)
                    dismiss()
                }
            }
            Button("Keep contact", role: .cancel) {}
        } message: {
            Text(
                "They disappear from your contact list. Conversations and messages "
                    + "stay, and the contact comes back automatically if they text "
                    + "you again."
            )
        }
    }

    private func load() async {
        do {
            state = .ready(
                try await mutations.detail(companyId: companyId, contactId: contactId)
            )
        } catch let error as ApiError where error.code == ApiErrorCode.notFound {
            state = .failed(
                message: "This contact doesn't exist or was removed.", notFound: true
            )
        } catch {
            if case .ready = state {
                // Keep data on a quiet refresh failure.
            } else {
                state = .failed(message: error.userMessage, notFound: false)
            }
        }
    }

    private func memberName(_ userId: String?) -> String? {
        guard let userId else { return nil }
        let name = members.first { $0.user_id == userId }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    private func runAction(_ action: @escaping () async throws -> Void) {
        working = true
        actionError = nil
        Task {
            do {
                try await action()
            } catch {
                actionError = error.userMessage
            }
            working = false
        }
    }

    private func readyBody(_ contact: Contact) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(contact)
                primaryAction(contact)
                if let actionError {
                    Text(actionError)
                        .font(.caption)
                        .foregroundStyle(BrandColor.destructive)
                }
                if contact.opted_out {
                    optedOutCard
                }
                detailsCard(contact)
                consentCard(contact)
                manageCard(contact)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func header(_ contact: Contact) -> some View {
        let name = (contact.name?.isBlank ?? true)
            ? formatPhone(contact.phone_e164)
            : (contact.name ?? "")
        return HStack(spacing: 12) {
            InitialsAvatar(name: name, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.title3.weight(.semibold))
                HStack(spacing: 6) {
                    Text(formatPhone(contact.phone_e164))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button {
                        UIPasteboard.general.string = contact.phone_e164
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Copy number")
                    if contact.opted_out {
                        Text("Opted out")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandColor.destructive)
                    }
                }
            }
        }
    }

    /// Contextual primary action (#82). Hidden until the shell wires the
    /// destinations — a button that goes nowhere would be a lie.
    @ViewBuilder
    private func primaryAction(_ contact: Contact) -> some View {
        if let conversationId, let onOpenConversation {
            Button {
                onOpenConversation(conversationId)
            } label: {
                Text("Open conversation")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.petrol)
        } else if conversationId == nil, let onComposeNew {
            Button {
                onComposeNew(contact.id)
            } label: {
                Text("Message")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.petrol)
        }
    }

    private var optedOutCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("This customer opted out of texting. Sends to them are blocked.")
                .font(.subheadline)
            Button(working ? "Working…" : "Mark opted in again") {
                runAction {
                    _ = try await mutations.revokeOptOut(
                        companyId: companyId, contactId: contactId
                    )
                    refreshKey += 1
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(BrandColor.petrol)
            .buttonStyle(.plain)
            .disabled(working)
            Text(
                "If they texted STOP, they also need to text START before "
                    + "messages will deliver."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func detailsCard(_ contact: Contact) -> some View {
        sectionCard("Details") {
            AutosaveField(
                label: "Name",
                initial: contact.name ?? "",
                maxLength: contactNameMax,
                placeholder: "Add a name",
                multiline: false
            ) { value in
                _ = try await mutations.updateField(
                    companyId: companyId, contactId: contact.id, field: "name", value: value
                )
            }
            .id("\(contact.id)|name")
            AutosaveField(
                label: "Address",
                initial: contact.address ?? "",
                maxLength: contactAddressMax,
                placeholder: "Add an address",
                multiline: false
            ) { value in
                _ = try await mutations.updateField(
                    companyId: companyId, contactId: contact.id, field: "address", value: value
                )
            }
            .id("\(contact.id)|address")
            AutosaveField(
                label: "Notes",
                initial: contact.notes ?? "",
                maxLength: contactNotesMax,
                placeholder: "Gate code, dog's name, preferred arrival window…",
                multiline: true
            ) { value in
                _ = try await mutations.updateField(
                    companyId: companyId, contactId: contact.id, field: "notes", value: value
                )
            }
            .id("\(contact.id)|notes")
        }
    }

    private func consentCard(_ contact: Contact) -> some View {
        sectionCard("Consent") {
            Text(
                consentLine(
                    consentSource: contact.consent_source,
                    consentAt: contact.consent_at,
                    consentAttestedBy: contact.consent_attested_by,
                    memberName: memberName
                )
            )
            .font(.subheadline)
            .foregroundStyle(
                contact.consent_source == nil
                    ? AnyShapeStyle(Color.secondary)
                    : AnyShapeStyle(Color.primary)
            )
        }
    }

    /// §3.3: routine, reversible actions stay quiet — the confirm dialogs
    /// carry the weight, not red scare-styling on the triggers.
    private func manageCard(_ contact: Contact) -> some View {
        sectionCard("Manage this contact") {
            if !contact.opted_out {
                manageRow(
                    text: "Stop all texting to this customer.",
                    actionLabel: "Opt out this contact"
                ) { confirmOptOut = true }
            }
            manageRow(
                text: "Hide this contact from your list. Texting history stays, "
                    + "and they reappear if they text you again.",
                actionLabel: "Delete contact"
            ) { confirmDelete = true }
        }
    }

    private func manageRow(
        text: String,
        actionLabel: String,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            // Quiet trigger (§3.3) — the confirm dialog carries the weight.
            Button(actionLabel, action: onTap)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
                .disabled(working)
        }
    }

    private func sectionCard(
        _ title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(.secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 12)
            )
        }
    }
}

/// G6 auto-save: writes the field 800ms after the last keystroke (blank
/// clears — an explicit null on the wire) with a quiet status line the web
/// renders identically ('Saving…' / 'Saved' / a calm failure sentence). A new
/// keystroke during a pending save restarts the clock (the debounce task is
/// cancelled and replaced); the newest value wins.
@MainActor
private struct AutosaveField: View {
    private enum SaveState {
        case idle, saving, saved, failed
    }

    let label: String
    let initial: String
    let maxLength: Int
    let placeholder: String
    let multiline: Bool
    let save: (String?) async throws -> Void

    @State private var value: String
    @State private var lastSaved: String
    @State private var saveState: SaveState = .idle

    init(
        label: String,
        initial: String,
        maxLength: Int,
        placeholder: String,
        multiline: Bool,
        save: @escaping (String?) async throws -> Void
    ) {
        self.label = label
        self.initial = initial
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.multiline = multiline
        self.save = save
        _value = State(initialValue: initial)
        _lastSaved = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(placeholder, text: $value, axis: multiline ? .vertical : .horizontal)
                .font(.subheadline)
                .lineLimit(multiline ? 3 ... 6 : 1 ... 1)
                .onChange(of: value) { _, next in
                    if next.count > maxLength {
                        value = String(next.prefix(maxLength))
                    }
                }
            Text(statusLine)
                .font(.caption)
                .foregroundStyle(
                    saveState == .failed
                        ? AnyShapeStyle(BrandColor.destructive)
                        : AnyShapeStyle(Color.secondary)
                )
                .frame(height: 14)
        }
        .task(id: value) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            let savedTrimmed = lastSaved.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed != savedTrimmed else { return }
            // The debounce: a new keystroke cancels this task and starts over.
            try? await Task.sleep(for: .milliseconds(800))
            if Task.isCancelled { return }
            saveState = .saving
            do {
                try await save(trimmed.isEmpty ? nil : trimmed)
                lastSaved = value
                saveState = .saved
            } catch {
                saveState = .failed
            }
        }
    }

    private var statusLine: String {
        switch saveState {
        case .idle: ""
        case .saving: "Saving…"
        case .saved: "Saved"
        case .failed: "Couldn't save. Check your connection."
        }
    }
}
