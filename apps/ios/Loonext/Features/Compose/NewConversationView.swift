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
                Divider()
                if numbers.isEmpty {
                    noNumberState
                } else if let composer {
                    form(composer: composer)
                    Divider()
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
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("Back")
            Text("New message")
                .font(.headline)
            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
    }

    private var noNumberState: some View {
        VStack(spacing: 6) {
            Text("Your number isn't ready yet.")
                .font(.subheadline.weight(.semibold))
            Text(
                "You need an active number to start a conversation. "
                    + "Check the web app for its status."
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
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
                    Text("It's \(localTimeLabel) for them.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }

                fromNumberPicker

                bodyField(composer: composer)

                if !composer.photos.isEmpty {
                    PhotoChipsRow(photos: composer.photos) { id in
                        composer.photos.removeAll { $0.id == id }
                    }
                    .padding(.top, 4)
                }

                HStack(spacing: 4) {
                    Button {
                        photosPickerOpen = true
                    } label: {
                        Image(systemName: "photo")
                            .foregroundStyle(.secondary)
                            .frame(width: 36, height: 36)
                    }
                    .disabled(composer.photos.count >= maxPhotos)
                    .accessibilityLabel("Attach a photo")

                    Button {
                        templatePickerOpen = true
                    } label: {
                        Image(systemName: "text.badge.plus")
                            .foregroundStyle(.secondary)
                            .frame(width: 36, height: 36)
                    }
                    .accessibilityLabel("Saved replies")
                }
                .padding(.top, 4)

                ComposerHints(
                    text: composer.text,
                    hasMedia: !composer.photos.isEmpty,
                    contactName: selectedContact?.name,
                    businessName: businessName
                )
                .padding(.top, 2)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var recipientField: some View {
        if let selectedContact {
            HStack(spacing: 6) {
                Text(
                    (selectedContact.name ?? formatPhone(selectedContact.phone_e164))
                        + (selectedContact.opted_out ? " · Opted out" : "")
                )
                .font(.subheadline)
                .foregroundStyle(BrandColor.onPetrolContainer)
                Button {
                    onContactChange(nil)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BrandColor.onPetrolContainer)
                }
                .accessibilityLabel("Clear recipient")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(BrandColor.petrolContainer))
        } else {
            VStack(alignment: .leading, spacing: 4) {
                TextField(
                    "To — name or phone number",
                    text: Binding(
                        get: { recipientInput },
                        set: { value in
                            recipientInput = value.contains(where: \.isLetter)
                                ? value
                                : Nanp.formatAsYouType(Nanp.nationalDigits(value))
                        }
                    )
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))

                if rawDigits.count == 10, let rawE164 {
                    Text(
                        validDestination
                            ? "Will text \(formatPhone(rawE164))"
                            : "US and Canadian numbers only."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var contactMatchList: some View {
        if selectedContact == nil {
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
                        VStack(alignment: .leading, spacing: 1) {
                            Text(contact.name ?? formatPhone(contact.phone_e164))
                                .font(.body)
                                .foregroundStyle(.primary)
                            Text(
                                formatPhone(contact.phone_e164)
                                    + (contact.opted_out ? " · Opted out" : "")
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                Divider()
            }
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
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(BrandColor.petrol)
            }
            .padding(.top, 12)
        }
    }

    private func bodyField(composer: ComposerState) -> some View {
        TextField(
            "Text message",
            text: Binding(
                get: { composer.text },
                set: { composer.onTextChange(String($0.prefix(4096))) }
            ),
            axis: .vertical
        )
        .lineLimit(3 ... 8)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .padding(.top, 16)
    }

    private var sendBar: some View {
        HStack {
            Spacer()
            Button {
                send()
            } label: {
                HStack(spacing: 6) {
                    Text(sending ? "Sending…" : "Send")
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 14))
                }
                .foregroundStyle(BrandColor.onPetrol)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(canSend ? BrandColor.petrol : Color(.systemFill)))
            }
            .disabled(!canSend)
        }
        .padding(16)
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
