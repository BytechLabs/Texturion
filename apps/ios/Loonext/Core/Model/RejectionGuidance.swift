import Foundation

/// #352 — a carrier rejection, in words the customer can act on.
///
/// Hand-port of `packages/shared/src/rejection-guidance.ts`. The routing half —
/// which reason resolves to which field, and whether it resolves at all — is
/// pinned by `packages/shared/vectors/rejections.json` and asserted in
/// `ParityVectorsTests`, because this is exactly the sort of rule that dies
/// silently in a hand-port.
///
/// IT ALREADY DID, IN THE TYPESCRIPT, WHICH IS WHY THE MATCHING LOOKS LIKE THIS.
/// The natural spelling is a word-boundary regex, and `\bein\b` does not match
/// `EIN_MISMATCH` — an underscore is a word character, so there is no boundary
/// there. Every coded reason a carrier sends is underscore-separated, so the
/// whole catalogue matched nothing while reading as perfectly correct. There is
/// no regex here at all: the reason is normalised to spaces once and the
/// patterns are plain substrings, which also keeps this identical to the Kotlin.
enum RejectionDomain {
    case registration
    case port
}

/// What the customer is told, and where to send them.
struct RejectionGuidance: Equatable {
    /// What the carrier objected to. One sentence, G10.
    let what: String
    /// The one thing to change. One sentence, G10.
    let fix: String
    /// The form field to take them to, or nil when the fix is not a single
    /// field. Nil is a real answer: pointing at a field that cannot fix it is
    /// worse than not pointing.
    let field: String?
}

/// #228: the catalogue holds KEYS, not sentences.
///
/// A `private let` array is built once at file-init, outside any view and
/// before any reader exists, so a sentence written here could only ever be
/// written in one language. `explainRejection` resolves them for the reader it
/// is given.
private struct CatalogueEntry {
    let match: [String]
    let whatKey: String
    let fixKey: String
    let field: String?
}

/// Lower-case, collapse every run of non-alphanumerics to a single space, and
/// pad with spaces so a phrase can be tested as a whole-word substring.
///
///     "BRAND_LEGAL_NAME_MISMATCH"  ->  " brand legal name mismatch "
private func normalise(_ reason: String) -> String {
    var out = ""
    var pendingSpace = false
    for character in reason.lowercased() {
        // ASCII-gated deliberately: the TypeScript strips on [^a-z0-9], so an
        // accented letter is a separator there and must be one here too.
        if character.isASCII && (character.isLetter || character.isNumber) {
            if pendingSpace && !out.isEmpty { out.append(" ") }
            pendingSpace = false
            out.append(character)
        } else {
            pendingSpace = true
        }
    }
    return " \(out) "
}

private let registrationCatalogue: [CatalogueEntry] = [
    CatalogueEntry(
        match: ["ein", "tax id", "taxid", "federal tax"],
        whatKey: "domain.rejectRegEinWhat",
        fixKey: "domain.rejectRegEinFix",
        field: "ein"
    ),
    CatalogueEntry(
        match: ["legal name", "business name", "brand name", "company name", "name mismatch"],
        whatKey: "domain.rejectRegNameWhat",
        fixKey: "domain.rejectRegNameFix",
        field: "companyName"
    ),
    CatalogueEntry(
        match: ["address", "street", "postal", "zip", "city", "state", "province"],
        whatKey: "domain.rejectRegAddressWhat",
        fixKey: "domain.rejectRegAddressFix",
        field: "street"
    ),
    CatalogueEntry(
        match: ["website", "web site", "url", "domain", "landing page"],
        whatKey: "domain.rejectRegWebsiteWhat",
        fixKey: "domain.rejectRegWebsiteFix",
        field: "website"
    ),
    CatalogueEntry(
        match: ["opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"],
        whatKey: "domain.rejectRegConsentWhat",
        fixKey: "domain.rejectRegConsentFix",
        field: "messageFlow"
    ),
    CatalogueEntry(
        match: ["sample", "example message", "content"],
        whatKey: "domain.rejectRegSampleWhat",
        fixKey: "domain.rejectRegSampleFix",
        field: "sample1"
    ),
    CatalogueEntry(
        match: ["use case", "usecase", "vertical", "campaign type", "industry"],
        whatKey: "domain.rejectRegUseCaseWhat",
        fixKey: "domain.rejectRegUseCaseFix",
        field: "vertical"
    ),
    CatalogueEntry(
        match: ["duplicate", "already registered", "already exists"],
        whatKey: "domain.rejectRegDuplicateWhat",
        fixKey: "domain.rejectRegDuplicateFix",
        field: nil
    ),
    CatalogueEntry(
        match: ["entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"],
        whatKey: "domain.rejectRegEntityWhat",
        fixKey: "domain.rejectRegEntityFix",
        field: "companyName"
    ),
    CatalogueEntry(
        match: ["contact", "email", "phone number", "unreachable"],
        whatKey: "domain.rejectRegContactWhat",
        fixKey: "domain.rejectRegContactFix",
        field: "email"
    ),
]

private let portCatalogue: [CatalogueEntry] = [
    CatalogueEntry(
        match: ["account number", "acct no", "acct num"],
        whatKey: "domain.rejectPortAccountWhat",
        fixKey: "domain.rejectPortAccountFix",
        field: "account_number"
    ),
    CatalogueEntry(
        match: ["pin", "passcode", "password", "security code"],
        whatKey: "domain.rejectPortPinWhat",
        fixKey: "domain.rejectPortPinFix",
        field: "account_number"
    ),
    CatalogueEntry(
        match: ["authorized person", "auth person", "signature", "loa", "letter of auth"],
        whatKey: "domain.rejectPortAuthWhat",
        fixKey: "domain.rejectPortAuthFix",
        field: "auth_person_name"
    ),
    CatalogueEntry(
        match: ["entity name", "account holder", "name mismatch", "customer name"],
        whatKey: "domain.rejectPortEntityWhat",
        fixKey: "domain.rejectPortEntityFix",
        field: "entity_name"
    ),
    CatalogueEntry(
        match: ["address", "service address", "street", "zip", "postal", "locality"],
        whatKey: "domain.rejectPortAddressWhat",
        fixKey: "domain.rejectPortAddressFix",
        field: "service_street"
    ),
    CatalogueEntry(
        match: ["pending order", "in progress", "another port"],
        whatKey: "domain.rejectPortPendingWhat",
        fixKey: "domain.rejectPortPendingFix",
        field: nil
    ),
    CatalogueEntry(
        match: ["not found", "invalid number", "not active", "disconnected", "unportable", "not portable"],
        whatKey: "domain.rejectPortInactiveWhat",
        fixKey: "domain.rejectPortInactiveFix",
        field: nil
    ),
]

/// Translate a carrier rejection, or return nil when we do not recognise it.
///
/// Nil is the honest answer and the UI depends on it: it then shows the
/// carrier's own words plus an offer of help, rather than a generic sentence
/// that hides the only concrete thing the customer was given.
/// #228: `locale` is last and defaulted, so `ParityVectorsTests` and
/// `PortRejectionRoutingTests` keep pinning the ROUTING in English while the
/// rejection notice can pass the reader's language. Nothing about which entry
/// matches depends on it — the matching is done against the carrier's own coded
/// reason, which arrives in one language whoever is reading.
func explainRejection(
    _ domain: RejectionDomain,
    _ reason: String?,
    locale: String? = nil
) -> RejectionGuidance? {
    guard let text = reason?.trimmingCharacters(in: .whitespacesAndNewlines),
          !text.isEmpty
    else { return nil }
    let normalised = normalise(text)
    let catalogue = domain == .registration ? registrationCatalogue : portCatalogue
    guard let entry = catalogue.first(where: { candidate in
        candidate.match.contains { normalised.contains(" \($0) ") }
    }) else { return nil }
    return RejectionGuidance(
        what: AppStrings.translate(locale, entry.whatKey),
        fix: AppStrings.translate(locale, entry.fixKey),
        field: entry.field
    )
}

/// How long a resubmission takes, stated because its absence is where people
/// give up on a second wait of unknown length.
func resubmissionWait(_ domain: RejectionDomain, locale: String? = nil) -> String {
    switch domain {
    case .registration:
        return AppStrings.translate(locale, "domain.resubmitWaitRegistration")
    case .port:
        return AppStrings.translate(locale, "domain.resubmitWaitPort")
    }
}

/// After this many attempts the customer needs a person rather than another
/// form. Two, not three: the second rejection says they cannot see what is wrong
/// from what we have told them, and a third solo attempt buys another carrier
/// review to learn the same thing.
let rejectionsBeforeHelp = 2

func needsHumanHelp(_ submissionCount: Int?) -> Bool {
    guard let submissionCount else { return false }
    return submissionCount >= rejectionsBeforeHelp
}
