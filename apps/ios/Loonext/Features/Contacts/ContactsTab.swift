import SwiftUI
import UIKit
import UniformTypeIdentifiers

private let importErrorsShown = 50

/// One finished import, kept with its kind so skipped rows label honestly.
private struct ImportReport: Identifiable {
    let id = UUID()
    let kind: ContactImportKind
    let result: ImportResult
}

/// One import the server refused outright — nothing was written.
///
/// #248. The refusal that matters names the columns or properties this file
/// carries that the declaration did not account for, one at a time, and asks for
/// a person to look at them. That is a paragraph, and a paragraph does not fit
/// in the five-second notice line under the search box — it was shown at 11.5pt
/// in muted grey and then deleted itself, which is a refusal nobody was told
/// about.
private struct ImportRefusal: Identifiable {
    let id = UUID()
    let kind: ContactImportKind
    /// The server's sentence, printed exactly as it arrived. It names the
    /// columns in the file's own spelling, and rewording it here would mean
    /// picking those names back out of prose — a parse that breaks silently the
    /// first time the sentence changes, taking the answer to "which column?"
    /// with it.
    let message: String
}

/// The exported CSV bytes. The server emits a UTF-8 BOM so Excel round-trips
/// accents; re-attach it defensively in case a transport layer stripped it.
/// Stage the CSV as `contacts.csv` in a unique temp folder so the share sheet
/// offers a well-named file (AirDrop, Messages, Mail, Save to Files).
private func stageCsvForSharing(_ text: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("contacts.csv")
    try csvExportData(text).write(to: url)
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
/// A row tap routes `AppRouter.openContactId` up to the shell, which pushes
/// `ContactDetailView` ABOVE the tab shell (#186 — no pill on the detail); the
/// shell also wires the detail's thread/compose callbacks. `me` gates import to
/// owner/admin — when the shell doesn't pass it, the tab resolves it once via
/// GET /v1/me.
@MainActor
struct ContactsTab: View {
    let graph: AppGraph
    let companyId: String
    var me: Me? = nil

    @ObservedObject private var router = AppRouter.shared

    @State private var query = ""
    @State private var debouncedQ = ""
    @State private var state: LoadState<Void> = .loading
    @State private var rows: [Contact] = []
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var refreshKey = 0
    @State private var resolvedMe: Me?
    /// #291: the active field filter, and the definitions the chips come from.
    /// An empty list is the honest state both for a workspace that defined none
    /// and for a read that failed: the chips simply do not appear.
    @State private var fieldFilter: ContactFieldFilter?
    @State private var fieldDefs: [ContactFieldDef] = []

    /// The filter, flattened for the `.task(id:)` key. Two nils and two empty
    /// strings all have to be distinguishable, or changing an answer would not
    /// re-run the load.
    private var filterKey: String {
        guard let filter = fieldFilter else { return "-" }
        return "\(filter.key)=\(filter.value)"
    }

    @State private var createOpen = false
    @State private var exporting = false
    @State private var exportedCsv: ExportedCsv?
    @State private var importing = false
    @State private var pendingImport: ContactImportKind?
    @State private var importPresented = false
    /// #248: a picked file waiting on its consent attestation. Nothing is
    /// uploaded while this is set.
    @State private var importCandidate: ContactImportCandidate?
    @State private var importReport: ImportReport?
    /// #248: an import the server refused outright, held until it is read.
    @State private var importRefusal: ImportRefusal?
    @State private var notice: String?

    // #459: the phone's own address book, its own group below the crew's.
    // Loaded once into memory when access is granted; the filter runs locally
    // because these rows never leave the phone.
    @State private var deviceRows: [DeviceContactListRow] = []
    @State private var deviceAuthorized = DeviceContactsAccess.isAuthorized
    @State private var deviceExpanded = false
    @State private var addFromDevice: DeviceContactListRow?

    @Environment(\.appLocale) private var appLocale

    /// This screen's words. Short because the alternative is
    /// `AppStrings.translate(appLocale, …)` twenty times in one layout.
    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

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
        // #186: a flat surface — a row tap routes UP to the shell's root stack
        // (`AppRouter.openContactId`), so the contact detail renders ABOVE the
        // tab shell with no pill (it used to push inside this tab).
        VStack(spacing: 0) {
            headerBar
            searchField
            // #291: under the search box, because both answer "show me less".
            // Absent entirely unless the workspace defined a field with a
            // closed set of answers.
            ContactFilter(
                defs: fieldDefs,
                active: fieldFilter,
                onChange: { fieldFilter = $0 }
            )
            .padding(.horizontal, 18)
            if let notice {
                Text(notice)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.top, 2)
            }
            content
            actionsRow
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        // A pushed contact detail popped — refetch so edits/opt-outs/deletes
        // made inside it show on return (the shell bumps this on pop).
        .onChange(of: router.contactsRevision) { _, _ in refreshKey += 1 }
        .task(id: query) {
            // Debounce typing; an empty query applies immediately.
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
            }
            debouncedQ = query.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .task(id: "\(companyId)|\(debouncedQ)|\(filterKey)|\(refreshKey)") {
            await reload()
        }
        .task(id: "fields|\(companyId)") {
            // `mutations`, not `contactsApi`: the definitions live on the
            // contacts repository beside the writes that use them, and this
            // view already holds it.
            if let response = try? await mutations.contactFields(
                companyId: companyId
            ) {
                fieldDefs = response.data
            }
        }
        .task(id: companyId) {
            if me == nil {
                resolvedMe = try? await graph.meApi.me()
            }
        }
        // #459: read the phone's own book once, and again the moment access is
        // granted. Never at launch — see DeviceContacts.swift for why the ask
        // waits until the section that needs it is on screen.
        .task(id: deviceAuthorized) {
            deviceRows = deviceAuthorized ? await DeviceContactsAccess.load() : []
        }
        .task(id: notice) {
            // The notice line is a transient snackbar equivalent — it clears
            // itself; a new notice restarts the clock.
            guard notice != nil else { return }
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { return }
            notice = nil
        }
        .sheet(isPresented: $createOpen) {
            CreateContactSheet(mutations: mutations, companyId: companyId) { created in
                createOpen = false
                refreshKey += 1
                // Open the freshly created contact ABOVE the shell.
                AppRouter.shared.openContactId = created.id
            }
        }
        .sheet(item: $addFromDevice) { row in
            // #459: pulling a device contact into the crew's shared book,
            // carrying the name the phone already had.
            CreateContactSheet(
                mutations: mutations,
                companyId: companyId,
                prefillPhone: row.number,
                prefillName: row.name
            ) { created in
                addFromDevice = nil
                refreshKey += 1
                AppRouter.shared.openContactId = created.id
            }
        }
        .sheet(item: $importCandidate) { candidate in
            // #248: raised between picking the file and uploading it, so the
            // attestation is made about a file whose name is on screen — and so
            // an oversized file is refused before anybody is asked to swear to
            // anything. Dismissing without confirming uploads nothing.
            ContactImportConsentSheet(candidate: candidate) { confirmed in
                importCandidate = nil
                runImport(confirmed)
            }
        }
        .sheet(item: $importReport) { report in
            ImportReportSheet(report: report)
        }
        .sheet(item: $importRefusal) { refusal in
            ImportRefusedSheet(refusal: refusal)
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
            stageImport(kind: kind, url: url)
        }
    }

    /// Spec 27 header: the display title with an honest tabular count, and
    /// the region's one ink accent — the 44pt New-contact circle.
    private var headerBar: some View {
        HStack(alignment: .center) {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                ScreenTitle(text: t("contactsTasks.contactsTitle"))
                // The spec count is the total — only honest once every page
                // has loaded (no server-side total on the wire).
                if case .ready = state, nextCursor == nil, !rows.isEmpty {
                    Text("\(rows.count)")
                        .font(.golos(12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            Spacer()
            Button {
                createOpen = true
            } label: {
                Image(systemName: "plus")
                    .font(.scaled(17, weight: .medium))
                    .foregroundStyle(BrandColor.paper)
                    .frame(width: 44, height: 44)
                    .background(BrandColor.ink, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(t("contactsTasks.newContact"))
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
    }

    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(15, weight: .medium))
                .foregroundStyle(BrandColor.muted300)
            TextField(t("contactsTasks.searchNameOrNumber"), text: $query)
                .font(.golos(13.5))
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
                        .foregroundStyle(BrandColor.muted300)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(t("contactsTasks.clearSearch"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(BrandColor.paper, in: Capsule())
        .padding(.horizontal, 18)
        .padding(.vertical, 8)
    }

    /// Export/import live at the foot of the screen as quiet inset pills —
    /// spec 27's footer hint made functional. New contact moved to the header.
    private var actionsRow: some View {
        HStack(spacing: 10) {
            Button(
                exporting
                    ? t("contactsTasks.exporting")
                    : t("contactsTasks.exportCsv")
            ) {
                exportCsv()
            }
            .buttonStyle(.plain)
            .font(.golos(11, weight: .semibold))
            .foregroundStyle(BrandColor.muted700)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(BrandColor.insetDeep, in: Capsule())
            .disabled(exporting)
            if canImport {
                Menu {
                    Button(t("contactsTasks.csvFile")) {
                        pendingImport = .csv
                        importPresented = true
                    }
                    Button(t("contactsTasks.vcardFile")) {
                        pendingImport = .vcard
                        importPresented = true
                    }
                } label: {
                    Text(
                        importing
                            ? t("contactsTasks.importing")
                            : t("contactsTasks.importCsvOrVcard")
                    )
                        .font(.golos(11, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(BrandColor.insetDeep, in: Capsule())
                }
                .disabled(importing)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }

    /// What an empty list says, which depends on WHY it is empty.
    ///
    /// #291: under an active filter those customers are excluded, not missing.
    /// "They're added automatically when someone texts you" reads as having
    /// none at all, which is alarming and wrong.
    private var emptyMessage: String {
        if !debouncedQ.isEmpty {
            return t("contactsTasks.noMatchesFor", ["query": debouncedQ])
        }
        if fieldFilter != nil {
            // Still English: the two halves are constants in ContactFilter.swift,
            // which this slice does not own. Reported with the extraction.
            return "\(contactFilterEmptyTitle). \(contactFilterEmptyBody)"
        }
        return t("contactsTasks.noContactsYet")
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
                // #459: still a ScrollView, because the phone's own contacts
                // render below — and an empty shared book is exactly when
                // somebody needs them most.
                ScrollView {
                    Text(emptyMessage)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 40)
                    .frame(maxWidth: .infinity)

                    devicePhoneSection
                }
                .refreshable { await reload() }
            } else {
                ScrollView {
                    // #246: above the list, and only when there is something to
                    // act on. Somebody who does not know they have duplicates
                    // will not go looking for a screen about them.
                    DuplicateContactsCard(
                        mutations: mutations,
                        companyId: companyId,
                        canMerge: canImport,
                        onMerged: { result in
                            refreshKey += 1
                            // The opt-out union is said out loud: a merge can
                            // leave the survivor opted out when the record the
                            // user kept was not, and nothing else on screen
                            // would tell them.
                            notice = result.opted_out
                                ? t("contactsTasks.mergedOptedOut")
                                : t("contactsTasks.merged")
                        }
                    )

                    PaperCard {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { index, contact in
                                if index > 0 {
                                    RowDivider()
                                }
                                ContactRow(contact: contact)
                                    .contentShape(Rectangle())
                                    .onTapGesture { AppRouter.shared.openContactId = contact.id }
                            }
                            if nextCursor != nil {
                                RowDivider()
                                Button(
                                    loadingMore
                                        ? t("contactsTasks.loading")
                                        : t("contactsTasks.loadMore")
                                ) {
                                    loadMore()
                                }
                                .buttonStyle(.plain)
                                .font(.golos(12, weight: .semibold))
                                .foregroundStyle(BrandColor.olive)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .disabled(loadingMore)
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 6)
                    .padding(.bottom, 12)

                    devicePhoneSection
                }
                // Pull to refresh, matching Android. Awaiting the real reload
                // settles the spinner when the data lands, not when the gesture
                // ends.
                .refreshable { await reload() }
            }
        }
    }

    /// #459 — the phone's own address book, its own group below the crew's.
    ///
    /// Never merged into the list above: four hundred personal numbers over
    /// forty shared ones would bury the thing the product is for. Two groups,
    /// each with its own heading, and a wide gap between them.
    @ViewBuilder
    private var devicePhoneSection: some View {
        // #547: every match, not the first fifty. The preview cap below is this
        // layout's decision and applies only while the group is collapsed.
        let matches = filterDeviceContacts(deviceRows, query: debouncedQ)
        let visible = (deviceExpanded || !debouncedQ.isEmpty)
            ? matches
            : Array(matches.prefix(devicePreviewRows))

        VStack(alignment: .leading, spacing: 0) {
            Text(t("contactsTasks.onThisPhone"))
                .font(.golos(14, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .padding(.horizontal, 4)

            if deviceAuthorized {
                Text(
                    matches.isEmpty
                        ? t("contactsTasks.devicePhoneNoMatch")
                        : t("contactsTasks.devicePhoneOwn")
                )
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted500)
                .padding(.horizontal, 4)
                .padding(.top, 3)

                if !visible.isEmpty {
                    PaperCard {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(visible.enumerated()), id: \.element.id) { index, row in
                                if index > 0 { RowDivider() }
                                deviceRow(row)
                            }
                        }
                    }
                    .padding(.top, 10)
                }

                if debouncedQ.isEmpty, !deviceExpanded, matches.count > devicePreviewRows {
                    Button(t("contactsTasks.showAllFromPhone")) { deviceExpanded = true }
                        .buttonStyle(.plain)
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 10)
                }
            } else {
                Text(t("contactsTasks.devicePhoneAsk"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted500)
                .padding(.horizontal, 4)
                .padding(.top, 3)

                if DeviceContactsAccess.canAsk {
                    Button(t("contactsTasks.showMyPhoneContacts")) {
                        Task { deviceAuthorized = await DeviceContactsAccess.request() }
                    }
                    .buttonStyle(.plain)
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .padding(.horizontal, 4)
                    .padding(.top, 8)
                } else {
                    // iOS never prompts twice. A button claiming it will is a
                    // button that lies, so this says where the switch actually
                    // lives.
                    Text(t("contactsTasks.contactsNeedSettings"))
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                        .padding(.horizontal, 4)
                        .padding(.top, 8)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 22)
        .padding(.bottom, 28)
    }

    /// One row of the phone's own address book.
    ///
    /// Tapping it TEXTS them, because that is what this product does and
    /// because a device contact has no detail screen here to open — it is not
    /// ours. The trailing action pulls them into the crew's shared book with
    /// the name the phone already had.
    @ViewBuilder
    private func deviceRow(_ row: DeviceContactListRow) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .font(.golos(15))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Text(formatPhone(row.number))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { AppRouter.shared.composeTo = row.number }

            Button {
                addFromDevice = row
            } label: {
                Image(systemName: "person.badge.plus")
                    .font(.scaled(15, weight: .regular))
                    .foregroundStyle(BrandColor.muted500)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(t("contactsTasks.addToContacts", ["name": row.name]))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func reload() async {
        if rows.isEmpty { state = .loading }
        do {
            let page = try await graph.contactsApi.contacts(
                companyId: companyId,
                q: debouncedQ.isEmpty ? nil : debouncedQ,
                limit: 50,
                field: fieldFilter?.key,
                value: fieldFilter?.value
            )
            rows = page.data
            nextCursor = page.next_cursor
            state = .ready(())
        } catch {
            // A FAILED search must never fall through to the rows already on
            // screen: that renders every contact in the workspace as though it
            // matched the query, with only a toast that clears itself to say
            // otherwise. Holding the previous rows while a search is merely in
            // flight is still right — that is the typing behaviour.
            // #291: a FILTERED list never keeps the rows already on screen
            // either — under a new filter those rows are precisely what was
            // excluded, which is the same failure as a fallen-through search.
            if rows.isEmpty || !debouncedQ.isEmpty || fieldFilter != nil {
                rows = []
                nextCursor = nil
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

    /// Read the picked file and check it against the shared bounds, then raise
    /// the consent sheet. Nothing leaves the phone in here.
    ///
    /// The bytes are read NOW rather than at upload time: the document picker's
    /// URL is only readable inside the security-scoped access granted with it,
    /// and that access cannot be held open across a sheet somebody is reading.
    ///
    /// The `Task` also buys the runloop turn between the file importer
    /// dismissing and the next sheet presenting — two presentations in the same
    /// turn is how a sheet silently fails to appear.
    private func stageImport(kind: ContactImportKind, url: URL) {
        notice = nil
        Task {
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
            var candidate = ContactImportCandidate(
                kind: kind,
                fileName: url.lastPathComponent,
                bytes: bytes
            )
            // #248 round 3: read what the file actually carries before anything
            // is uploaded, so the questions are asked beside the attestation
            // they make honest rather than after a refusal — and so the person
            // answering can see the VALUES.
            //
            // The two doors ask different questions because the two formats can
            // only say do-not-text in different places: a CSV in a column, a
            // .vcf in a property.
            switch kind {
            case .csv:
                let review = await ContactColumns.reviewFile(bytes)
                if review.rowCount > kind.maxRecords {
                    notice = kind.rowCapMessage
                    return
                }
                candidate.columns = review.columns
            case .vcard:
                candidate.properties = await VCardProperties.scanFile(bytes)
            }
            importCandidate = candidate
        }
    }

    /// Upload a candidate the reader has attested to.
    ///
    /// Takes the whole candidate rather than a `consentAttested: true` of its
    /// own — the attestation is set in one place, the consent sheet's confirm,
    /// and nothing between there and the wire re-states it.
    private func runImport(_ candidate: ContactImportCandidate) {
        importing = true
        notice = nil
        Task {
            defer { importing = false }
            do {
                let result: ImportResult
                switch candidate.kind {
                case .csv:
                    result = try await mutations.importCsv(
                        companyId: companyId,
                        fileName: candidate.fileName,
                        bytes: candidate.bytes,
                        consentAttested: candidate.consentAttested,
                        columns: candidate.declaredColumns
                    )
                case .vcard:
                    result = try await mutations.importVcard(
                        companyId: companyId,
                        fileName: candidate.fileName,
                        bytes: candidate.bytes,
                        consentAttested: candidate.consentAttested,
                        properties: candidate.declaredProperties
                    )
                }
                importReport = ImportReport(kind: candidate.kind, result: result)
                refreshKey += 1
            } catch {
                // #248: an import the server REFUSED is a terminal answer
                // about a file somebody just chose, and it can be a paragraph —
                // the columns nobody accounted for, named one by one. The notice
                // line is a five-second snackbar under the search box, which is
                // where that paragraph went to die: read by nobody, gone before
                // it could be acted on, and the refusal silent all over again.
                //
                // Only the two codes that mean "the server considered THIS FILE
                // and said no". A dropped connection or a 500 is not a fact
                // about the file, and putting it on paper would train people to
                // dismiss the sheet that matters.
                let code = (error as? ApiError)?.code
                if code == ApiErrorCode.validationFailed || code == ApiErrorCode.rateLimited {
                    importRefusal = ImportRefusal(
                        kind: candidate.kind,
                        message: error.userMessage
                    )
                } else {
                    notice = error.userMessage
                }
            }
        }
    }
}

/// Spec 27/07 contact identity mark: a soft-square initials tile on the
/// avatar tint (circles stay reserved for members/people elsewhere).
struct ContactSquareAvatar: View {
    let name: String?
    var size: CGFloat = 40
    var cornerRadius: CGFloat = 14
    var fontSize: CGFloat = 12.5
    var tint: Color = BrandColor.avatarTint

    var body: some View {
        // Kept as a named tile so both call sites read the same, but the badge itself
        // is the shared component now. Taking `fontSize` as a parameter is what hid
        // this copy from the #569 sweep: the frame size and the glyph literal never
        // appeared in the same file, so nothing here looked like the bug.
        InitialsAvatar(
            name: name,
            size: size,
            glyph: fontSize,
            typeface: .golos,
            shape: AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)),
            tint: tint
        )
    }
}

private struct ContactRow: View {
    let contact: Contact

    @Environment(\.appLocale) private var appLocale

    private var name: String {
        contact.name ?? formatPhone(contact.phone_e164)
    }

    /// Spec 27 sub line: the number, with last activity folded in when known.
    private var sub: String {
        let phone = formatPhone(contact.phone_e164)
        guard let lastActivity = contact.last_activity_at else { return phone }
        return "\(phone) · \(relativeTime(lastActivity))"
    }

    var body: some View {
        HStack(alignment: .center, spacing: 11) {
            ContactSquareAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text(name)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    if contact.opted_out {
                        DsChip(
                            text: AppStrings.translate(appLocale, "contactsTasks.optedOut"),
                            container: BrandColor.insetDeep,
                            content: BrandColor.muted700
                        )
                    }
                }
                Text(sub)
                    .font(.golos(11.5))
                    .monospacedDigit()
                    .foregroundStyle(BrandColor.muted400)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            // Decorative doorway glyph — the whole row opens the contact.
            Image(systemName: "message")
                .font(.scaled(15, weight: .medium))
                .foregroundStyle(BrandColor.muted900)
                .frame(width: 34, height: 34)
                .background(BrandColor.inset, in: Circle())
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 15)
    }
}

/// Create a contact by hand: US/CA phone with live NANP formatting (the
/// strict shared-module port validates before the server's authoritative
/// pass), plus optional name/address/notes. POST /v1/contacts upserts on the
/// phone, so re-adding an existing number just lands on the same row.
@MainActor
struct CreateContactSheet: View {
    let mutations: ContactMutations
    let companyId: String
    /// Prefill the phone field (the dialer's "Add contact" for a typed,
    /// unknown number, #186 item 5). Empty = a blank sheet.
    var prefillPhone: String = ""
    /// #459: the name the phone already had for this person. Filling it is the
    /// whole difference between pulling a device contact into the shared book
    /// and retyping it.
    var prefillName: String = ""
    let onCreated: @MainActor (Contact) -> Void

    @State private var phone: String
    @State private var name: String
    @State private var address = ""
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    init(
        mutations: ContactMutations,
        companyId: String,
        prefillPhone: String = "",
        prefillName: String = "",
        onCreated: @escaping @MainActor (Contact) -> Void
    ) {
        self.mutations = mutations
        self.companyId = companyId
        self.prefillPhone = prefillPhone
        self.prefillName = prefillName
        _name = State(initialValue: prefillName)
        self.onCreated = onCreated
        _phone = State(initialValue: Nanp.formatAsYouType(prefillPhone))
    }

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
                        Text(t("contactsTasks.nanpHint"))
                            .font(.caption)
                            .foregroundStyle(BrandColor.destructive)
                    }
                } header: {
                    Text(t("contactsTasks.phoneField"))
                }
                Section {
                    TextField(t("contactsTasks.optional"), text: $name)
                        .onChange(of: name) { _, next in
                            if next.count > contactNameMax {
                                name = String(next.prefix(contactNameMax))
                            }
                        }
                } header: {
                    Text(t("contactsTasks.nameField"))
                }
                Section {
                    TextField(t("contactsTasks.optional"), text: $address)
                        .onChange(of: address) { _, next in
                            if next.count > contactAddressMax {
                                address = String(next.prefix(contactAddressMax))
                            }
                        }
                } header: {
                    Text(t("contactsTasks.address"))
                }
                Section {
                    TextField(t("contactsTasks.optional"), text: $notes, axis: .vertical)
                        .lineLimit(2 ... 4)
                        .onChange(of: notes) { _, next in
                            if next.count > contactNotesMax {
                                notes = String(next.prefix(contactNotesMax))
                            }
                        }
                } header: {
                    Text(t("contactsTasks.notesField"))
                }
                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(BrandColor.destructive)
                }
            }
            .scrollContentBackground(.hidden)
            .background(BrandColor.canvas.ignoresSafeArea())
            .navigationTitle(t("contactsTasks.newContact"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        saving
                            ? t("contactsTasks.adding")
                            : t("contactsTasks.addContact")
                    ) { create() }
                        .disabled(normalized == nil || saving)
                }
            }
        }
        .tint(BrandColor.olive)
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

/// The import's authoritative outcome — imported/updated/skipped counts, what
/// the file's consent attestation could NOT be written to (#248), and the
/// per-row reasons for everything skipped, labeled 'Row N' (CSV) or 'Card N'
/// (vCard) exactly as the server reported them.
///
/// The consent section is the reason this screen was rebuilt. `ContactImportConsentSheet`
/// promises, before a byte is uploaded, that "anyone who has texted STOP stays
/// blocked" — and until the server started reporting refusals there was no
/// receipt for that promise anywhere in the product. A promise with no receipt
/// is the same silence #248 fixed underneath.
@MainActor
private struct ImportReportSheet: View {
    let report: ImportReport

    @Environment(\.dismiss) private var dismiss

    /// The consent half of the answer, decided once rather than re-derived by
    /// each of the three places below that ask about it.
    private let consent: ImportConsentOutcome

    /// An import that refused an attestation opens tall enough to show the
    /// refusal without a drag.
    ///
    /// A notice below the fold of a medium sheet is a notice most people never
    /// see, which is the silent refusal all over again. Both detents stay
    /// available so the reader can still shrink it — the sheet chooses where to
    /// START, it does not trap anybody.
    @State private var detent: PresentationDetent

    @Environment(\.appLocale) private var appLocale

    init(report: ImportReport) {
        self.report = report
        let consent = ImportConsentOutcome(report.result)
        self.consent = consent
        _detent = State(initialValue: consent.isEmpty ? .medium : .large)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                summary
                if !consent.isEmpty { consentSection }
                if !report.result.errors.isEmpty { skippedSection }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        // Pinned rather than last in the scroll: once a long refusal list is on
        // screen, a Done button at the bottom of the content is a button
        // somebody has to scroll past forty rows to reach.
        .safeAreaInset(edge: .bottom) { doneBar }
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium, .large], selection: $detent)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(AppStrings.translate(appLocale, "contactsTasks.importFinished"))
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(report.result.volumeSummary)
                .font(.golos(12.5))
                .monospacedDigit()
                .foregroundStyle(BrandColor.muted600)
        }
        .accessibilityElement(children: .combine)
    }

    /// What the attestation could not cover, above the skipped rows.
    ///
    /// Above, because it is the consequential half: a skipped row is a typo
    /// somebody fixes in a spreadsheet, and this is a person who told this
    /// business to stop. On paper rather than as another line of the summary,
    /// for the same reason the count is not a fourth term — a figure in a run
    /// of figures is a figure people read past.
    private var consentSection: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    // Baseline rather than top: an 11pt glyph top-aligned
                    // against 12.5pt text sits visibly high, and the optical
                    // correction is what makes the two read as one line.
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "hand.raised.fill")
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(BrandColor.destructive)
                        Text(consent.heading)
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    Text(consent.note)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted700)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // One element: the heading and the sentence explaining it are
                // one thought, and VoiceOver reading them as two makes the
                // second sound like an unrelated paragraph.
                .accessibilityElement(children: .combine)
                if !consent.rows.isEmpty { rowList(consent.rows) }
                // #248 B8: the heading carries the COUNT and the list carries
                // the rows, and a count larger than its list is a heading
                // reading "40 people" over five lines. A reader counts the
                // lines and concludes the heading is wrong — which is how a
                // number nobody believes stops being read at all.
                if let unlisted = consent.unlistedLine {
                    Text(unlisted)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
        }
    }

    private var skippedSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(AppStrings.translate(appLocale, "contactsTasks.skippedRowsHeading"))
                .font(.golos(11, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
            PaperCard {
                rowList(report.result.errors)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
            }
        }
    }

    /// One renderer for both lists — the server reports skipped rows and
    /// refused rows in the same shape, and `rowLine` is what keeps the label
    /// honest between a CSV's rows and a .vcf's cards.
    private func rowList(_ rows: [ImportResult.ImportRowError]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(rows.prefix(importErrorsShown).enumerated()), id: \.offset) { _, row in
                Text(report.kind.rowLine(row))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted700)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let hidden = rows.count - importErrorsShown
            if hidden > 0 {
                Text(
                    AppStrings.translate(
                        appLocale,
                        "contactsTasks.andMore",
                        ["count": "\(hidden)"]
                    )
                )
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var doneBar: some View {
        HStack {
            Spacer()
            Button(AppStrings.translate(appLocale, "contactsTasks.done")) { dismiss() }
                .tint(BrandColor.olive)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(BrandColor.canvas)
        .overlay(alignment: .top) { RowDivider() }
    }
}

/// An import the server refused — on paper, until somebody closes it.
///
/// #248. The refusal this exists for names the columns nobody accounted for and
/// asks for a person to look at them, which is an instruction, not a status. An instruction that deletes itself after five seconds is an
/// instruction nobody followed, and the file it was about is still sitting in
/// somebody's Files app carrying a "Do Not Call" column.
///
/// It says NOTHING WAS IMPORTED in its own voice above the server's paragraph:
/// the paragraph explains why, and the first thing anybody needs to know is
/// whether they now have half a contact book.
@MainActor
private struct ImportRefusedSheet: View {
    let refusal: ImportRefusal

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(AppStrings.translate(appLocale, "contactsTasks.nothingWasImported"))
                        .font(.golos(15, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    // `kind.label` is CSV / vCard — a file format, not a word.
                    Text(
                        refusal.kind.label
                            + AppStrings.translate(
                                appLocale, "contactsTasks.noContactsAddedOrChanged"
                            )
                    )
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                }
                .accessibilityElement(children: .combine)
                PaperCard {
                    HStack(alignment: .top, spacing: 11) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.scaled(13, weight: .medium))
                            .foregroundStyle(BrandColor.destructive)
                        Text(refusal.message)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted700)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button(AppStrings.translate(appLocale, "contactsTasks.done")) { dismiss() }
                    .tint(BrandColor.olive)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(BrandColor.canvas)
            .overlay(alignment: .top) { RowDivider() }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        // Opens LARGE and stays there. The message is the whole point of the
        // sheet, and a medium detent puts the half that names the columns below
        // the fold.
        .presentationDetents([.large])
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
        // #393: nil means a first text here would still carry the signature.
        first_identification_sent_at: nil,
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
    VStack {
        PaperCard {
            ContactRow(
                contact: previewContact(
                    id: "ct1",
                    phone: "+14165550134",
                    name: "Dana Whitcomb",
                    lastActivityAt: "2026-07-15T18:00:00Z"
                )
            )
            RowDivider()
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
        .padding(18)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BrandColor.canvas)
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
