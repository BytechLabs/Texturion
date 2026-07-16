import SwiftUI
import UIKit
import UniformTypeIdentifiers

private let csvImportMaxBytes = 2 * 1024 * 1024
private let vcardImportMaxBytes = 5 * 1024 * 1024
private let importErrorsShown = 50

/// Which import a picked document feeds.
private enum ImportKind {
    case csv, vcard

    /// Skipped rows label honestly: 'Row N' (CSV) or 'Card N' (vCard).
    var rowWord: String { self == .csv ? "Row" : "Card" }
    var maxBytes: Int { self == .csv ? csvImportMaxBytes : vcardImportMaxBytes }
    var sizeMessage: String {
        self == .csv ? "CSV files must be 2 MB or less." : "vCard files must be 5 MB or less."
    }
}

/// One finished import, kept with its kind so skipped rows label honestly.
private struct ImportReport: Identifiable {
    let id = UUID()
    let kind: ImportKind
    let result: ImportResult
}

/// The exported CSV bytes. The server emits a UTF-8 BOM so Excel round-trips
/// accents; re-attach it defensively in case a transport layer stripped it.
private func contactsCsvExportData(_ text: String) -> Data {
    var data = Data([0xEF, 0xBB, 0xBF])
    var body = text
    if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
    data.append(Data(body.utf8))
    return data
}

/// Stage the CSV as `contacts.csv` in a unique temp folder so the share sheet
/// offers a well-named file (AirDrop, Messages, Mail, Save to Files).
private func stageCsvForSharing(_ text: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("contacts.csv")
    try contactsCsvExportData(text).write(to: url)
    return url
}

/// One finished export, staged on disk for the share sheet.
private struct ExportedCsv: Identifiable {
    let id = UUID()
    let url: URL
}

/// The real system share sheet (UIActivityViewController) — AirDrop, Messages,
/// Mail, Save to Files — where fileExporter could only save.
private struct CsvShareSheet: UIViewControllerRepresentable {
    let url: URL
    let onFinish: @MainActor (_ completed: Bool) -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: [url],
            applicationActivities: nil
        )
        let onFinish = onFinish
        controller.completionWithItemsHandler = { _, completed, _, _ in
            // UIKit calls this on the main thread.
            MainActor.assumeIsolated { onFinish(completed) }
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Contacts: debounced name/phone search over the cursor-paginated list,
/// create-contact sheet (NANP-validated), row tap → `ContactDetailView`,
/// CSV export (respecting the live search, handed to the system share sheet
/// so it can be AirDropped/messaged/mailed or saved to Files), and
/// owner/admin CSV + vCard imports (fileImporter) with a
/// per-row skipped-rows report.
///
/// `onOpenConversation`/`onComposeNew` are shell callbacks into #159's thread
/// and compose screens; affordances that need them stay hidden until wired.
/// `me` gates import to owner/admin — when the shell doesn't pass it, the tab
/// resolves it once via GET /v1/me.
@MainActor
struct ContactsTab: View {
    let graph: AppGraph
    let companyId: String
    var me: Me? = nil
    var onOpenConversation: ((_ conversationId: String) -> Void)? = nil
    var onComposeNew: ((_ contactId: String) -> Void)? = nil

    private struct ContactRoute: Hashable, Identifiable {
        let id: String
    }

    @State private var query = ""
    @State private var debouncedQ = ""
    @State private var state: LoadState<Void> = .loading
    @State private var rows: [Contact] = []
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var refreshKey = 0
    @State private var resolvedMe: Me?
    @State private var openContact: ContactRoute?

    @State private var createOpen = false
    @State private var exporting = false
    @State private var exportedCsv: ExportedCsv?
    @State private var importing = false
    @State private var pendingImport: ImportKind?
    @State private var importPresented = false
    @State private var importReport: ImportReport?
    @State private var notice: String?

    private var mutations: ContactMutations {
        ContactMutations(
            api: graph.api,
            multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
        )
    }

    /// Role for the import gate. Quiet resolve when the shell didn't pass me;
    /// until it lands the import affordance simply isn't there yet.
    private var canImport: Bool {
        let current = me ?? resolvedMe
        let role = current?.memberships.first { $0.company_id == companyId }?.role
        return MemberRole.atLeast(role, required: MemberRole.admin)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                actionsRow
                if let notice {
                    Text(notice)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 2)
                }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $openContact) { route in
                ContactDetailView(
                    graph: graph,
                    companyId: companyId,
                    contactId: route.id,
                    onOpenConversation: onOpenConversation,
                    onComposeNew: onComposeNew,
                    // Caller-ID name for the detail's Call button, mirroring
                    // the Android twin's resolvedMe?.display_name.orEmpty().
                    callerIdName: (me ?? resolvedMe)?.display_name ?? ""
                )
            }
        }
        .task(id: query) {
            // Debounce typing; an empty query applies immediately.
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
            }
            debouncedQ = query.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .task(id: "\(companyId)|\(debouncedQ)|\(refreshKey)") { await reload() }
        .task(id: companyId) {
            if me == nil {
                resolvedMe = try? await graph.meApi.me()
            }
        }
        .onChange(of: openContact) { previous, next in
            // Edits/opt-outs/deletes made in the detail show on return.
            if previous != nil && next == nil {
                refreshKey += 1
            }
        }
        .sheet(isPresented: $createOpen) {
            CreateContactSheet(mutations: mutations, companyId: companyId) { created in
                createOpen = false
                refreshKey += 1
                openContact = ContactRoute(id: created.id)
            }
        }
        .sheet(item: $importReport) { report in
            ImportReportSheet(report: report)
        }
        .sheet(item: $exportedCsv) { export in
            CsvShareSheet(url: export.url) { completed in
                if completed {
                    notice = "Contacts exported."
                }
                exportedCsv = nil
            }
            .presentationDetents([.medium, .large])
            .ignoresSafeArea()
        }
        .fileImporter(
            isPresented: $importPresented,
            allowedContentTypes: pendingImport == .vcard
                ? [.vCard, .text]
                : [.commaSeparatedText, .plainText, .text],
            allowsMultipleSelection: false
        ) { result in
            let kind = pendingImport
            pendingImport = nil
            guard case .success(let urls) = result, let url = urls.first, let kind else {
                return
            }
            runImport(kind: kind, url: url)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search name or number", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: query) { _, next in
                    if next.count > 200 {
                        query = String(next.prefix(200))
                    }
                }
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
    }

    private var actionsRow: some View {
        HStack(spacing: 8) {
            // Accent rationing: New contact is the region's one petrol
            // element; export/import stay quiet stone.
            Button {
                createOpen = true
            } label: {
                Label("New contact", systemImage: "plus")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.petrol)
            .controlSize(.small)
            Spacer()
            Button(exporting ? "Exporting…" : "Export") {
                exportCsv()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .buttonStyle(.plain)
            .disabled(exporting)
            if canImport {
                Menu {
                    Button("CSV file") {
                        pendingImport = .csv
                        importPresented = true
                    }
                    Button("vCard file (.vcf)") {
                        pendingImport = .vcard
                        importPresented = true
                    }
                } label: {
                    Text(importing ? "Importing…" : "Import")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .disabled(importing)
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { refreshKey += 1 }
        case .ready:
            if rows.isEmpty {
                Text(
                    debouncedQ.isEmpty
                        ? "No contacts yet. They're added automatically when "
                            + "someone texts you, or add one yourself."
                        : "No matches for \"\(debouncedQ)\"."
                )
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(rows, id: \.id) { contact in
                        ContactRow(contact: contact)
                            .contentShape(Rectangle())
                            .onTapGesture { openContact = ContactRoute(id: contact.id) }
                    }
                    if nextCursor != nil {
                        HStack {
                            Spacer()
                            Button(loadingMore ? "Loading…" : "Load more") {
                                loadMore()
                            }
                            .disabled(loadingMore)
                            .font(.subheadline)
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private func reload() async {
        if rows.isEmpty { state = .loading }
        do {
            let page = try await graph.contactsApi.contacts(
                companyId: companyId,
                q: debouncedQ.isEmpty ? nil : debouncedQ,
                limit: 50
            )
            rows = page.data
            nextCursor = page.next_cursor
            state = .ready(())
        } catch {
            if rows.isEmpty {
                state = .failed(error.userMessage)
            } else {
                notice = error.userMessage
            }
        }
    }

    private func loadMore() {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        Task {
            do {
                let page = try await graph.contactsApi.contacts(
                    companyId: companyId,
                    q: debouncedQ.isEmpty ? nil : debouncedQ,
                    cursor: cursor,
                    limit: 50
                )
                rows += page.data
                nextCursor = page.next_cursor
            } catch {
                notice = error.userMessage
            }
            loadingMore = false
        }
    }

    /// Fetch the CSV (respecting the live search), stage it as a temp file,
    /// and hand it to the system share sheet so it can be AirDropped,
    /// messaged, mailed, or saved to Files — the honest mobile equivalent of
    /// the web download.
    private func exportCsv() {
        exporting = true
        notice = nil
        Task {
            do {
                let csv = try await mutations.exportCsv(
                    companyId: companyId,
                    q: debouncedQ.isEmpty ? nil : debouncedQ
                )
                exportedCsv = ExportedCsv(url: try stageCsvForSharing(csv))
            } catch {
                notice = (error as? ApiError)?.message
                    ?? "The export didn't go through. Try again."
            }
            exporting = false
        }
    }

    private func runImport(kind: ImportKind, url: URL) {
        importing = true
        notice = nil
        Task {
            defer { importing = false }
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? -1
            if size > kind.maxBytes {
                notice = kind.sizeMessage
                return
            }
            guard let bytes = try? Data(contentsOf: url) else {
                notice = "Couldn't read that file. Try again."
                return
            }
            if bytes.count > kind.maxBytes { // providers may not report a size
                notice = kind.sizeMessage
                return
            }
            do {
                let result: ImportResult
                switch kind {
                case .csv:
                    result = try await mutations.importCsv(
                        companyId: companyId,
                        fileName: url.lastPathComponent,
                        bytes: bytes
                    )
                case .vcard:
                    result = try await mutations.importVcard(
                        companyId: companyId,
                        fileName: url.lastPathComponent,
                        bytes: bytes
                    )
                }
                importReport = ImportReport(kind: kind, result: result)
                refreshKey += 1
            } catch {
                notice = error.userMessage
            }
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

/// Create a contact by hand: US/CA phone with live NANP formatting (the
/// strict shared-module port validates before the server's authoritative
/// pass), plus optional name/address/notes. POST /v1/contacts upserts on the
/// phone, so re-adding an existing number just lands on the same row.
@MainActor
private struct CreateContactSheet: View {
    let mutations: ContactMutations
    let companyId: String
    let onCreated: @MainActor (Contact) -> Void

    @State private var phone = ""
    @State private var name = ""
    @State private var address = ""
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private var normalized: String? { Nanp.normalize(phone) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("(416) 555-0123", text: $phone)
                        .keyboardType(.phonePad)
                        .onChange(of: phone) { _, next in
                            let formatted = Nanp.formatAsYouType(next)
                            if formatted != next { phone = formatted }
                            error = nil
                        }
                    if !phone.isEmpty && normalized == nil {
                        Text("Enter a 10-digit US or Canada number.")
                            .font(.caption)
                            .foregroundStyle(BrandColor.destructive)
                    }
                } header: {
                    Text("Phone")
                }
                Section {
                    TextField("Optional", text: $name)
                        .onChange(of: name) { _, next in
                            if next.count > contactNameMax {
                                name = String(next.prefix(contactNameMax))
                            }
                        }
                } header: {
                    Text("Name")
                }
                Section {
                    TextField("Optional", text: $address)
                        .onChange(of: address) { _, next in
                            if next.count > contactAddressMax {
                                address = String(next.prefix(contactAddressMax))
                            }
                        }
                } header: {
                    Text("Address")
                }
                Section {
                    TextField("Optional", text: $notes, axis: .vertical)
                        .lineLimit(2 ... 4)
                        .onChange(of: notes) { _, next in
                            if next.count > contactNotesMax {
                                notes = String(next.prefix(contactNotesMax))
                            }
                        }
                } header: {
                    Text("Notes")
                }
                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(BrandColor.destructive)
                }
            }
            .navigationTitle("New contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Adding…" : "Add contact") { create() }
                        .disabled(normalized == nil || saving)
                }
            }
        }
        .presentationDetents([.large])
    }

    private func create() {
        guard let phoneE164 = normalized else { return }
        saving = true
        error = nil
        Task {
            do {
                let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
                let created = try await mutations.create(
                    companyId: companyId,
                    phoneE164: phoneE164,
                    name: trimmedName.isEmpty ? nil : trimmedName,
                    address: trimmedAddress.isEmpty ? nil : trimmedAddress,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes
                )
                onCreated(created)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// The import's authoritative outcome — imported/updated/skipped counts plus
/// the per-row reasons for everything skipped, labeled 'Row N' (CSV) or
/// 'Card N' (vCard) exactly as the server reported them.
@MainActor
private struct ImportReportSheet: View {
    let report: ImportReport

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Import finished")
                .font(.headline)
            Text(
                [
                    "\(report.result.imported) imported",
                    "\(report.result.updated) updated",
                    "\(report.result.skipped) skipped",
                ].joined(separator: " · ")
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if !report.result.errors.isEmpty {
                Text("Skipped rows:")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(
                            Array(report.result.errors.prefix(importErrorsShown).enumerated()),
                            id: \.offset
                        ) { _, rowError in
                            Text("\(report.kind.rowWord) \(rowError.row) — \(rowError.reason)")
                                .font(.caption)
                        }
                        let hidden = report.result.errors.count - importErrorsShown
                        if hidden > 0 {
                            Text("…and \(hidden) more.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 280)
            }
            HStack {
                Spacer()
                Button("Done") { dismiss() }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Previews

private func previewContact(
    id: String,
    phone: String,
    name: String?,
    optedOut: Bool = false,
    lastActivityAt: String? = nil
) -> Contact {
    Contact(
        id: id,
        phone_e164: phone,
        name: name,
        address: nil,
        notes: nil,
        consent_source: nil,
        consent_at: nil,
        consent_attested_by: nil,
        deleted_at: nil,
        created_at: "2026-07-08T14:00:00Z",
        updated_at: "2026-07-10T09:00:00Z",
        opted_out: optedOut,
        last_activity_at: lastActivityAt
    )
}

#Preview("Contacts tab") {
    ContactsTab(graph: AppGraph(), companyId: "preview-co")
}

#Preview("Contact rows") {
    List {
        ContactRow(
            contact: previewContact(
                id: "ct1",
                phone: "+14165550134",
                name: "Dana Whitcomb",
                lastActivityAt: "2026-07-15T18:00:00Z"
            )
        )
        ContactRow(
            contact: previewContact(
                id: "ct2",
                phone: "+14155550188",
                name: nil,
                optedOut: true,
                lastActivityAt: "2026-07-01T12:00:00Z"
            )
        )
    }
    .listStyle(.plain)
}

#Preview("New contact sheet") {
    let graph = AppGraph()
    CreateContactSheet(
        mutations: ContactMutations(
            api: graph.api,
            multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
        ),
        companyId: "preview-co",
        onCreated: { _ in }
    )
}
