import PhotosUI
import SwiftUI

private struct ComposeIntentKey: Equatable {
    let recipient: String
    let body: String
    let photoIds: [String]
}

/// Outbound-first compose: pick a contact or type a US/CA number (live NANP
/// formatting), see the destination's local time, write the first message, and
/// send with a client Idempotency-Key. A quiet-hours 409 opens a confirm dialog
/// that resends with quiet_hours_confirmed=true under the SAME key — the
/// Android NewConversationScreen's twin.
@MainActor
struct NewConversationView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let prefillContactId: String?
    let onCreated: @MainActor (String) -> Void
    let onBack: @MainActor () -> Void

    @State private var bootstrap: LoadState<[PhoneNumberSummary]> = .loading
    @State private var businessName: String?
    @State private var selectedContact: Contact?
    @State private var bootKey = 0

    var body: some View {
        Group {
            switch bootstrap {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { bootKey += 1 }
            case .ready(let numbers):
                NewConversationLoaded(
                    repo: MessagingRepository(api: graph.api),
                    companyId: companyId,
                    numbers: numbers,
                    businessName: businessName,
                    selectedContact: selectedContact,
                    onContactChange: { selectedContact = $0 },
                    onCreated: onCreated,
                    onBack: onBack
                )
            }
        }
        .task(id: "\(companyId)|\(bootKey)") {
            bootstrap = .loading
            do {
                let meView = try await graph.meApi.me(companyId: companyId)
                businessName = meView.company?.name
                let numbers = (meView.company?.numbers ?? [])
                    .filter { $0.status == NumberStatus.active }
                if let prefillContactId, selectedContact == nil {
                    selectedContact = try? await MessagingRepository(api: graph.api)
                        .contact(companyId: companyId, contactId: prefillContactId)
                }
                bootstrap = .ready(numbers)
            } catch {
                bootstrap = .failed(error.userMessage)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

@MainActor
private struct NewConversationLoaded: View {
    let repo: MessagingRepository
    let companyId: String
    let numbers: [PhoneNumberSummary]
    let businessName: String?
    let selectedContact: Contact?
    let onContactChange: @MainActor (Contact?) -> Void
    let onCreated: @MainActor (String) -> Void
    let onBack: @MainActor () -> Void

    @State private var recipientInput = ""
    @State private var contactMatches: [Contact] = []
    @State private var fromNumberId: String?
    @State private var composer: ComposerState?
    @State private var sending = false
    @State private var quietHoursPrompt: ComposeBody?
    @State private var templatePickerOpen = false
    @State private var photosPickerOpen = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var lastIntent: (key: ComposeIntentKey, idempotencyKey: String)?
    @State private var noticeText: String?
    @State private var noticeDismissTask: Task<Void, Never>?
    @FocusState private var toFocused: Bool

    private var rawDigits: String { Nanp.nationalDigits(recipientInput) }
    private var rawE164: String? { Nanp.toE164(recipientInput) }
    private var recipientE164: String? { selectedContact?.phone_e164 ?? rawE164 }
    private var localTimeLabel: String? {
        recipientE164.flatMap { Nanp.destinationLocalTimeLabel($0) }
    }

    private var validDestination: Bool {
        guard let recipientE164 else { return false }
        return Nanp.isUsCaDestination(recipientE164)
    }

    private var canSend: Bool {
        guard let composer else { return false }
        return !sending &&
            fromNumberId != nil &&
            (selectedContact != nil || rawE164 != nil) &&
            !composer.text.isBlank
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                header
                if numbers.isEmpty {
                    noNumberState
                } else if let composer {
                    form(composer: composer)
                    sendBar
                }
            }
            if let noticeText {
                Text(noticeText)
                    .font(.footnote)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 80)
                    .onTapGesture { self.noticeText = nil }
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .onAppear {
            if fromNumberId == nil { fromNumberId = numbers.first?.id }
            if composer == nil {
                composer = ComposerState(
                    draftKey: ComposerDrafts.newConversation,
                    drafts: ComposerDrafts()
                )
            }
        }
        // Contact search over the recipient input (debounced, ≥2 chars).
        .task(id: recipientInput) {
            let q = recipientInput.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.count < 2 {
                contactMatches = []
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            contactMatches = (try? await repo.contacts(companyId: companyId, q: q, limit: 6).data) ?? []
        }
        .photosPicker(
            isPresented: $photosPickerOpen,
            selection: $photoSelection,
            maxSelectionCount: max(1, maxPhotos - (composer?.photos.count ?? 0)),
            matching: .images
        )
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            ingestPhotos(items)
        }
        .sheet(isPresented: $templatePickerOpen) {
            TemplatePickerSheet(
                loadTemplates: { [repo, companyId] in
                    try await repo.templates(companyId: companyId).data
                },
                onPick: { body in
                    templatePickerOpen = false
                    guard let composer else { return }
                    let current = composer.text
                    composer.onTextChange(
                        current.isEmpty
                            ? body
                            : current + (current.hasSuffix(" ") ? "" : " ") + body
                    )
                }
            )
        }
        .alert(
            "It's late where they are",
            isPresented: Binding(
                get: { quietHoursPrompt != nil },
                set: { if !$0 { quietHoursPrompt = nil } }
            )
        ) {
            Button("Wait", role: .cancel) { quietHoursPrompt = nil }
            Button("Send anyway") {
                if let pending = quietHoursPrompt {
                    quietHoursPrompt = nil
                    send(resend: pending)
                }
            }
        } message: {
            Text("It's \(localTimeLabel ?? "between 8pm and 8am") at this number. Send anyway?")
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(BrandColor.paper))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            Spacer()
            Text("New text")
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
    }

    private var noNumberState: some View {
        VStack(spacing: 6) {
            Text("Your number isn't ready yet.")
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(
                "You need an active number to start a conversation. "
                    + "Check the web app for its status."
            )
            .font(.golos(12.5))
            .foregroundStyle(BrandColor.muted600)
            .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func form(composer: ComposerState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                recipientField
                contactMatchList

                if let localTimeLabel {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "clock")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrandColor.overdueAmber)
                            .padding(.top, 1)
                        Text("It's \(localTimeLabel) for them.")
                            .font(.golos(11.5))
                            .foregroundStyle(BrandColor.overdueAmber)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(
                        BrandColor.cream,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                    )
                    .padding(.top, 13)
                }

                fromNumberPicker

                bodyField(composer: composer)

                if !composer.photos.isEmpty {
                    PhotoChipsRow(photos: composer.photos) { id in
                        composer.photos.removeAll { $0.id == id }
                    }
                    .padding(.top, 4)
                }

                HStack(spacing: 10) {
                    Button {
                        photosPickerOpen = true
                    } label: {
                        Image(systemName: "photo")
                            .font(.system(size: 15, weight: .regular))
                            .foregroundStyle(BrandColor.ink)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(BrandColor.paper))
                    }
                    .buttonStyle(.plain)
                    .disabled(composer.photos.count >= maxPhotos)
                    .accessibilityLabel("Attach a photo")

                    Spacer()

                    Button {
                        templatePickerOpen = true
                    } label: {
                        Text("Templates")
                            .font(.golos(11.5, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Saved replies")
                }
                .padding(.top, 8)

                ComposerHints(
                    text: composer.text,
                    hasMedia: !composer.photos.isEmpty,
                    contactName: selectedContact?.name,
                    businessName: businessName
                )
                .padding(.top, 2)
            }
            .padding(18)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var recipientField: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "To")
            if let selectedContact {
                HStack {
                    HStack(spacing: 8) {
                        Text(
                            (selectedContact.name ?? formatPhone(selectedContact.phone_e164))
                                + (selectedContact.opted_out ? " · Opted out" : "")
                        )
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        Button {
                            onContactChange(nil)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BrandColor.muted600)
                        }
                        .accessibilityLabel("Clear recipient")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(BrandColor.avatarTint))
                    Spacer()
                }
                .padding(9)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
            } else {
                TextField(
                    "Name or phone number",
                    text: Binding(
                        get: { recipientInput },
                        set: { value in
                            recipientInput = value.contains(where: \.isLetter)
                                ? value
                                : Nanp.formatAsYouType(Nanp.nationalDigits(value))
                        }
                    )
                )
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($toFocused)
                .padding(.horizontal, 15)
                .padding(.vertical, 13)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(
                            toFocused ? BrandColor.ink : BrandColor.insetDeep,
                            lineWidth: toFocused ? 2 : 1.5
                        )
                )

                if rawDigits.count == 10, let rawE164 {
                    Text(
                        validDestination
                            ? (contactMatches.isEmpty
                                ? "No match in contacts — this starts a new conversation."
                                : "Will text \(formatPhone(rawE164))")
                            : "US and Canadian numbers only."
                    )
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted300)
                    .padding(.horizontal, 4)
                    .padding(.top, 5)
                }
            }
        }
    }

    @ViewBuilder
    private var contactMatchList: some View {
        if selectedContact == nil, !contactMatches.isEmpty {
            PaperCard {
                ForEach(contactMatches, id: \.id) { contact in
                    Button {
                        onContactChange(contact)
                        recipientInput = ""
                        contactMatches = []
                    } label: {
                        HStack(spacing: 10) {
                            InitialsAvatar(
                                name: contact.name ?? formatPhone(contact.phone_e164),
                                size: 32
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.name ?? formatPhone(contact.phone_e164))
                                    .font(.golos(13.5, weight: .semibold))
                                    .foregroundStyle(BrandColor.ink)
                                Text(
                                    formatPhone(contact.phone_e164)
                                        + (contact.opted_out ? " · Opted out" : "")
                                )
                                .font(.golos(11))
                                .foregroundStyle(BrandColor.muted500)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if contact.id != contactMatches.last?.id {
                        RowDivider()
                    }
                }
            }
            .padding(.top, 10)
        }
    }

    @ViewBuilder
    private var fromNumberPicker: some View {
        // From-number picker (only when there's a real choice).
        if numbers.count > 1 {
            let selected = numbers.first { $0.id == fromNumberId }
            Menu {
                ForEach(numbers, id: \.id) { number in
                    Button(formatPhone(number.number_e164)) {
                        fromNumberId = number.id
                    }
                }
            } label: {
                Text("From: \(formatPhone(selected?.number_e164))")
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
            }
            .padding(.top, 12)
        }
    }

    private func bodyField(composer: ComposerState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Message")
            TextField(
                "Text message",
                text: Binding(
                    get: { composer.text },
                    set: { composer.onTextChange(String($0.prefix(4096))) }
                ),
                axis: .vertical
            )
            .lineLimit(3 ... 8)
            .font(.golos(14))
            .foregroundStyle(BrandColor.ink)
            .padding(.horizontal, 15)
            .padding(.vertical, 14)
            .background(
                BrandColor.paper,
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(BrandColor.insetDeep, lineWidth: 1.5)
            )
        }
        .padding(.top, 16)
    }

    private var sendBar: some View {
        Button {
            send()
        } label: {
            HStack(spacing: 10) {
                Text(sending ? "Sending…" : "Send text")
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(canSend ? BrandColor.paper : BrandColor.muted500)
                Spacer()
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(canSend ? BrandColor.onLime : BrandColor.muted500)
                    .frame(width: 42, height: 42)
                    .background(
                        Circle().fill(canSend ? BrandColor.lime : BrandColor.insetDeep)
                    )
            }
            .padding(.leading, 22)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(Capsule().fill(canSend ? BrandColor.ink : BrandColor.inset))
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
    }

    // MARK: - Sending

    private func notify(_ text: String) {
        noticeText = text
        noticeDismissTask?.cancel()
        noticeDismissTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { noticeText = nil }
        }
    }

    private func handleFailure(_ error: Error, body: ComposeBody) {
        sending = false
        if let apiError = error as? ApiError,
           apiError.code == ApiErrorCode.quietHoursConfirmationRequired {
            // lastIntent keeps its key — the confirmed resend replays under it.
            quietHoursPrompt = body
            return
        }
        notify(error.userMessage)
    }

    private func dispatch(_ body: ComposeBody, key: String) {
        sending = true
        Task {
            do {
                let result = try await repo.compose(companyId: companyId, body: body, idempotencyKey: key)
                sending = false
                lastIntent = nil
                composer?.clearForSend()
                onCreated(result.conversation.id)
            } catch {
                handleFailure(error, body: body)
            }
        }
    }

    private func send(resend: ComposeBody? = nil) {
        guard let composer else { return }
        if resend == nil, !canSend { return }
        let photos = composer.photos
        let bodyText = composer.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let recipientKey = selectedContact?.id ?? rawE164 else { return }
        let intentKey = ComposeIntentKey(
            recipient: recipientKey,
            body: bodyText,
            photoIds: photos.map(\.id)
        )
        let key: String
        if let existing = lastIntent, existing.key == intentKey {
            key = existing.idempotencyKey
        } else {
            key = UUID().uuidString
        }
        lastIntent = (intentKey, key)

        let request: ComposeBody
        if let resend {
            request = resend.confirmed()
        } else {
            guard let fromNumberId else { return }
            request = ComposeBody(
                contact_id: selectedContact?.id,
                phone_e164: selectedContact == nil ? rawE164 : nil,
                phone_number_id: fromNumberId,
                body: bodyText,
                quiet_hours_confirmed: nil,
                media: photos.isEmpty ? nil : photos.map { $0.toOutboundMedia() }
            )
        }
        dispatch(request, key: key)
    }

    private func ingestPhotos(_ items: [PhotosPickerItem]) {
        guard let composer else { return }
        Task {
            var trimmed = false
            for item in items {
                if composer.photos.count >= maxPhotos {
                    trimmed = true
                    break
                }
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    notify("Couldn't read that photo. Try attaching it again.")
                    continue
                }
                let result = await Task.detached(operation: { preparePhoto(data: data) }).value
                switch result {
                case .ready(let photo):
                    composer.photos.append(photo)
                case .rejected(let reason):
                    notify(reason)
                }
            }
            if trimmed { notify("You can attach up to 3 photos per text.") }
        }
    }
}

// MARK: - Previews

#Preview("New conversation") {
    NewConversationLoaded(
        repo: MessagingRepository(
            api: ApiClient(sessionStore: SessionStore(), auth: SupabaseAuth())
        ),
        companyId: "co",
        numbers: [
            PhoneNumberSummary(
                id: "n1",
                status: "active",
                country: "CA",
                number_e164: "+16475550188",
                requested_area_code: "647",
                created_at: "2026-07-01T12:00:00Z",
                source: "provisioned",
                voice_enabled: true,
                suspended_at: nil,
                released_at: nil,
                failure_reason: nil,
                provision_attempts: nil,
                retrying: nil
            ),
        ],
        businessName: "Loonext Fencing",
        selectedContact: nil,
        onContactChange: { _ in },
        onCreated: { _ in },
        onBack: {}
    )
}
