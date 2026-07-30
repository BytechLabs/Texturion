package com.loonext.android.core.model

/**
 * #352 — a carrier rejection, in words the customer can act on.
 *
 * Hand-port of `packages/shared/src/rejection-guidance.ts`. The routing half —
 * which reason resolves to which field, and whether it resolves at all — is
 * pinned by `packages/shared/vectors/rejections.json` and asserted in
 * [ParityVectorsTest], because this is exactly the kind of rule that dies
 * silently in a hand-port.
 *
 * IT ALREADY DID, IN THE TYPESCRIPT, WHICH IS WHY THE MATCHING LOOKS LIKE THIS.
 * The natural spelling is a word-boundary regex, and `\bein\b` does not match
 * `EIN_MISMATCH` — an underscore is a word character, so there is no boundary
 * there. Every coded reason a carrier sends is underscore-separated, so the
 * whole catalogue matched nothing while reading as perfectly correct.
 *
 * In Kotlin the same mistake is worse: `"\b"` in a Kotlin string is a BACKSPACE
 * character, not a regex boundary, so the port would fail differently from the
 * original and neither would be obviously wrong. So there is no regex here at
 * all. The reason is normalised to spaces once, and the patterns are plain
 * substrings.
 *
 * The copy is deliberately identical to the TypeScript rather than re-voiced.
 * `generate-parity-vectors.mjs` pins the routing and explicitly does NOT pin
 * wording — presentation is allowed to differ per platform — but there is no
 * reason for it to differ here, and one sentence with two versions is one
 * sentence nobody maintains.
 */

/** What the customer is told, and where to send them. */
data class RejectionGuidance(
    /** What the carrier objected to. One sentence, G10. */
    val what: String,
    /** The one thing to change. One sentence, G10. */
    val fix: String,
    /**
     * The form field to take them to, or null when the fix is not a single
     * field. Null is a real answer: pointing at a field that cannot fix it is
     * worse than not pointing.
     */
    val field: String?,
)

enum class RejectionDomain { REGISTRATION, PORT }

private data class CatalogueEntry(
    val match: List<String>,
    val what: String,
    val fix: String,
    val field: String?,
)

/**
 * Lower-case, collapse every run of non-alphanumerics to a single space, and
 * pad with spaces so a phrase can be tested as a whole-word substring.
 *
 *   "BRAND_LEGAL_NAME_MISMATCH"  ->  " brand legal name mismatch "
 */
private fun normalise(reason: String): String {
    val collapsed = buildString {
        var pendingSpace = false
        for (ch in reason.lowercase()) {
            if (ch in 'a'..'z' || ch in '0'..'9') {
                if (pendingSpace && isNotEmpty()) append(' ')
                pendingSpace = false
                append(ch)
            } else {
                pendingSpace = true
            }
        }
    }
    return " $collapsed "
}

private val REGISTRATION = listOf(
    CatalogueEntry(
        listOf("ein", "tax id", "taxid", "federal tax"),
        "The tax ID you gave does not match what the government registry holds for your business.",
        "Check the EIN or business number on a tax document and enter it exactly, digits only.",
        "ein",
    ),
    CatalogueEntry(
        listOf("legal name", "business name", "brand name", "company name", "name mismatch"),
        "The business name you gave does not match the one on your government registration.",
        "Use the exact legal name from your registration paperwork, including any Ltd, Inc or LLC — the name customers see is set separately.",
        "companyName",
    ),
    CatalogueEntry(
        listOf("address", "street", "postal", "zip", "city", "state", "province"),
        "The business address does not match the one on your government registration.",
        "Enter the registered business address rather than a mailing or job-site address.",
        "street",
    ),
    CatalogueEntry(
        listOf("website", "web site", "url", "domain", "landing page"),
        "The carrier could not confirm your business from the website you gave.",
        "Give a website that names your business and describes what you do, and make sure it loads publicly.",
        "website",
    ),
    CatalogueEntry(
        listOf("opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"),
        "The carrier was not satisfied that customers agree to be texted before you text them.",
        "Describe exactly where a customer gives you their number and what they are told at that moment.",
        "messageFlow",
    ),
    CatalogueEntry(
        listOf("sample", "example message", "content"),
        "The sample texts did not show the carrier what you actually send.",
        "Use real messages you would send a customer, and include your business name in each one.",
        "sample1",
    ),
    CatalogueEntry(
        listOf("use case", "usecase", "vertical", "campaign type", "industry"),
        "The use case you picked does not match what your samples and website describe.",
        "Pick the category that matches the texts you actually send to customers.",
        "vertical",
    ),
    CatalogueEntry(
        listOf("duplicate", "already registered", "already exists"),
        "This business is already registered with the carriers, most likely by a provider you used before.",
        "Reply to us and we will get the existing registration released or transferred — this is not something the form can fix.",
        null,
    ),
    CatalogueEntry(
        listOf("entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"),
        "The business type you chose does not match how your business is registered.",
        "Choose the type that matches your paperwork — a sole trader and a limited company are registered differently.",
        "companyName",
    ),
    CatalogueEntry(
        listOf("contact", "email", "phone number", "unreachable"),
        "The carrier could not reach the contact details on the registration.",
        "Give a business email and phone number that reach a person and are not auto-replied.",
        "email",
    ),
)

private val PORT = listOf(
    CatalogueEntry(
        listOf("account number", "acct no", "acct num"),
        "The account number does not match the one your current provider has on file.",
        "Copy it from a recent bill from that provider — it is usually not the phone number itself.",
        "account_number",
    ),
    CatalogueEntry(
        listOf("pin", "passcode", "password", "security code"),
        "The transfer PIN was missing or wrong.",
        "Ask your current provider for a port-out PIN — most will only give it to the account holder, and it often expires within a few days.",
        "account_number",
    ),
    CatalogueEntry(
        listOf("authorized person", "auth person", "signature", "loa", "letter of auth"),
        "The person named on the request is not authorised on the account.",
        "Use the name of the person your current provider has as the account holder, spelled the same way.",
        "auth_person_name",
    ),
    CatalogueEntry(
        listOf("entity name", "account holder", "name mismatch", "customer name"),
        "The account holder name does not match your current provider's records.",
        "Use the name exactly as it appears on the bill, including any Ltd, Inc or LLC.",
        "entity_name",
    ),
    CatalogueEntry(
        listOf("address", "service address", "street", "zip", "postal", "locality"),
        "The service address does not match the one your current provider has on file.",
        "Use the address on the bill for this line, even if the business has since moved.",
        "service_street",
    ),
    CatalogueEntry(
        listOf("pending order", "in progress", "another port"),
        "Your current provider has another change in progress on this line.",
        "Ask them to cancel or finish it, then tell us and we will resubmit.",
        null,
    ),
    CatalogueEntry(
        listOf("not found", "invalid number", "not active", "disconnected", "unportable", "not portable"),
        "Your current provider says this number is not active on the account we asked about.",
        "Check the number is still in service and on the account you gave us — a number already cancelled cannot be moved.",
        null,
    ),
)

/**
 * Translate a carrier rejection, or return null when we do not recognise it.
 *
 * Null is the honest answer and the UI depends on it: it then shows the
 * carrier's own words plus an offer of help, rather than a generic sentence
 * that hides the only concrete thing the customer was given.
 */
fun explainRejection(domain: RejectionDomain, reason: String?): RejectionGuidance? {
    val text = reason?.trim().orEmpty()
    if (text.isEmpty()) return null
    val normalised = normalise(text)
    val catalogue = when (domain) {
        RejectionDomain.REGISTRATION -> REGISTRATION
        RejectionDomain.PORT -> PORT
    }
    val entry = catalogue.firstOrNull { candidate ->
        candidate.match.any { normalised.contains(" $it ") }
    } ?: return null
    return RejectionGuidance(entry.what, entry.fix, entry.field)
}

/**
 * How long a resubmission takes, stated because its absence is where people
 * give up on a second wait of unknown length.
 */
fun resubmissionWait(domain: RejectionDomain): String = when (domain) {
    RejectionDomain.REGISTRATION -> "Most resubmissions are decided within a business day or two."
    RejectionDomain.PORT -> "Most resubmitted transfers are accepted within a few business days."
}

/**
 * After this many attempts the customer needs a person rather than another
 * form. Two, not three: the second rejection says they cannot see what is wrong
 * from what we have told them, and a third solo attempt buys another carrier
 * review to learn the same thing.
 */
const val REJECTIONS_BEFORE_HELP: Int = 2

fun needsHumanHelp(submissionCount: Int?): Boolean =
    submissionCount != null && submissionCount >= REJECTIONS_BEFORE_HELP
