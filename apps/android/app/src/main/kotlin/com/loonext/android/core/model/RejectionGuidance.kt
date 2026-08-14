package com.loonext.android.core.model

import com.loonext.android.core.i18n.AppStrings

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

/**
 * #228: the catalogue holds KEYS, not sentences.
 *
 * A `private val` list is built once at class-init, outside any composition and
 * before any reader exists, so a sentence written here could only ever be
 * written in one language. [explainRejection] resolves them for the reader it is
 * given.
 */
private data class CatalogueEntry(
    val match: List<String>,
    val whatKey: String,
    val fixKey: String,
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
        "domain.rejectRegEinWhat",
        "domain.rejectRegEinFix",
        "ein",
    ),
    CatalogueEntry(
        listOf("legal name", "business name", "brand name", "company name", "name mismatch"),
        "domain.rejectRegNameWhat",
        "domain.rejectRegNameFix",
        "companyName",
    ),
    CatalogueEntry(
        listOf("address", "street", "postal", "zip", "city", "state", "province"),
        "domain.rejectRegAddressWhat",
        "domain.rejectRegAddressFix",
        "street",
    ),
    CatalogueEntry(
        listOf("website", "web site", "url", "domain", "landing page"),
        "domain.rejectRegWebsiteWhat",
        "domain.rejectRegWebsiteFix",
        "website",
    ),
    CatalogueEntry(
        listOf("opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"),
        "domain.rejectRegConsentWhat",
        "domain.rejectRegConsentFix",
        "messageFlow",
    ),
    CatalogueEntry(
        listOf("sample", "example message", "content"),
        "domain.rejectRegSampleWhat",
        "domain.rejectRegSampleFix",
        "sample1",
    ),
    CatalogueEntry(
        listOf("use case", "usecase", "vertical", "campaign type", "industry"),
        "domain.rejectRegUseCaseWhat",
        "domain.rejectRegUseCaseFix",
        "vertical",
    ),
    CatalogueEntry(
        listOf("duplicate", "already registered", "already exists"),
        "domain.rejectRegDuplicateWhat",
        "domain.rejectRegDuplicateFix",
        null,
    ),
    CatalogueEntry(
        listOf("entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"),
        "domain.rejectRegEntityWhat",
        "domain.rejectRegEntityFix",
        "companyName",
    ),
    CatalogueEntry(
        listOf("contact", "email", "phone number", "unreachable"),
        "domain.rejectRegContactWhat",
        "domain.rejectRegContactFix",
        "email",
    ),
)

private val PORT = listOf(
    CatalogueEntry(
        listOf("account number", "acct no", "acct num"),
        "domain.rejectPortAccountWhat",
        "domain.rejectPortAccountFix",
        "account_number",
    ),
    CatalogueEntry(
        listOf("pin", "passcode", "password", "security code"),
        "domain.rejectPortPinWhat",
        "domain.rejectPortPinFix",
        "account_number",
    ),
    CatalogueEntry(
        listOf("authorized person", "auth person", "signature", "loa", "letter of auth"),
        "domain.rejectPortAuthWhat",
        "domain.rejectPortAuthFix",
        "auth_person_name",
    ),
    CatalogueEntry(
        listOf("entity name", "account holder", "name mismatch", "customer name"),
        "domain.rejectPortEntityWhat",
        "domain.rejectPortEntityFix",
        "entity_name",
    ),
    CatalogueEntry(
        listOf("address", "service address", "street", "zip", "postal", "locality"),
        "domain.rejectPortAddressWhat",
        "domain.rejectPortAddressFix",
        "service_street",
    ),
    CatalogueEntry(
        listOf("pending order", "in progress", "another port"),
        "domain.rejectPortPendingWhat",
        "domain.rejectPortPendingFix",
        null,
    ),
    CatalogueEntry(
        listOf("not found", "invalid number", "not active", "disconnected", "unportable", "not portable"),
        "domain.rejectPortInactiveWhat",
        "domain.rejectPortInactiveFix",
        null,
    ),
)

/**
 * Translate a carrier rejection, or return null when we do not recognise it.
 *
 * Null is the honest answer and the UI depends on it: it then shows the
 * carrier's own words plus an offer of help, rather than a generic sentence
 * that hides the only concrete thing the customer was given.
 *
 * #228: [locale] is last and defaulted, so `ParityVectorsTest` and
 * `PortRejectionWiringTest` keep pinning the ROUTING in English while the
 * rejection notice can pass the reader's language. Nothing about which entry
 * matches depends on it — the matching is done against the carrier's own coded
 * reason, which arrives in one language whoever is reading.
 */
fun explainRejection(
    domain: RejectionDomain,
    reason: String?,
    locale: String? = null,
): RejectionGuidance? {
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
    return RejectionGuidance(
        AppStrings.translate(locale, entry.whatKey),
        AppStrings.translate(locale, entry.fixKey),
        entry.field,
    )
}

/**
 * How long a resubmission takes, stated because its absence is where people
 * give up on a second wait of unknown length.
 */
fun resubmissionWait(domain: RejectionDomain, locale: String? = null): String =
    AppStrings.translate(
        locale,
        when (domain) {
            RejectionDomain.REGISTRATION -> "domain.resubmitWaitRegistration"
            RejectionDomain.PORT -> "domain.resubmitWaitPort"
        },
    )

/**
 * After this many attempts the customer needs a person rather than another
 * form. Two, not three: the second rejection says they cannot see what is wrong
 * from what we have told them, and a third solo attempt buys another carrier
 * review to learn the same thing.
 */
const val REJECTIONS_BEFORE_HELP: Int = 2

fun needsHumanHelp(submissionCount: Int?): Boolean =
    submissionCount != null && submissionCount >= REJECTIONS_BEFORE_HELP
