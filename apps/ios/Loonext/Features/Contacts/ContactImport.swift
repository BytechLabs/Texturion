import Foundation
import SwiftUI

/// The contact importer's machine contract, hand-ported from
/// `packages/shared/src/contact-import.ts`.
///
/// # Why this is a port and not a handful of numbers typed here
///
/// #226 made `consent_attested` mandatory on CSV import, and no client ever
/// sent it. From 2026-07-28 every CSV import from this app answered with a 422
/// naming a form field the UI had no control for — the field name existed in
/// exactly one place, the server, and a field the server demands that no shared
/// contract names is a field the clients cannot be expected to send.
///
/// The caps had the mirror-image problem: this app typed its own 2 MB and 5 MB
/// beside the server's, so the phone could promise a file would import and the
/// server refuse it.
///
/// `ContactImportConsentTests` reads the TypeScript above and asserts these
/// values against it, so the port cannot quietly describe last month's
/// contract. The server stays the authority — it re-checks every one of them.
enum ContactImport {
    /// The multipart field carrying the importer's attestation.
    static let consentField = "consent_attested"

    /// The one value `consentField` may carry to pass. Only the literal string
    /// counts: a field that also accepts "false" is not an attestation, it is a
    /// field.
    static let consentValue = "true"

    /// Rows one CSV import may carry.
    static let maxRows = 2000

    /// Bytes of CSV text one import may carry.
    static let csvMaxBytes = 2 * 1024 * 1024

    /// Cards one .vcf may carry — the same CPU bound as the CSV row cap.
    static let vcardMaxCards = maxRows

    /// Bytes of vCard text one import may carry. Bigger: a card is verbose.
    static let vcardMaxBytes = 5 * 1024 * 1024

    /// What a refused attestation MEANS, for the case the server sends the
    /// count without the sentence.
    ///
    /// Every refusal normally arrives with `consent_refused_note` and that is
    /// what gets printed — a sentence about somebody's legal standing belongs
    /// to whoever wrote the record, not to whichever client happens to be
    /// drawing it. This is the fallback for a response that reports rows and no
    /// note, where the alternative is a number with no explanation attached and
    /// a reader left to guess; the guess available is "the import quietly
    /// dropped people", which is the opposite of what happened.
    ///
    /// A second copy of product copy is normally exactly how copy drifts. It
    /// cannot drift here: `ContactImportConsentTests` reads the sentence out of
    /// `packages/shared/src/contact-import.ts` and fails on any difference,
    /// which is the same treatment the four values above get.
    static let consentRefusedNote = """
        Some of these customers have already asked this business to stop texting \
        them. They were imported and their opt-out still stands — your consent \
        statement was not recorded against them.
        """

    // MARK: - #248 round 3: the declaration

    /// The multipart field a caller repeats, ONCE PER COLUMN, to say what that
    /// column is.
    ///
    /// # There is no classifier left, on any client or on the server
    ///
    /// Round one asked "does this dropped column mean do-not-contact" of the
    /// header WORD, and a file headed "Do Not Call" imported attested while a
    /// real text reached somebody it said not to contact. Round two asked it of
    /// the SHAPE of the values — few distinct, short, repeated — and three
    /// independent verifiers walked messages through it anyway, because a
    /// vocabulary of numbers is still a vocabulary.
    ///
    /// So the question is not asked. Every column of the file is either MAPPED
    /// to a field or EXPLICITLY DISMISSED, by index, up front, and the server
    /// refuses a file whose declaration does not cover it. There is no
    /// threshold left to be wrong about.
    ///
    /// # Why COMPLETE, and why up front
    ///
    /// Round two's field was sent only for the columns the server had just
    /// complained about, so the shortest path to a 200 was: post, read the
    /// column names out of the 422, post again. Two round trips and no human —
    /// which was demonstrated, live. A complete declaration removes the loop
    /// rather than policing it: the caller already has the file and its header
    /// row before it sends anything, so there is nothing for a refusal to
    /// teach it.
    ///
    /// # What this app adds, and it is the only thing that matters
    ///
    /// The server cannot tell a declaration a person made from one a client
    /// invented — see the shared docblock, which concedes exactly that. This
    /// app is where the person sits. `ContactImportConsentSheet` puts every
    /// column and its VALUES on the screen, and `declarations` below can only
    /// return columns somebody answered.
    static let columnField = "column"

    /// The declaration for a column that says nothing about who may be texted.
    static let ignoreAction = "ignore"

    /// The vCard door's twin of `columnField`, repeated once per property.
    ///
    /// That door had no gate at all: `CATEGORIES:DNC` and a `NOTE` saying they
    /// asked us to stop are the only two places a .vcf can say do-not-text,
    /// they are what Apple and Google actually export, and both were dropped
    /// without a word while the file's attestation was written over the top.
    static let vcardPropertyField = "property"

    /// The multipart fields one import posts.
    ///
    /// A function taking the reader's answers, rather than literals at the two
    /// call sites: hard-coding `consentValue` in the client would have this app
    /// state, on somebody else's behalf, that a file full of strangers asked to
    /// hear from this business. The server cannot tell a posted attestation
    /// from a fabricated one, so the only place that can refuse to fabricate it
    /// is here. The same is true, one step down, of every column declaration.
    ///
    /// An unattested import posts NO attestation field, and is refused by the
    /// server with its own sentence — rather than being silently blocked here,
    /// which would leave somebody tapping a button that does nothing.
    ///
    /// BOTH doors call this with one of the two lists empty. A CSV has no
    /// properties and a .vcf has no columns, and routing both through the one
    /// function is what keeps every field name in this file.
    static func formFields(
        consentAttested: Bool,
        columns: [ContactImportColumnDeclaration],
        properties: [VCardPropertyDeclaration]
    ) -> [(name: String, value: String)] {
        var fields: [(name: String, value: String)] = []
        if consentAttested {
            fields.append((name: consentField, value: consentValue))
        }
        for declaration in columns {
            fields.append((name: columnField, value: declaration.wire))
        }
        for declaration in properties {
            fields.append((name: vcardPropertyField, value: declaration.wire))
        }
        return fields
    }

    /// The columns somebody ANSWERED, and nothing else.
    ///
    /// THIS IS THE PROPERTY. A client that caught the server's refusal and
    /// re-posted with every column named in it — or, just as bad, one that
    /// defaulted the unrecognised columns to `ignore` and posted them — would
    /// have rebuilt the exact defect the gate exists for, with the server
    /// unable to tell the difference. Only an answer that came from the menu
    /// can reach the wire, and `gateReason` refuses to upload until every
    /// column has one.
    static func declarations(
        _ columns: [ContactImportColumn],
        answers: [Int: ContactImportColumnAction]
    ) -> [ContactImportColumnDeclaration] {
        columns
            .compactMap { column in
                guard let action = answers[column.index] else { return nil }
                return ContactImportColumnDeclaration(
                    index: column.index,
                    action: action,
                    header: column.header
                )
            }
            .sorted { $0.index < $1.index }
    }

    /// The same rule at the vCard door, over property names.
    static func propertyDeclarations(
        _ properties: [VCardProperty],
        answers: [String: VCardPropertyAction]
    ) -> [VCardPropertyDeclaration] {
        properties.compactMap { property in
            guard let action = answers[property.name] else { return nil }
            return VCardPropertyDeclaration(property: property.name, action: action)
        }
    }

    /// The answer every column STARTS on: a guess about what a column IS, and
    /// never a dismissal.
    ///
    /// # H1 — a machine guess must not be posted as a human answer
    ///
    /// `defaultContactImportColumns` in the shared contract USED TO fill every
    /// column its patterns did not recognise with `ignore`, and that was the
    /// ship blocker: `Phone,Name,Notes` over a Notes column reading "DO NOT CALL
    /// - asked us to stop" came back a COMPLETE declaration, every client posted
    /// it with no interaction at all, the server accepted it because it was
    /// complete, and the send returned 201 with a message created. Round three
    /// narrowed that function's answer to a field or nothing — `ignore` is not
    /// in its type — so neither end can manufacture a dismissal now.
    ///
    /// This function is that rule in Swift, and it is held by the SHAPE of what
    /// it returns rather than by anybody remembering: an unrecognised column
    /// gets no entry, and "no entry" is exactly what `gateReason` reads as
    /// unanswered. What is asserted is the property itself rather than the
    /// absence of a line — `testTheGuessNeverAnswersAColumnItDidNotRecognise`
    /// fails on an `.ignore` among these values whatever produced it.
    ///
    /// A recognised column is different in kind, and this is the part that is
    /// allowed to be one tap: the guess is about what the column IS, it is drawn
    /// as a changeable chip BESIDE THAT COLUMN'S OWN VALUES, and getting it
    /// wrong cannot lower anybody's standing. What makes accepting it honest is
    /// not this function — it is that the sheet draws every column and its
    /// values above an attestation that starts unticked. See `columnsCard`, and
    /// the two tests that pin that order.
    static func guessedAnswers(
        _ columns: [ContactImportColumn]
    ) -> [Int: ContactImportColumnAction] {
        var answers: [Int: ContactImportColumnAction] = [:]
        for column in columns {
            // Spelled out for the same reason as everywhere else in this
            // feature: the destination is an optional, and implicit member
            // lookup through one is not a thing to learn about from CI.
            if let guess = column.guess {
                answers[column.index] = ContactImportColumnAction.field(guess)
            }
        }
        return answers
    }

    /// What the reader is still being asked for, or nil when nothing is.
    ///
    /// One function for the gate AND for the sentence under the button, so the
    /// two cannot come to disagree. A primary action that is grey for a reason
    /// nobody printed is a dead end somebody meets on their first day, and this
    /// screen is somebody's first day by definition.
    ///
    /// Each clause failed in the field, and each is separately provable:
    ///
    ///   the blocker — the do-not-text column somebody named cannot be read.
    ///   every column answered — #248, the column nobody was asked about.
    ///   every property answered — #248 round 3, the vCard door with no gate.
    ///   `attested` — #226, the field no client ever sent.
    static func gateReason(
        _ candidate: ContactImportCandidate,
        attested: Bool,
        columnAnswers: [Int: ContactImportColumnAction],
        propertyAnswers: [String: VCardPropertyAction]
    ) -> String? {
        if let blocker = ContactColumns.blocker(candidate.columns, answers: columnAnswers) {
            return blocker.wayOut
        }
        let columns = candidate.columns.filter { columnAnswers[$0.index] == nil }.count
        if columns > 0 { return ContactColumns.unansweredReason(columns) }
        let properties = candidate.properties.filter { propertyAnswers[$0.name] == nil }.count
        if properties > 0 { return VCardProperties.unansweredReason(properties) }
        if !attested { return attestationReason }
        return nil
    }

    /// The last thing left to do, when it is the only thing left to do.
    static let attestationReason = "Confirm the statement above to import."

    /// May this file be uploaded at all?
    ///
    /// Defined as "there is nothing left to ask for", so a condition added to
    /// `gateReason` gates the button whether or not anybody remembered to add
    /// it here. Held outside the view so the one property that matters —
    /// nothing is uploaded until every question has an answer — can be asserted
    /// without standing up a SwiftUI host.
    static func mayImport(
        _ candidate: ContactImportCandidate,
        attested: Bool,
        columnAnswers: [Int: ContactImportColumnAction],
        propertyAnswers: [String: VCardPropertyAction]
    ) -> Bool {
        gateReason(
            candidate,
            attested: attested,
            columnAnswers: columnAnswers,
            propertyAnswers: propertyAnswers
        ) == nil
    }

    /// A byte cap said out loud, derived from the cap itself so the sentence
    /// cannot outlive the number it describes.
    static func megabytes(_ bytes: Int) -> String {
        let value = Double(bytes) / (1024 * 1024)
        let whole = value.rounded()
        // A cap that is not a whole number of megabytes keeps one decimal
        // rather than rounding to a figure a file could pass and the server
        // reject.
        let text = abs(value - whole) < 0.05
            ? String(Int(whole))
            : String(format: "%.1f", value)
        return text + " MB"
    }
}

/// Which import a picked document feeds.
enum ContactImportKind {
    case csv, vcard

    /// Reported rows label honestly: 'Row N' (CSV) or 'Card N' (vCard).
    ///
    /// A .vcf has cards, and calling one a row sends somebody looking for a row
    /// number the file does not have.
    var rowWord: String { self == .csv ? "Row" : "Card" }

    var label: String { self == .csv ? "CSV" : "vCard" }

    var maxBytes: Int {
        self == .csv ? ContactImport.csvMaxBytes : ContactImport.vcardMaxBytes
    }

    var maxRecords: Int {
        self == .csv ? ContactImport.maxRows : ContactImport.vcardMaxCards
    }

    var contentType: String { self == .csv ? "text/csv" : "text/vcard" }

    var icon: String { self == .csv ? "tablecells" : "person.crop.rectangle.stack" }

    /// Both bounds in one line, both read from the contract — what this file is
    /// allowed to be, said before it is sent rather than after it is refused.
    var limitsLine: String {
        let unit = self == .csv ? "rows" : "cards"
        return label + " · up to \(maxRecords.formatted()) " + unit
            + ", " + ContactImport.megabytes(maxBytes)
    }

    var sizeMessage: String {
        label + " files must be " + ContactImport.megabytes(maxBytes) + " or less."
    }

    /// The row cap said out loud, with the way out attached.
    ///
    /// The way out is load-bearing rather than polite: splitting an 8000-row
    /// book into four files is the behaviour this product asks for, and the
    /// import limiter was raised to six a minute so that the fourth part is not
    /// refused. A cap with no instruction is a dead end somebody meets on their
    /// first day.
    var rowCapMessage: String {
        let unit = self == .csv ? "rows" : "cards"
        return label + " files must be " + maxRecords.formatted() + " " + unit
            + " or fewer. Split the file and import it in parts."
    }

    /// One reported row, labeled by what the file actually contains.
    ///
    /// The reason is printed EXACTLY as the server sent it, including the
    /// number it names. Prettifying that phone would mean picking the E.164 out
    /// of the server's sentence and putting a reformatted one back — a parse of
    /// prose, which breaks silently the first time the sentence is reworded,
    /// and the thing it breaks is the answer to "which of them?".
    ///
    /// Shared by the skipped rows and the refused rows because the server
    /// reports both in the same shape; reading them two different ways on one
    /// sheet would make the second look like a different kind of fact.
    func rowLine(_ reported: ImportResult.ImportRowError) -> String {
        "\(rowWord) \(reported.row) — \(reported.reason)"
    }
}

extension ImportResult {
    /// The import's three VOLUME figures, in one line.
    ///
    /// `consent_refused` is deliberately absent. Read as a fourth term beside
    /// "skipped" it invites the arithmetic that those rows did not land — and
    /// they did land: they were imported, and only the file's attestation was
    /// refused against them. The server names the two separately for the same
    /// reason. The refusal gets a section of its own, where there is room to
    /// say what it means instead of a number in a run of numbers.
    var volumeSummary: String {
        [
            "\(imported) imported",
            "\(updated) updated",
            "\(skipped) skipped",
        ].joined(separator: " · ")
    }
}

/// What one finished import has to say about consent.
///
/// # Why this is a type and not three lines inside the sheet
///
/// #248 found three ways the server manufactured consent over a standing STOP,
/// and all three are fixed there — but the repair only reaches a workspace if
/// the app says so. A client that received the correction and drew nothing
/// would be the fourth way: the uploader still believes the file did what its
/// attestation said, and nobody finds out until a carrier complaint arrives.
///
/// So the one property that matters — a refusal is never silent — is decided
/// here, in something that can be asserted without standing up a SwiftUI host.
struct ImportConsentOutcome {
    /// Rows the file's attestation was NOT written to.
    let refused: Int

    /// Those rows, exactly as the server named them.
    let rows: [ImportResult.ImportRowError]

    /// The sentence explaining what a refusal means.
    let note: String

    init(_ result: ImportResult) {
        // The LARGER of the two figures the server sent. They can only
        // disagree by the list being shorter than the count — a cap, a
        // truncation, a field a proxy dropped — and every one of those
        // directions hides refusals, which is the failure this whole section
        // exists to prevent. Taking the list's length alone would let a
        // stripped `consent_refusals` silence a refusal that was reported.
        refused = max(result.consent_refused, result.consent_refusals.count)
        rows = result.consent_refusals
        note = result.consent_refused_note ?? ContactImport.consentRefusedNote
    }

    /// Nothing refused, nothing to say.
    ///
    /// An empty consent section on every clean import is how a section stops
    /// being read on the one import that has something in it.
    var isEmpty: Bool { refused == 0 }

    /// Refusals the answer COUNTED and did not NAME.
    ///
    /// Zero in every response we ship today — the server builds the count from
    /// the list it sends, precisely so the two cannot disagree. It is not zero
    /// for a response a proxy trimmed, or for a future server that caps the
    /// list, and the failure it prevents is the one #248 B8 found on the way
    /// past: a heading reading "40 people" over five rows, with nothing on
    /// screen saying the other thirty-five exist. A reader counts the rows.
    var unlisted: Int { max(0, refused - rows.count) }

    /// Said out loud, because the alternative is a number nobody can reconcile
    /// with what is under it.
    var unlistedLine: String? {
        guard unlisted > 0 else { return nil }
        return "\(unlisted.formatted()) more were refused and this answer did not name them."
    }

    /// The outcome in this app's voice, carrying the number.
    ///
    /// Not a paraphrase of `note`: this says what happened and to how many, and
    /// the note says what it means for the people it happened to. The count is
    /// the half the sentence cannot carry, because the server writes one
    /// sentence for every import.
    var heading: String {
        refused == 1
            ? "Consent not recorded for 1 person"
            : "Consent not recorded for \(refused.formatted()) people"
    }
}

/// One picked file, read and size-checked, waiting on its declaration.
///
/// Carries the BYTES rather than the URL: a security-scoped URL from the
/// document picker is only readable inside the access it was granted, and this
/// sits on screen for as long as somebody takes to read the question.
struct ContactImportCandidate: Identifiable {
    let id = UUID()
    let kind: ContactImportKind
    let fileName: String
    let bytes: Data

    /// #248 round 3: EVERY column this file's data implies, in order, with no
    /// gaps and no exemptions — including a column that exists only because one
    /// row runs past the header row, and including one that is entirely empty.
    /// Empty for a vCard, which has no columns.
    ///
    /// Read off the file itself before anything was uploaded, so the question
    /// is asked beside the attestation it makes honest rather than after a
    /// refusal, and so the person answering can see what each column SAYS.
    var columns: [ContactImportColumn] = []

    /// #248 round 3: every property these cards carry that the importer does
    /// not read. Empty for a CSV.
    var properties: [VCardProperty] = []

    /// #226: the reader's own answer, and the only thing that puts the
    /// attestation on the wire.
    ///
    /// Starts false and is written in exactly ONE place — the confirm button in
    /// `ContactImportConsentSheet`, which cannot fire until the box is ticked.
    /// A `consentAttested: true` written anywhere else would be this app
    /// attesting on a person's behalf, so `ContactImportConsentTests` scans the
    /// feature for that literal and fails on it.
    var consentAttested = false

    /// #248 round 3: what somebody said each column is.
    ///
    /// The same rule as the attestation above, and for the same reason: the
    /// server cannot tell a declaration somebody made from one a client
    /// assembled out of its own guesses. Written in exactly one place, out of
    /// `ContactImport.declarations`, out of answered menus — and the scan holds
    /// that.
    var declaredColumns: [ContactImportColumnDeclaration] = []

    /// The vCard door's twin, under the same rule.
    var declaredProperties: [VCardPropertyDeclaration] = []
}

/// The question an import has to ask before it uploads anybody.
///
/// # Why there is a sheet here at all
///
/// A contact import is the highest-volume door consent comes through, and until
/// #226 it was the only one with no question attached: a thousand numbers could
/// arrive with no recorded basis, which is exactly the file a carrier audit or
/// a plaintiff's lawyer asks about. The other two doors already ask — an
/// inbound text records `inbound_sms` by itself, and adding one contact by hand
/// attests as it sends.
///
/// # And why it now asks about every column
///
/// #248 round 3. Two rounds of guessing which dropped columns meant
/// do-not-contact both ended with a message delivered to somebody who had said
/// stop. There is no guess left: every column is either mapped or dismissed, by
/// a person who can see its values, and this screen is where that happens. The
/// detector still fills in what it recognises — that is a convenience and it is
/// shown as a chip anybody can change — but a column it did not recognise
/// arrives with NO answer, and nothing is uploaded until it has one.
///
/// It is raised AFTER the file is picked, so the statement is about a file the
/// reader can see the name of, and so a file that is simply too big is refused
/// before anyone is asked to swear to anything.
@MainActor
struct ContactImportConsentSheet: View {
    let candidate: ContactImportCandidate
    let onConfirm: @MainActor (ContactImportCandidate) -> Void

    /// Deliberately NOT pre-ticked, and the one place in this app where a smart
    /// default would be a defect rather than a courtesy: a box that arrives
    /// already ticked is not an attestation anybody made.
    @State private var attested = false

    /// What each column has been said to be, by index. A column ABSENT from
    /// this dictionary is unanswered, which is the state the gate reads.
    @State private var columnAnswers: [Int: ContactImportColumnAction] = [:]

    /// The vCard door's twin, by property name.
    @State private var propertyAnswers: [String: VCardPropertyAction] = [:]

    /// Which columns have been asked to show every value they hold, by index.
    ///
    /// Bounded by default because thirty columns of full value lists is a screen
    /// nobody reads; complete on request because that is the reading this whole
    /// flow claims happened before somebody dismissed a column. Held here rather
    /// than per row because `columnRow` is a function on this view, not a view of
    /// its own with state to keep.
    @State private var showAllColumnValues: Set<Int> = []

    /// The vCard door's twin, by property name.
    @State private var showAllPropertyValues: Set<String> = []

    /// Seeding runs once. `onAppear` can fire again when the sheet returns from
    /// a system menu, and a second seed would quietly undo an answer somebody
    /// had already changed.
    @State private var seeded = false

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    /// The sentence being sworn to. Held apart from the row that draws it so
    /// the VoiceOver label and the printed label cannot drift.
    ///
    /// #228: the sentence comes from the catalogue under Android's own key, so
    /// the claim reads identically on both phones. What is POSTED is still
    /// `ContactImport.consentField` = `consentValue` — a fixed wire pair, never
    /// this sentence — so translating the display cannot change what a
    /// workspace attested to.
    private var attestation: String {
        AppStrings.translate(appLocale, "contactsTasks.importAttestation")
    }

    /// What VoiceOver reads out for the box. A `String`, not a literal in the
    /// modifier: `accessibilityValue` has both a `LocalizedStringKey` and a
    /// `StringProtocol` overload, and a bare ternary of two literals leaves the
    /// type checker to guess between them.
    private var attestationState: String {
        attested ? "Confirmed" : "Not confirmed"
    }

    /// What a column with no answer shows in its chip.
    static let unansweredLabel = "Choose"

    /// The one gate and its one sentence, both decided outside the view.
    private var gateReason: String? {
        ContactImport.gateReason(
            candidate,
            attested: attested,
            columnAnswers: columnAnswers,
            propertyAnswers: propertyAnswers
        )
    }

    /// The named gate, asked by name rather than inferred from the sentence
    /// above it. The two cannot disagree — `mayImport` IS "nothing left to ask
    /// for" — and asking both means a refactor that loses one still trips the
    /// other.
    private var canConfirm: Bool {
        ContactImport.mayImport(
            candidate,
            attested: attested,
            columnAnswers: columnAnswers,
            propertyAnswers: propertyAnswers
        )
    }

    /// The file this app will not upload however the rest is answered — the
    /// do-not-text column somebody named holds values we cannot read.
    ///
    /// Drawn BESIDE the list rather than instead of it, which is the change
    /// from round two. That blocker came out of the detector and nothing on the
    /// screen could affect it; this one comes out of an answer somebody just
    /// gave, so the list has to stay in front of them.
    private var blocker: ContactImportBlocker? {
        ContactColumns.blocker(candidate.columns, answers: columnAnswers)
    }

    private var unansweredColumns: Int {
        candidate.columns.filter { columnAnswers[$0.index] == nil }.count
    }

    private var unansweredProperties: Int {
        candidate.properties.filter { propertyAnswers[$0.name] == nil }.count
    }

    /// A file with anything to answer opens TALL: what it has to say is longer
    /// than a medium detent holds, and a question below the fold gets answered
    /// by whoever finds the button first.
    ///
    /// A property rather than a ternary inside the modifier, so the two arms
    /// are typed against `Set<PresentationDetent>` rather than against each
    /// other.
    private var detents: Set<PresentationDetent> {
        candidate.columns.isEmpty && candidate.properties.isEmpty
            ? [.medium, .large]
            : [.large]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    fileCard
                    // Bound to differently-named locals rather than written as
                    // the `if let x` shorthand: the right-hand side is a
                    // computed property on self, and the shorthand's name
                    // lookup through an implicit self inside a ViewBuilder is
                    // not a thing to discover from a CI log.
                    if let unreadable = blocker { blockedCard(unreadable) }
                    if !candidate.columns.isEmpty { columnsCard }
                    if !candidate.properties.isEmpty { propertiesCard }
                    attestationCard
                    consequences
                    if let reason = gateReason { gateLine(reason) }
                }
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(BrandColor.canvas.ignoresSafeArea())
            .navigationTitle(
                AppStrings.translate(appLocale, "contactsTasks.beforeImporting")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) {
                        // #556: a plain press. The weight on this screen belongs
                        // to the import landing, not to backing out of it.
                        Haptics.tap()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        AppStrings.translate(appLocale, "contactsTasks.importAction")
                    ) { confirm() }
                        .disabled(!canConfirm)
                }
            }
        }
        .tint(BrandColor.olive)
        .presentationDetents(detents)
        .onAppear {
            guard !seeded else { return }
            seeded = true
            // The detector's guesses, and ONLY those — see
            // `ContactImport.guessedAnswers` for why the unrecognised columns
            // deliberately arrive with nothing in them.
            columnAnswers = ContactImport.guessedAnswers(candidate.columns)
        }
    }

    /// What is about to be uploaded, and what it is allowed to be. Tight
    /// spacing: the name and its bounds are one thought.
    private var fileCard: some View {
        PaperCard {
            HStack(spacing: 11) {
                Image(systemName: candidate.kind.icon)
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(BrandColor.muted900)
                    .frame(width: 34, height: 34)
                    .background(BrandColor.inset, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.fileName)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(candidate.kind.limitsLine)
                        .font(.golos(11.5))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted400)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
        }
    }

    private var attestationCard: some View {
        PaperCard {
            Button {
                attested.toggle()
            } label: {
                HStack(alignment: .top, spacing: 11) {
                    // The box is drawn in BOTH states — an unticked row that
                    // looked like plain copy is a row nobody reads as a choice.
                    Image(systemName: attested ? "checkmark.square.fill" : "square")
                        .font(.scaled(17, weight: .regular))
                        .foregroundStyle(attested ? BrandColor.olive : BrandColor.muted400)
                    Text(attestation)
                        .font(.golos(13.5, weight: .medium))
                        .foregroundStyle(BrandColor.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(attestation)
            .accessibilityValue(attestationState)
        }
    }

    // MARK: - #248 round 3: every column, accounted for

    /// The whole file's columns, one row each, with what they hold.
    ///
    /// ABOVE the attestation, because it is what makes the attestation
    /// truthful: "everyone in this file agreed" is a claim somebody cannot
    /// honestly make about a file with a "Do Not Call" column in it, and asking
    /// for the claim first would be asking them to swear to something before
    /// showing them the reason to doubt it.
    private var columnsCard: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    // Baseline rather than top: an 11pt glyph top-aligned
                    // against 12.5pt text sits visibly high, and the optical
                    // correction is what makes the two read as one line.
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "tablecells.badge.ellipsis")
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(BrandColor.muted900)
                        Text(ContactColumns.columnsHeading)
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(
                            ContactColumns.answeredLine(
                                answered: candidate.columns.count - unansweredColumns,
                                total: candidate.columns.count
                            )
                        )
                        .font(.golos(11, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(
                            unansweredColumns == 0 ? BrandColor.muted500 : BrandColor.overdueAmber
                        )
                    }
                    Text(ContactColumns.columnsExplanation + " " + ContactColumns.ignoreMeaning)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted700)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(candidate.columns) { column in
                        if column.index > 0 { RowDivider() }
                        columnRow(column)
                    }
                }
                if unansweredColumns > 0 { ignoreRestButton }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
        }
    }

    private func columnRow(_ column: ContactImportColumn) -> some View {
        let showingAll = showAllColumnValues.contains(column.index)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(column.title)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    // What the column SAYS, which is the only thing that lets
                    // anybody decide. A name alone ("Status") is not a question
                    // anybody can answer, and a name is all round two ever showed.
                    Text(column.line(showingAll: showingAll))
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                    if showingAll, column.total > column.values.count {
                        Text(
                            ContactColumns.valueCeilingNote(
                                shown: column.values.count,
                                total: column.total,
                                locale: appLocale
                            )
                        )
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 8)
                columnMenu(column)
            }
            // BELOW the values and OUTSIDE the combined element, so it stays a
            // control a screen reader can reach. The values are one block of text
            // on purpose; the thing that reveals the rest of them is not text.
            if column.total > column.samples.count {
                showAllValuesButton(total: column.total, showingAll: showingAll) {
                    if showingAll {
                        showAllColumnValues.remove(column.index)
                    } else {
                        showAllColumnValues.insert(column.index)
                    }
                }
            }
        }
        .padding(.vertical, 9)
    }

    /// The control that puts every value a column or property holds on screen.
    ///
    /// One button for both doors: the question ("have I seen what this holds?") is
    /// the same whether the file was a spreadsheet or a stack of cards, and two
    /// controls that differed would be two chances to fix only one of them.
    private func showAllValuesButton(
        total: Int,
        showingAll: Bool,
        toggle: @escaping () -> Void
    ) -> some View {
        Button(action: toggle) {
            Text(
                showingAll
                    ? ContactColumns.showFewerValuesLabel(locale: appLocale)
                    : ContactColumns.showAllValuesLabel(total: total, locale: appLocale)
            )
            .font(.golos(11, weight: .semibold))
            .foregroundStyle(BrandColor.ink)
            .padding(.top, 4)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
    }

    private func columnMenu(_ column: ContactImportColumn) -> some View {
        let chosen = columnAnswers[column.index]
        return Menu {
            ForEach(ContactImportColumnAction.answers, id: \.self) { action in
                Button {
                    columnAnswers[column.index] = action
                } label: {
                    Label(action.label, systemImage: action.icon)
                }
            }
        } label: {
            answerChip(icon: chosen?.icon, label: chosen?.label, answered: chosen != nil)
        }
        .accessibilityLabel(column.title + " — what this column holds")
        .accessibilityValue(chosen?.label ?? Self.unansweredLabel)
    }

    /// The bulk answer, and the ONLY one this app offers.
    ///
    /// It sits at the bottom of the list on purpose — reaching it means having
    /// scrolled past every remaining column and the values under it, which is
    /// this screen's version of "the columns are on screen when it is pressed".
    /// The same button at the top of the card would be a way to skip the
    /// screen, which is the screen's exact opposite.
    private var ignoreRestButton: some View {
        Button {
            for column in candidate.columns where columnAnswers[column.index] == nil {
                // Spelled out rather than `.ignore`: the destination is an
                // OPTIONAL action, and implicit member lookup through an
                // Optional is not worth a CI round trip on a client that has no
                // compiler here.
                columnAnswers[column.index] = ContactImportColumnAction.ignore
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "minus.circle")
                    .font(.scaled(11, weight: .semibold))
                Text(ContactColumns.ignoreRestLabel(unansweredColumns))
                    .font(.golos(11.5, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(BrandColor.muted700)
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity)
            .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            ContactColumns.ignoreRestLabel(unansweredColumns) + ". " + ContactColumns.ignoreMeaning
        )
    }

    // MARK: - #248 round 3: the vCard door's twin

    private var propertiesCard: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "list.bullet.rectangle")
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(BrandColor.muted900)
                        Text(VCardProperties.heading)
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(
                            ContactColumns.answeredLine(
                                answered: candidate.properties.count - unansweredProperties,
                                total: candidate.properties.count
                            )
                        )
                        .font(.golos(11, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(
                            unansweredProperties == 0
                                ? BrandColor.muted500
                                : BrandColor.overdueAmber
                        )
                    }
                    Text(VCardProperties.explanation + " " + ContactColumns.ignoreMeaning)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted700)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(candidate.properties) { property in
                        // A rule between rows, never above the first. Compared
                        // on the id rather than an enumerated offset: the tuple
                        // `enumerated()` hands ForEach is not Identifiable, and
                        // the keypath dance around that is a compile error
                        // nobody here can see until CI runs.
                        if property.id != candidate.properties.first?.id { RowDivider() }
                        propertyRow(property)
                    }
                }
                if unansweredProperties > 0 { ignoreRestPropertiesButton }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
        }
    }

    private func propertyRow(_ property: VCardProperty) -> some View {
        let showingAll = showAllPropertyValues.contains(property.name)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(property.title)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(property.line(showingAll: showingAll))
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                    if showingAll, property.total > property.values.count {
                        Text(
                            ContactColumns.valueCeilingNote(
                                shown: property.values.count,
                                total: property.total,
                                locale: appLocale
                            )
                        )
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 8)
                propertyMenu(property)
            }
            // The spreadsheet door's twin. `CATEGORIES` on four hundred cards has
            // one value that matters and it is not always in the first five.
            if property.total > property.samples.count {
                showAllValuesButton(total: property.total, showingAll: showingAll) {
                    if showingAll {
                        showAllPropertyValues.remove(property.name)
                    } else {
                        showAllPropertyValues.insert(property.name)
                    }
                }
            }
        }
        .padding(.vertical, 9)
    }

    private func propertyMenu(_ property: VCardProperty) -> some View {
        let chosen = propertyAnswers[property.name]
        return Menu {
            ForEach(VCardPropertyAction.allCases, id: \.self) { action in
                Button {
                    propertyAnswers[property.name] = action
                } label: {
                    Label(action.label, systemImage: action.icon)
                }
            }
        } label: {
            answerChip(icon: chosen?.icon, label: chosen?.label, answered: chosen != nil)
        }
        .accessibilityLabel(property.title + " — what this property means")
        .accessibilityValue(chosen?.label ?? Self.unansweredLabel)
    }

    private var ignoreRestPropertiesButton: some View {
        Button {
            for property in candidate.properties where propertyAnswers[property.name] == nil {
                propertyAnswers[property.name] = VCardPropertyAction.ignore
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "minus.circle")
                    .font(.scaled(11, weight: .semibold))
                Text(VCardProperties.ignoreRestLabel(unansweredProperties))
                    .font(.golos(11.5, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(BrandColor.muted700)
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity)
            .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            VCardProperties.ignoreRestLabel(unansweredProperties) + ". "
                + ContactColumns.ignoreMeaning
        )
    }

    // MARK: - Shared pieces

    /// One answer, as a chip. Amber while it is still a question, lime once it
    /// carries a field, plain grey once somebody has dismissed it — a fill and
    /// its label per state, never a colour doing both jobs.
    private func answerChip(icon: String?, label: String?, answered: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon ?? "questionmark")
                .font(.scaled(10, weight: .semibold))
            Text(label ?? Self.unansweredLabel)
                .font(.golos(11.5, weight: .semibold))
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.scaled(8, weight: .semibold))
        }
        .foregroundStyle(answered ? BrandColor.muted900 : BrandColor.overdueAmber)
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(answered ? BrandColor.inset : BrandColor.amberBg, in: Capsule())
        .contentShape(Capsule())
    }

    /// A file that cannot be imported however the rest is answered.
    ///
    /// The one case left, and it is fixed in the FILE — see
    /// `ContactImportBlocker`. The card says what marking the column Ignore
    /// instead would actually do, because somebody will otherwise find that out
    /// by tapping it.
    private func blockedCard(_ blocker: ContactImportBlocker) -> some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.scaled(11, weight: .medium))
                        .foregroundStyle(BrandColor.destructive)
                    Text(blocker.title)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                Text(blocker.detail)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted700)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // One element: the heading and the sentence explaining it are one
            // thought, and VoiceOver reading them as two makes the second sound
            // like an unrelated paragraph.
            .accessibilityElement(children: .combine)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
        }
    }

    /// Three facts, in the order somebody actually worries about them: what
    /// this records, and the two things it will not touch. Any more than this
    /// and the sheet stops being read at all.
    private var consequences: some View {
        VStack(alignment: .leading, spacing: 9) {
            consequence("person.badge.clock", "contactsTasks.importRecordsYourName")
            consequence("checkmark.shield", "contactsTasks.importKeepsExistingConsent")
            consequence("hand.raised", "contactsTasks.importStopStaysBlocked")
        }
    }

    /// Takes the catalogue KEY rather than the sentence — there is one call
    /// site per line and the lookup belongs where the row is drawn.
    private func consequence(_ icon: String, _ key: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon)
                .font(.scaled(12, weight: .medium))
                .foregroundStyle(BrandColor.muted400)
                .frame(width: 16, alignment: .center)
            Text(AppStrings.translate(appLocale, key))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// Why Import is grey, printed under it.
    ///
    /// A disabled primary with nothing beside it is a dead end, and this screen
    /// is somebody's first day by definition. The sentence comes from the same
    /// function as the gate, so it cannot describe a different condition.
    private func gateLine(_ reason: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: "arrow.up.circle")
                .font(.scaled(11, weight: .medium))
                .foregroundStyle(BrandColor.overdueAmber)
            Text(reason)
                .font(.golos(11.5, weight: .medium))
                .foregroundStyle(BrandColor.overdueAmber)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.amberBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func confirm() {
        // The disabled button already holds this. Repeated because the gate is
        // the whole point of the screen, and a future refactor that reaches
        // this action another way must not be able to skip it.
        guard canConfirm else { return }
        var confirmed = candidate
        confirmed.consentAttested = true
        // Built out of the answered menus, never out of the column list — see
        // `ContactImport.declarations`. A client that posted a declaration for
        // every column because the gate above said they were all answered would
        // be one refactor away from posting it because the gate had moved.
        confirmed.declaredColumns = ContactImport.declarations(
            candidate.columns,
            answers: columnAnswers
        )
        confirmed.declaredProperties = ContactImport.propertyDeclarations(
            candidate.properties,
            answers: propertyAnswers
        )
        onConfirm(confirmed)
        dismiss()
    }
}

// MARK: - Previews

#Preview("Import consent — CSV") {
    ContactImportConsentSheet(
        candidate: ContactImportCandidate(
            kind: .csv,
            fileName: "customers-export-2026-08.csv",
            bytes: Data(),
            columns: [
                ContactImportColumn(
                    index: 0,
                    header: "Phone",
                    samples: ["+14165550100", "+14165550101"],
                    guess: .phone
                ),
                ContactImportColumn(
                    index: 1,
                    header: "Name",
                    samples: ["Dave Chen", "Sam Ali"],
                    guess: .name
                ),
            ]
        ),
        onConfirm: { _ in }
    )
}

#Preview("Import consent — vCard") {
    ContactImportConsentSheet(
        candidate: ContactImportCandidate(
            kind: .vcard,
            fileName: "Contacts.vcf",
            bytes: Data()
        ),
        onConfirm: { _ in }
    )
}

#Preview("Import consent — a column nobody has answered") {
    ContactImportConsentSheet(
        candidate: ContactImportCandidate(
            kind: .csv,
            fileName: "acme-crm-export.csv",
            bytes: Data(),
            columns: [
                ContactImportColumn(
                    index: 0,
                    header: "Phone",
                    samples: ["+14165550100", "+14165550101"],
                    guess: .phone
                ),
                ContactImportColumn(
                    index: 1,
                    header: "Marketing Status",
                    samples: ["active", "DO NOT CALL"]
                ),
                // The column past the end of the header row — the one round two
                // never looked at, drawn like any other.
                ContactImportColumn(index: 2, header: "", samples: ["asked us to stop"]),
            ]
        ),
        onConfirm: { _ in }
    )
}

#Preview("Import consent — vCard properties") {
    ContactImportConsentSheet(
        candidate: ContactImportCandidate(
            kind: .vcard,
            fileName: "iCloud-contacts.vcf",
            bytes: Data(),
            properties: [
                VCardProperty(name: "CATEGORIES", cards: 12, samples: ["DNC", "Friends"]),
                VCardProperty(
                    name: "NOTE",
                    cards: 3,
                    samples: ["DO NOT CONTACT - asked us to stop"]
                ),
                VCardProperty(name: "EMAIL", cards: 40, samples: ["dave@example.com"]),
            ]
        ),
        onConfirm: { _ in }
    )
}

#Preview("Import consent — the do-not-text column can't be read") {
    ContactImportConsentSheet(
        candidate: ContactImportCandidate(
            kind: .csv,
            fileName: "suppression-list.csv",
            bytes: Data(),
            columns: [
                ContactImportColumn(
                    index: 0,
                    header: "Phone",
                    samples: ["+14165550100"],
                    guess: .phone
                ),
                ContactImportColumn(
                    index: 1,
                    header: "Do Not Contact",
                    samples: ["Subscribed", "Unsubscribed"],
                    guess: .optedOut,
                    unreadable: ["Subscribed", "Unsubscribed"],
                    unreadableCount: 2,
                    values: ["Subscribed", "Unsubscribed"],
                    total: 2
                ),
            ]
        ),
        onConfirm: { _ in }
    )
}
