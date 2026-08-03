import AVFoundation
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
    /// #291: the workspace's own field DEFINITIONS. Read once per workspace
    /// rather than per contact — they are the same for every record. An empty
    /// list is the honest state for a workspace that has defined none, and it
    /// is also what a failed read leaves behind: the fields simply do not
    /// appear, rather than the screen refusing to open over them.
    @State private var customFieldDefs: [ContactFieldDef] = []
    @State private var confirmOptOut = false
    @State private var confirmDelete = false
    @State private var working = false
    @State private var placingCall = false
    /// #292: the timezone picker stays folded until asked for.
    @State private var editingTimezone = false

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
        // #291: the workspace's own field definitions, once per workspace.
        .task(id: "fields|\(companyId)") {
            if let response = try? await mutations.contactFields(companyId: companyId) {
                customFieldDefs = response.data
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
                    optedOutCard(contact)
                }
                consentCard(contact)
                detailsCard(contact)
                attributionCaption(contact)
                conversationSection
                // #324: ONE chronology of texts, calls and jobs. D7 threads by
                // recency, so a long relationship is many conversations; this
                // is the overview and Calls below stays the detail view where a
                // voicemail plays in place.
                ContactTimelineSection(
                    graph: graph,
                    mutations: mutations,
                    companyId: companyId,
                    contactId: contact.id,
                    onOpenConversation: onOpenConversation
                )
                ContactCallsSection(
                    graph: graph,
                    companyId: companyId,
                    contactId: contact.id,
                    onOpenConversation: onOpenConversation
                )
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
            // #410: how long they have been a customer, and how often. Quiet
            // metadata under the number rather than a section of its own —
            // two facts do not earn a heading.
            if let line = contactRelationshipLine(
                contact.conversation_count,
                contact.first_conversation_at
            ) {
                Text(line)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.top, 3)
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

    private func optedOutCard(_ contact: Contact) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("This customer opted out of texting. Sends to them are blocked.")
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted900)
            // Which kind of opt-out decides whether there is anything to press.
            // A STOP is a carrier block: undoing our record would not lift it,
            // and the next send comes back rejected anyway, which is what used
            // to happen.
            if isCarrierEnforcedOptOut(contact.opt_out_source) {
                Text(
                    "They texted STOP, so their carrier is blocking your texts. "
                        + "Only they can undo it, by texting START to your number."
                )
                .font(.golos(10.5))
                .foregroundStyle(BrandColor.muted500)
            } else {
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
                Text("Someone recorded this by hand, so undoing it here is all it takes.")
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)
            }
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
            // #291: directly under the name, because for a property manager or
            // a general contractor it IS the name — "Dave" is not a useful
            // record, "Dave at Maple Property Group" is.
            AutosaveField(
                label: "Business",
                initial: contact.business_name ?? "",
                maxLength: contactNameMax,
                placeholder: "Who they work for, if anyone",
                multiline: false
            ) { value in
                _ = try await mutations.updateField(
                    companyId: companyId,
                    contactId: contact.id,
                    field: "business_name",
                    value: value
                )
            }
            .id("\(contact.id)|business_name")
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
            // #291: the OTHER addresses, absent until there are any. The row
            // above stays the one-address case, which is most of them.
            //
            // Each write bumps `refreshKey`, which is what already drives this
            // screen's own re-read. The server decides which address is primary
            // — adding the first promotes it, deleting the primary promotes a
            // survivor — so echoing a guess locally would show the wrong answer
            // until the next open.
            AddressList(
                addresses: contact.addresses ?? [],
                onAdd: { label, address in
                    Task {
                        do {
                            _ = try await mutations.addAddress(
                                companyId: companyId,
                                contactId: contact.id,
                                body: ContactAddressBody(address: address, label: label)
                            )
                            refreshKey += 1
                        } catch {
                            actionError = error.userMessage
                        }
                    }
                },
                onMakePrimary: { addressId in
                    Task {
                        do {
                            _ = try await mutations.makeAddressPrimary(
                                companyId: companyId,
                                contactId: contact.id,
                                addressId: addressId
                            )
                            refreshKey += 1
                        } catch {
                            actionError = error.userMessage
                        }
                    }
                },
                onRemove: { addressId in
                    Task {
                        do {
                            try await mutations.removeAddress(
                                companyId: companyId,
                                contactId: contact.id,
                                addressId: addressId
                            )
                            refreshKey += 1
                        } catch {
                            actionError = error.userMessage
                        }
                    }
                }
            )
            RowDivider()
            // #291: beside the address rather than beside the phone, because it
            // answers the same question — how we reach them when a text is the
            // wrong shape for what we are sending.
            AutosaveField(
                label: "Email",
                initial: contact.email ?? "",
                maxLength: contactEmailMax,
                placeholder: "For quotes and receipts",
                multiline: false
            ) { value in
                _ = try await mutations.updateField(
                    companyId: companyId,
                    contactId: contact.id,
                    field: "email",
                    value: value
                )
            }
            .id("\(contact.id)|email")
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
            RowDivider()
            // #291: the fields this workspace defined for itself. Renders
            // nothing at all until somebody defines one, so a crew that never
            // opens the settings screen never sees an empty heading.
            CustomFields(
                defs: customFieldDefs,
                values: contact.custom_fields ?? [:],
                onCommit: { values in
                    Task {
                        do {
                            _ = try await mutations.updateCustomFields(
                                companyId: companyId,
                                contactId: contact.id,
                                values: values
                            )
                            refreshKey += 1
                        } catch {
                            actionError = error.userMessage
                        }
                    }
                }
            )
            RowDivider()
            // #292/D49: what time it is where they are, and a way to fix it
            // when the area code lies.
            destinationClockRow(contact)
        }
    }

    /// #292/D49 — the destination clock: a reading, where it came from, and a
    /// quiet way to correct it.
    ///
    /// Folded by default. The inference is right for the large majority of
    /// contacts, so a permanently-open picker of every North American zone
    /// would be clutter earning its keep a few times a year. Tapping "Change"
    /// reveals it, already on the zone in force rather than empty.
    ///
    /// Applying: Zen of Clarity (advanced control collapsed), Smart Defaults.
    @ViewBuilder
    private func destinationClockRow(_ contact: Contact) -> some View {
        if let zone = contact.timezone_resolved {
            VStack(alignment: .leading, spacing: 4) {
                Text("Their time")
                    .font(.golos(10.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted500)
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundStyle(BrandColor.muted500)
                    Text(localReading(zone))
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted900)
                    Text(timezoneProvenanceLabel(contact.timezone_source))
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                    Spacer(minLength: 6)
                    Button(editingTimezone ? "Done" : "Change") {
                        editingTimezone.toggle()
                    }
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .disabled(working)
                }
                if editingTimezone {
                    Menu {
                        ForEach(northAmericanTimeZoneIdentifiers(), id: \.self) { candidate in
                            Button(zoneLabel(candidate)) { saveTimezone(candidate) }
                        }
                    } label: {
                        Text(zoneLabel(zone))
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .disabled(working)
                    if contact.timezone != nil {
                        Button("Use their area code") { saveTimezone(nil) }
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted500)
                            .buttonStyle(.plain)
                            .disabled(working)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func localReading(_ zone: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: Date())
    }

    private func zoneLabel(_ zone: String) -> String {
        (zone.split(separator: "/").last.map(String.init) ?? zone)
            .replacingOccurrences(of: "_", with: " ")
    }

    private func saveTimezone(_ zone: String?) {
        runAction {
            _ = try await mutations.updateField(
                companyId: companyId, contactId: contactId, field: "timezone", value: zone
            )
            editingTimezone = false
            refreshKey += 1
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

    /// #191 quiet record-attribution caption — who added this contact, and who
    /// last edited it when that was someone else. Ported 1:1 from the Android
    /// ContactDetailScreen attribution block + the web RecordAttribution. Shows
    /// NOTHING for contacts that predate attribution (null actors, no backfill
    /// lie); renders in the muted-caption style.
    @ViewBuilder
    private func attributionCaption(_ contact: Contact) -> some View {
        let attribution = contactAttribution(
            createdByName: contact.created_by_name,
            createdAt: contact.created_at,
            updatedByName: contact.updated_by_name
        )
        if attribution.added != nil || attribution.edited != nil {
            VStack(alignment: .leading, spacing: 1) {
                if let added = attribution.added {
                    Text(added)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                }
                if let edited = attribution.edited {
                    Text(edited)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
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

// MARK: - #191 record attribution (pure, testable)

/// The two attribution caption lines. `nil` means "render nothing" — the
/// load-bearing honesty rule for contacts that predate attribution.
struct ContactAttribution: Equatable {
    let added: String?
    let edited: String?
}

/// #191 record attribution, ported 1:1 from the Android `contactAttribution`
/// and the web RecordAttribution so the clients never phrase it differently:
///  - "Added by {name} on Jul 8, 2026" (the date dropped if unparseable),
///  - "Edited by {name}" only when a DIFFERENT member last edited it.
/// Both lines are nil when the actor name doesn't resolve — a blank or missing
/// name renders nothing rather than a faked "Added by unknown".
func contactAttribution(
    createdByName: String?,
    createdAt: String?,
    updatedByName: String?,
    calendar: Calendar = .current
) -> ContactAttribution {
    let added = createdByName
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .flatMap { $0.isEmpty ? nil : $0 }
    let edited = updatedByName
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .flatMap { $0.isEmpty ? nil : $0 }
    let addedLine: String? = added.map { name in
        guard let parsed = parseWireTimestamp(createdAt) else { return "Added by \(name)" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "MMM d, yyyy"
        return "Added by \(name) on \(formatter.string(from: parsed))"
    }
    let editedLine: String?
    if let edited, edited != added {
        editedLine = "Edited by \(edited)"
    } else {
        editedLine = nil
    }
    return ContactAttribution(added: addedLine, edited: editedLine)
}

// MARK: - #205 per-contact call history (pure, testable)

/// One day bucket in the contact's Calls section.
struct CallDayGroup: Identifiable {
    let label: String
    let calls: [Call]
    var id: String { label }
}

/// Newest-first day bucket label, ported from the Android `contactCallDayLabel`
/// (itself the call log's groupByDay/dayLabel): "Today" / "Yesterday" /
/// "MMM d" (this year) / "MMM d yyyy" (older). Unparseable input buckets under
/// "Earlier" rather than crashing.
func contactCallDayLabel(
    _ iso: String,
    now: Date = Date(),
    calendar: Calendar = .current
) -> String {
    guard let date = parseWireTimestamp(iso) else { return "Earlier" }
    if calendar.isDate(date, inSameDayAs: now) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(date, inSameDayAs: yesterday) {
        return "Yesterday"
    }
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = sameYear ? "MMM d" : "MMM d yyyy"
    return formatter.string(from: date)
}

/// Newest-first list → ordered day buckets, preserving the API's order within
/// each bucket. Ported from the Android `groupContactCallsByDay`.
func groupContactCallsByDay(
    _ calls: [Call],
    now: Date = Date(),
    calendar: Calendar = .current
) -> [CallDayGroup] {
    var order: [String] = []
    var buckets: [String: [Call]] = [:]
    for call in calls {
        let label = contactCallDayLabel(call.started_at, now: now, calendar: calendar)
        if buckets[label] == nil {
            order.append(label)
            buckets[label] = [call]
        } else {
            buckets[label]?.append(call)
        }
    }
    return order.map { CallDayGroup(label: $0, calls: buckets[$0] ?? []) }
}

// MARK: - #205 Calls section (view)

/// The contact-detail's generic section scaffold (#205, mirrors the Android
/// ContactCallsSection.kt `ContactSection`): a section header over slotted
/// content. Calls is the first tenant; per-contact tasks and activity slot in
/// later with the same shape — build against this, not the calls instance.
// #324: internal rather than private so ContactTimelineSection can use the
// same section chrome instead of growing a second one that drifts.
struct ContactSection<Content: View>: View {
    let title: String
    var count: Int? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: title, count: count)
            content
        }
    }
}

/// The contact's call history (#205): GET /v1/calls?contact_id=<id>
/// newest-first, day-grouped in the call log's grammar, missed calls in the
/// amber treatment (the iOS call log's actionable-miss color — CallsView uses
/// overdueAmber, not coral), voicemail playable inline, tap-through to the
/// conversation. iOS has no StoreCache, so this is a load-on-appear with a
/// loading state (the current iOS calls pattern); call.updated realtime +
/// reconnect revalidate the first page, mirroring CallsView.
///
/// The row grammar and the voicemail player are REPLICATED from CallsView
/// (its CallRow / VoicemailPlayerRow are `private`, so not importable): until a
/// shared component is extracted, any copy change must land in both.
@MainActor
private struct ContactCallsSection: View {
    let graph: AppGraph
    let companyId: String
    let contactId: String
    let onOpenConversation: ((_ conversationId: String) -> Void)?

    @State private var state: LoadState<[Call]> = .loading
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var refreshKey = 0

    private var service: CallsService { CallsService(api: graph.api) }

    var body: some View {
        ContactSection(title: "Calls") {
            content
        }
        .task(id: "\(contactId)|\(refreshKey)") { await reload() }
        // Realtime: the calls table's DB trigger broadcasts call.updated
        // (ID-only) on every session change — refetch the first page; ditto
        // after a socket re-join. Same pattern as CallsView.
        .task(id: contactId) {
            for await event in await graph.realtime.events()
                where event.event == "call.updated" {
                refreshKey += 1
            }
        }
        .task(id: contactId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        // #215 Part A: refetch this contact's calls on foreground so a
        // call.updated missed while backgrounded self-heals.
        .resyncOnForeground { refreshKey += 1 }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            HStack {
                Spacer()
                ProgressView().controlSize(.small)
                Spacer()
            }
            .padding(.vertical, 12)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Text(message)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                Button("Try again") { refreshKey += 1 }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 6)
        case .ready(let calls):
            if calls.isEmpty {
                // The quiet one-line empty state.
                Text("No calls with this contact yet.")
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted500)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
            } else {
                readyList(groupContactCallsByDay(calls))
            }
        }
    }

    private func readyList(_ groups: [CallDayGroup]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
                SectionHeader(label: group.label, count: group.calls.count)
                    .padding(.top, group.id == groups.first?.id ? 4 : 10)
                PaperCard {
                    ForEach(group.calls, id: \.id) { call in
                        ContactCallRow(
                            call: call,
                            service: service,
                            companyId: companyId,
                            onOpen: openAction(for: call)
                        )
                        if call.id != group.calls.last?.id {
                            RowDivider().padding(.leading, 42)
                        }
                    }
                }
            }
            if nextCursor != nil {
                HStack {
                    Spacer()
                    if loadingMore {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Show more") { loadMore() }
                            .font(.golos(12, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.top, 8)
            }
        }
    }

    /// Extracted with an explicit type — the same swiftc type-checker guard the
    /// call log's CallsView.openAction(for:) documents.
    private func openAction(for call: Call) -> (@MainActor () -> Void)? {
        guard let id = call.conversation_id, let onOpenConversation else { return nil }
        return { onOpenConversation(id) }
    }

    /// Reuse the shipped GET /v1/calls?contact_id= filter directly. The calls
    /// backend's typed `CallsService.calls()` doesn't thread contact_id and its
    /// file is owned elsewhere, so issue the read here rather than change it —
    /// same envelope (Page<Call>), same #106 SQL access filtering server-side.
    private func fetchCalls(cursor: String?) async throws -> Page<Call> {
        try await graph.api.get(
            "/v1/calls",
            query: [
                "contact_id": contactId,
                "cursor": cursor,
                "limit": "25",
            ],
            companyId: companyId
        )
    }

    private func reload() async {
        do {
            let page = try await fetchCalls(cursor: nil)
            nextCursor = page.next_cursor
            state = .ready(page.data)
        } catch {
            if case .ready = state {
                // Keep the stale list on a quiet refetch failure.
            } else {
                state = .failed(error.userMessage)
            }
        }
    }

    private func loadMore() {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        Task {
            defer { loadingMore = false }
            do {
                let page = try await fetchCalls(cursor: cursor)
                nextCursor = page.next_cursor
                if case .ready(let existing) = state {
                    let seen = Set(existing.map(\.id))
                    state = .ready(existing + page.data.filter { !seen.contains($0.id) })
                }
            } catch {
                // Keep what's loaded; the button stays.
            }
        }
    }
}

/// One call row in the detail's Calls section. Grammar REPLICATED from the call
/// log's row (CallsView.CallRow) minus the avatar and caller name — the whole
/// screen is this contact, so the outcome line leads. The reused pure helpers
/// (`callOutcomeLabel`, `isActionableMiss`, `relativeTime`) are the call log's
/// own module-internal functions.
@MainActor
private struct ContactCallRow: View {
    let call: Call
    let service: CallsService
    let companyId: String
    let onOpen: (@MainActor () -> Void)?

    private var directionIcon: String {
        call.direction == "outbound" ? "phone.arrow.up.right" : "phone.arrow.down.left"
    }

    private var metaColor: Color {
        isActionableMiss(call) ? BrandColor.overdueAmber : BrandColor.muted500
    }

    private var showsVoicemail: Bool {
        call.outcome == CallOutcome.voicemail && (call.voicemail_seconds ?? 0) > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 11) {
                Image(systemName: directionIcon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(metaColor)
                    .frame(width: 20)
                Text(callOutcomeLabel(call))
                    .font(.golos(13, weight: isActionableMiss(call) ? .semibold : .regular))
                    .foregroundStyle(isActionableMiss(call) ? BrandColor.overdueAmber : BrandColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(relativeTime(call.started_at))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .monospacedDigit()
            }
            .padding(.horizontal, 15)
            .padding(.top, 11)
            .padding(.bottom, showsVoicemail ? 6 : 11)
            if showsVoicemail {
                ContactVoicemailPlayerRow(
                    service: service,
                    companyId: companyId,
                    sessionId: call.call_session_id,
                    seconds: call.voicemail_seconds ?? 0,
                    storedTranscript: voicemailWords(call)
                )
                .padding(.leading, 42)
                .padding(.trailing, 15)
                .padding(.bottom, 12)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
    }
}

/// The words on a voicemail row, or nil when there is nothing worth showing.
private func voicemailWords(_ call: Call) -> String? {
    guard let text = call.voicemail_transcript, !text.isBlank else { return nil }
    return text
}

/// Inline voicemail playback. Grammar and data path REPLICATED from
/// CallsView.VoicemailPlayerRow (a `private` struct there, so not importable):
/// mint the 1h signed URL on demand via CallsService.voicemail (never cached),
/// stream via AVPlayer with seek + live progress. Any change here must mirror
/// the call log's player until a shared component is extracted.
@MainActor
private struct ContactVoicemailPlayerRow: View {
    let service: CallsService
    let companyId: String
    let sessionId: String
    let seconds: Int
    /// The stored transcript, when the call row already carries one.
    let storedTranscript: String?

    @State private var backfilledTranscript: String?
    @State private var player: AVPlayer?
    @State private var preparing = false
    @State private var playing = false
    @State private var positionMs = 0
    @State private var durationMs: Int
    @State private var scrubbing = false
    @State private var errorText: String?

    init(
        service: CallsService,
        companyId: String,
        sessionId: String,
        seconds: Int,
        storedTranscript: String?
    ) {
        self.storedTranscript = storedTranscript
        self.service = service
        self.companyId = companyId
        self.sessionId = sessionId
        self.seconds = seconds
        _durationMs = State(initialValue: max(1, seconds * 1000))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                Button(action: togglePlayback) {
                    Group {
                        if preparing {
                            ProgressView()
                                .controlSize(.small)
                                .tint(BrandColor.paper)
                        } else {
                            Image(systemName: playing ? "pause.fill" : "play.fill")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(BrandColor.paper)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .background(BrandColor.ink, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause voicemail" : "Play voicemail")

                Slider(
                    value: Binding(
                        get: { Double(min(positionMs, durationMs)) },
                        set: { positionMs = Int($0) }
                    ),
                    in: 0 ... Double(durationMs)
                ) { editing in
                    scrubbing = editing
                    if !editing, let player {
                        player.seek(to: CMTime(
                            value: CMTimeValue(positionMs),
                            timescale: 1000
                        ))
                    }
                }
                .tint(BrandColor.olive)
                .disabled(player == nil)

                Text("\(formatTimer(elapsedMs: positionMs)) / \(formatVoicemailLength(seconds))")
                    .font(.golos(10.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                    .monospacedDigit()
            }
            .padding(.vertical, 6)
            .padding(.leading, 6)
            .padding(.trailing, 14)
            .background(BrandColor.inset, in: Capsule())
            if let errorText {
                Text(errorText)
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)
            }
            if let words = storedTranscript ?? backfilledTranscript {
                Text(words)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task(id: playing) {
            // Poll position while playing (the call log's player does the same).
            while playing {
                if !scrubbing, let player {
                    let current = player.currentTime().seconds
                    if current.isFinite { positionMs = Int(current * 1000) }
                    if let item = player.currentItem {
                        let total = item.duration.seconds
                        if total.isFinite && total > 0 { durationMs = Int(total * 1000) }
                        if item.error != nil {
                            errorText = "Couldn't play this voicemail."
                            playing = false
                        }
                    }
                    if positionMs >= durationMs - 150 {
                        // Finished — a replay restarts from the top.
                        positionMs = durationMs
                        playing = false
                        player.pause()
                    }
                }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
            playing = false
        }
    }

    private func togglePlayback() {
        if preparing { return }
        if playing {
            player?.pause()
            playing = false
            return
        }
        if let player {
            if positionMs >= durationMs - 150 {
                player.seek(to: .zero)
                positionMs = 0
            }
            player.play()
            playing = true
            return
        }
        beginPlayback()
    }

    private func beginPlayback() {
        errorText = nil
        preparing = true
        Task {
            defer { preparing = false }
            do {
                // Signed URL minted per playback — NEVER cached (SPEC).
                let playback = try await service.voicemail(
                    companyId: companyId,
                    sessionId: sessionId
                )
                guard let url = URL(string: playback.url) else {
                    errorText = "Couldn't play this voicemail."
                    return
                }
                // Recordings from before transcription existed, and any whose
                // transcription failed at the time, are written down by the
                // server on this request and get their words on first play.
                if storedTranscript == nil,
                   let words = playback.transcript,
                   !words.isBlank {
                    backfilledTranscript = words
                }
                let next = AVPlayer(url: url)
                player = next
                next.play()
                playing = true
            } catch {
                errorText = error.userMessage
            }
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
        // #393: nil means a first text here would still carry the signature.
        first_identification_sent_at: nil,
        deleted_at: nil,
        created_at: "2026-07-08T14:00:00Z",
        updated_at: "2026-07-10T09:00:00Z",
        opted_out: optedOut,
        last_activity_at: "2026-07-15T18:00:00Z",
        created_by_user_id: "u1",
        created_by_name: "Dana Fields",
        updated_by_user_id: "u2",
        updated_by_name: "Sam Rivera"
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
