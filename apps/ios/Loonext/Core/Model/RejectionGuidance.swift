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

private struct CatalogueEntry {
    let match: [String]
    let what: String
    let fix: String
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
        what: "The tax ID you gave does not match what the government registry holds for your business.",
        fix: "Check the EIN or business number on a tax document and enter it exactly, digits only.",
        field: "ein"
    ),
    CatalogueEntry(
        match: ["legal name", "business name", "brand name", "company name", "name mismatch"],
        what: "The business name you gave does not match the one on your government registration.",
        fix: "Use the exact legal name from your registration paperwork, including any Ltd, Inc or LLC — the name customers see is set separately.",
        field: "companyName"
    ),
    CatalogueEntry(
        match: ["address", "street", "postal", "zip", "city", "state", "province"],
        what: "The business address does not match the one on your government registration.",
        fix: "Enter the registered business address rather than a mailing or job-site address.",
        field: "street"
    ),
    CatalogueEntry(
        match: ["website", "web site", "url", "domain", "landing page"],
        what: "The carrier could not confirm your business from the website you gave.",
        fix: "Give a website that names your business and describes what you do, and make sure it loads publicly.",
        field: "website"
    ),
    CatalogueEntry(
        match: ["opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"],
        what: "The carrier was not satisfied that customers agree to be texted before you text them.",
        fix: "Describe exactly where a customer gives you their number and what they are told at that moment.",
        field: "messageFlow"
    ),
    CatalogueEntry(
        match: ["sample", "example message", "content"],
        what: "The sample texts did not show the carrier what you actually send.",
        fix: "Use real messages you would send a customer, and include your business name in each one.",
        field: "sample1"
    ),
    CatalogueEntry(
        match: ["use case", "usecase", "vertical", "campaign type", "industry"],
        what: "The use case you picked does not match what your samples and website describe.",
        fix: "Pick the category that matches the texts you actually send to customers.",
        field: "vertical"
    ),
    CatalogueEntry(
        match: ["duplicate", "already registered", "already exists"],
        what: "This business is already registered with the carriers, most likely by a provider you used before.",
        fix: "Reply to us and we will get the existing registration released or transferred — this is not something the form can fix.",
        field: nil
    ),
    CatalogueEntry(
        match: ["entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"],
        what: "The business type you chose does not match how your business is registered.",
        fix: "Choose the type that matches your paperwork — a sole trader and a limited company are registered differently.",
        field: "companyName"
    ),
    CatalogueEntry(
        match: ["contact", "email", "phone number", "unreachable"],
        what: "The carrier could not reach the contact details on the registration.",
        fix: "Give a business email and phone number that reach a person and are not auto-replied.",
        field: "email"
    ),
]

private let portCatalogue: [CatalogueEntry] = [
    CatalogueEntry(
        match: ["account number", "acct no", "acct num"],
        what: "The account number does not match the one your current provider has on file.",
        fix: "Copy it from a recent bill from that provider — it is usually not the phone number itself.",
        field: "account_number"
    ),
    CatalogueEntry(
        match: ["pin", "passcode", "password", "security code"],
        what: "The transfer PIN was missing or wrong.",
        fix: "Ask your current provider for a port-out PIN — most will only give it to the account holder, and it often expires within a few days.",
        field: "account_number"
    ),
    CatalogueEntry(
        match: ["authorized person", "auth person", "signature", "loa", "letter of auth"],
        what: "The person named on the request is not authorised on the account.",
        fix: "Use the name of the person your current provider has as the account holder, spelled the same way.",
        field: "auth_person_name"
    ),
    CatalogueEntry(
        match: ["entity name", "account holder", "name mismatch", "customer name"],
        what: "The account holder name does not match your current provider's records.",
        fix: "Use the name exactly as it appears on the bill, including any Ltd, Inc or LLC.",
        field: "entity_name"
    ),
    CatalogueEntry(
        match: ["address", "service address", "street", "zip", "postal", "locality"],
        what: "The service address does not match the one your current provider has on file.",
        fix: "Use the address on the bill for this line, even if the business has since moved.",
        field: "service_street"
    ),
    CatalogueEntry(
        match: ["pending order", "in progress", "another port"],
        what: "Your current provider has another change in progress on this line.",
        fix: "Ask them to cancel or finish it, then tell us and we will resubmit.",
        field: nil
    ),
    CatalogueEntry(
        match: ["not found", "invalid number", "not active", "disconnected", "unportable", "not portable"],
        what: "Your current provider says this number is not active on the account we asked about.",
        fix: "Check the number is still in service and on the account you gave us — a number already cancelled cannot be moved.",
        field: nil
    ),
]

/// Translate a carrier rejection, or return nil when we do not recognise it.
///
/// Nil is the honest answer and the UI depends on it: it then shows the
/// carrier's own words plus an offer of help, rather than a generic sentence
/// that hides the only concrete thing the customer was given.
func explainRejection(_ domain: RejectionDomain, _ reason: String?) -> RejectionGuidance? {
    guard let text = reason?.trimmingCharacters(in: .whitespacesAndNewlines),
          !text.isEmpty
    else { return nil }
    let normalised = normalise(text)
    let catalogue = domain == .registration ? registrationCatalogue : portCatalogue
    guard let entry = catalogue.first(where: { candidate in
        candidate.match.contains { normalised.contains(" \($0) ") }
    }) else { return nil }
    return RejectionGuidance(what: entry.what, fix: entry.fix, field: entry.field)
}

/// How long a resubmission takes, stated because its absence is where people
/// give up on a second wait of unknown length.
func resubmissionWait(_ domain: RejectionDomain) -> String {
    switch domain {
    case .registration:
        return "Most resubmissions are decided within a business day or two."
    case .port:
        return "Most resubmitted transfers are accepted within a few business days."
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
