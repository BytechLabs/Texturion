import SwiftUI
import UIKit

/// Contact detail, the native sibling of the web's /contacts/[id]: auto-saving
/// Name/Address/Notes (800ms after the last keystroke, with a quiet
/// Saving…/Saved status line), the consent card ('Texted you first' vs
/// 'Consent recorded by {member}', the attester resolved against
/// GET /v1/members), the opted-out banner with 'Mark opted in again' and its
/// START caveat, opt-out and soft-delete behind confirm dialogs, a Call
/// pill under the identity header (mic preflight → CallsManager.placeCall
/// with the contact context; voice consent is separate from SMS consent, so
/// it stays enabled for opted-out contacts), and a contextual Text pill —
/// opens the thread when one already exists (found via
/// GET /v1/conversations?q=<phone>), otherwise 'Message' into compose
/// prefill. Both messaging destinations are shell callbacks; those buttons
/// hide until the integrator wires them (Call needs no shell wiring).
@MainActor
struct ContactDetailView: View {
    let graph: AppGraph
    let companyId: String
    let contactId: String
    let onOpenConversation: ((_ conversationId: String) -> Void)?
    let onComposeNew: ((_ contactId: String) -> Void)?
    /// Caller-ID name for softphone registration — the list tab passes the
    /// resolved member display name (the Android twin's callerIdName).
    var callerIdName: String = ""

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
    @State private var placingCall = false

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
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(24)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    CenteredError(message: message) { refreshKey += 1 }
                }
            case .ready(let contact):
                readyBody(contact)
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
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

    // MARK: - Call (#160/#165)

    /// Mic first, then authorize — a denial never reserves the line or bills
    /// a minute. Mirrors the Android ContactDetailScreen exactly: enabled for
    /// opted-out contacts (voice consent is separate from SMS consent).
    private func callWithMicPreflight(_ contact: Contact) {
        let manager = CallsManager.get(graph: graph)
        if manager.hasMicPermission {
            placeCall(contact, manager: manager)
            return
        }
        Task {
            if await manager.requestMicPermission() {
                placeCall(contact, manager: manager)
            } else {
                actionError = "Loonext needs the microphone to place calls. "
                    + "Allow it in Settings › Loonext."
            }
        }
    }

    /// Authorize + place via the softphone (contact_id — no thread required).
    /// Coded gate refusals (usage_cap_reached, subscription_inactive,
    /// conflict) surface their honest server copy in the existing error line.
    private func placeCall(_ contact: Contact, manager: CallsManager) {
        guard !placingCall else { return }
        placingCall = true
        actionError = nil
        manager.start(companyId: companyId, callerIdName: callerIdName)
        Task {
            defer { placingCall = false }
            do {
                try await manager.placeCall(
                    displayName: (contact.name?.isBlank ?? true)
                        ? formatPhone(contact.phone_e164)
                        : (contact.name ?? ""),
                    contactId: contact.id
                )
            } catch {
                actionError = error.userMessage
            }
        }
    }

    // fileprivate (not private) so the #Preview below can render the ready
    // state with inline mock data — the loaded view is otherwise unreachable
    // without a live API.
    fileprivate func readyBody(_ contact: Contact) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                identityHeader(contact)
                if let actionError {
                    Text(actionError)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.destructive)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                if contact.opted_out {
                    optedOutCard
                }
                consentCard(contact)
                detailsCard(contact)
                conversationSection
                manageCard(contact)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
        }
    }

    /// Spec 07 identity header: centered soft-square avatar, display name,
    /// tabular number with the copy affordance, and the action pill row.
    private func identityHeader(_ contact: Contact) -> some View {
        let name = (contact.name?.isBlank ?? true)
            ? formatPhone(contact.phone_e164)
            : (contact.name ?? "")
        return VStack(spacing: 3) {
            ContactSquareAvatar(
                name: name,
                size: 78,
                cornerRadius: 26,
                fontSize: 24,
                tint: BrandColor.insetDeep
            )
            Text(name)
                .font(.display(24))
                .kerning(-0.2)
                .foregroundStyle(BrandColor.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
            HStack(spacing: 6) {
                Text(formatPhone(contact.phone_e164))
                    .font(.golos(12.5))
                    .monospacedDigit()
                    .foregroundStyle(BrandColor.muted500)
                Button {
                    UIPasteboard.general.string = contact.phone_e164
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 11))
                        .foregroundStyle(BrandColor.muted400)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Copy number")
                if contact.opted_out {
                    Text("Opted out")
                        .font(.golos(11, weight: .semibold))
                        .foregroundStyle(BrandColor.destructive)
                }
            }
            actionPills(contact)
                .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }

    /// Spec 07 action row: the ink "Text" pill (contextual, #82 — opens the
    /// existing thread or composes; hidden until the shell wires it — a
    /// button that goes nowhere would be a lie) and the paper "Call" pill.
    @ViewBuilder
    private func actionPills(_ contact: Contact) -> some View {
        HStack(spacing: 10) {
            if let conversationId, let onOpenConversation {
                Button {
                    onOpenConversation(conversationId)
                } label: {
                    textPillLabel
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open conversation")
            } else if conversationId == nil, let onComposeNew {
                Button {
                    onComposeNew(contact.id)
                } label: {
                    textPillLabel
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Message")
            }
            // Call (#165) — deliberately NOT gated on opted_out: voice
            // consent is separate from SMS consent.
            Button {
                callWithMicPreflight(contact)
            } label: {
                HStack(spacing: 7) {
                    if placingCall {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Image(systemName: "phone")
                            .font(.system(size: 13, weight: .medium))
                    }
                    Text(placingCall ? "Calling…" : "Call")
                        .font(.golos(12, weight: .semibold))
                }
                .foregroundStyle(BrandColor.ink)
                .padding(.horizontal, 17)
                .padding(.vertical, 10)
                .background(BrandColor.paper, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(placingCall)
            .accessibilityLabel(placingCall ? "Calling" : "Call")
        }
        .frame(maxWidth: .infinity)
    }

    private var textPillLabel: some View {
        HStack(spacing: 7) {
            Image(systemName: "message")
                .font(.system(size: 13, weight: .medium))
            Text("Text")
                .font(.golos(12, weight: .semibold))
        }
        .foregroundStyle(BrandColor.paper)
        .padding(.horizontal, 17)
        .padding(.vertical, 10)
        .background(BrandColor.ink, in: Capsule())
    }

    private var optedOutCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("This customer opted out of texting. Sends to them are blocked.")
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted900)
            Button(working ? "Working…" : "Mark opted in again") {
                runAction {
                    _ = try await mutations.revokeOptOut(
                        companyId: companyId, contactId: contactId
                    )
                    refreshKey += 1
                }
            }
            .font(.golos(12.5, weight: .semibold))
            .foregroundStyle(BrandColor.olive)
            .buttonStyle(.plain)
            .disabled(working)
            Text(
                "If they texted STOP, they also need to text START before "
                    + "messages will deliver."
            )
            .font(.golos(10.5))
            .foregroundStyle(BrandColor.muted500)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BrandColor.cream,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
    }

    /// Spec 07 details card: label-left autosave rows with hairline dividers.
    private func detailsCard(_ contact: Contact) -> some View {
        PaperCard {
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
            RowDivider()
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
            RowDivider()
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

    /// Spec 07 consent strip: a lime check on recorded consent, teaching
    /// copy in muted ink when none exists yet.
    private func consentCard(_ contact: Contact) -> some View {
        HStack(alignment: .center, spacing: 9) {
            if contact.consent_source != nil {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 22, height: 22)
                    .background(BrandColor.lime, in: Circle())
            }
            Text(
                consentLine(
                    consentSource: contact.consent_source,
                    consentAt: contact.consent_at,
                    consentAttestedBy: contact.consent_attested_by,
                    memberName: memberName
                )
            )
            .font(.golos(12.5))
            .foregroundStyle(
                contact.consent_source == nil
                    ? BrandColor.muted500
                    : BrandColor.muted900
            )
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BrandColor.paper,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
    }

    /// Spec 07 Conversations section: the one existing thread as a tappable
    /// row. Only the id is known client-side, so the row stays honest — no
    /// invented titles or statuses. Hidden until the shell wires navigation.
    @ViewBuilder
    private var conversationSection: some View {
        if let conversationId, let onOpenConversation {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(label: "Conversations", count: 1)
                PaperCard {
                    Button {
                        onOpenConversation(conversationId)
                    } label: {
                        HStack(spacing: 11) {
                            Text("Open the conversation")
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(BrandColor.muted250)
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// §3.3: routine, reversible actions stay quiet — the confirm dialogs
    /// carry the weight. Opt out wears the spec's warm-brick label; delete
    /// stays muted.
    private func manageCard(_ contact: Contact) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Manage this contact")
            PaperCard {
                if !contact.opted_out {
                    manageRow(
                        text: "Stop all texting to this customer.",
                        actionLabel: "Opt out this contact",
                        destructive: true
                    ) { confirmOptOut = true }
                    RowDivider()
                }
                manageRow(
                    text: "Hide this contact from your list. Texting history stays, "
                        + "and they reappear if they text you again.",
                    actionLabel: "Delete contact",
                    destructive: false
                ) { confirmDelete = true }
            }
        }
    }

    private func manageRow(
        text: String,
        actionLabel: String,
        destructive: Bool,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text(text)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
                .frame(maxWidth: .infinity, alignment: .leading)
            // Quiet trigger (§3.3) — the confirm dialog carries the weight.
            Button(actionLabel, action: onTap)
                .buttonStyle(.plain)
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(destructive ? BrandColor.destructive : BrandColor.muted700)
                .disabled(working)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
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
        // Spec 07 row grammar: 56pt muted label on the left, the value as
        // the editable field beside it, quiet status line underneath.
        HStack(alignment: .firstTextBaseline, spacing: 11) {
            Text(label)
                .font(.golos(11, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
                .frame(width: 56, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                TextField(placeholder, text: $value, axis: multiline ? .vertical : .horizontal)
                    .font(.golos(13, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(multiline ? 3 ... 6 : 1 ... 1)
                    .onChange(of: value) { _, next in
                        if next.count > maxLength {
                            value = String(next.prefix(maxLength))
                        }
                    }
                Text(statusLine)
                    .font(.golos(10))
                    .foregroundStyle(
                        saveState == .failed
                            ? AnyShapeStyle(BrandColor.destructive)
                            : AnyShapeStyle(BrandColor.muted400)
                    )
                    .frame(height: 14)
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
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

// MARK: - Previews

private func previewDetailContact(optedOut: Bool) -> Contact {
    Contact(
        id: "ct1",
        phone_e164: "+14165550134",
        name: "Dana Whitcomb",
        address: "82 Birchmount Rd",
        notes: "Gate code 4411. Dog is friendly.",
        consent_source: ConsentSource.inboundSms,
        consent_at: "2026-07-08T14:00:00Z",
        consent_attested_by: nil,
        deleted_at: nil,
        created_at: "2026-07-08T14:00:00Z",
        updated_at: "2026-07-10T09:00:00Z",
        opted_out: optedOut,
        last_activity_at: "2026-07-15T18:00:00Z"
    )
}

#Preview("Contact detail — ready") {
    NavigationStack {
        ContactDetailView(
            graph: AppGraph(),
            companyId: "preview-co",
            contactId: "ct1",
            onOpenConversation: { _ in },
            onComposeNew: { _ in }
        )
        .readyBody(previewDetailContact(optedOut: false))
        .navigationTitle("Contact")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview("Contact detail — opted out") {
    NavigationStack {
        ContactDetailView(
            graph: AppGraph(),
            companyId: "preview-co",
            contactId: "ct1",
            onOpenConversation: nil,
            onComposeNew: nil
        )
        .readyBody(previewDetailContact(optedOut: true))
        .navigationTitle("Contact")
        .navigationBarTitleDisplayMode(.inline)
    }
}
