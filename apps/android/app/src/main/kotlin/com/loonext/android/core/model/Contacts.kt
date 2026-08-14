package com.loonext.android.core.model

import com.loonext.android.core.i18n.AppStrings
import kotlinx.serialization.Serializable

/** The customer texted STOP and our webhook saw it: a block only they can lift. */
const val OPT_OUT_SOURCE_STOP = "stop_keyword"

/**
 * #331: the same block, learned afterwards — Telnyx refused a send with 40300,
 * or the nightly reconciliation found the number on their list and not ours.
 * The customer still said stop; we just were not told at the time.
 */
const val OPT_OUT_SOURCE_CARRIER = "carrier"

/**
 * Whether this opt-out is enforced by the carrier, and so cannot be undone
 * from in here whatever the screen offers. A function rather than a comparison
 * because there are now two such sources and every site that named one would
 * quietly start offering a revoke the server answers with a 409.
 */
fun isCarrierEnforcedOptOut(source: String?): Boolean =
    source == OPT_OUT_SOURCE_STOP || source == OPT_OUT_SOURCE_CARRIER

/**
 * Contact rows. Detail + list share the shape; `opted_out` rides every read,
 * `last_activity_at` only on list rows (conversation activity, never edits).
 *
 * #191 attribution: the actor ids plus their server-resolved company-member
 * display names ride the detail read. Contacts that predate attribution carry
 * null actors (no backfill lie) — the UI shows the line only when a name
 * resolves. Nullable-with-default so older payloads still decode.
 */
/**
 * #291 — one of a contact's addresses.
 *
 * The label is free text: a fixed vocabulary is wrong for the second trade
 * that uses it — a property manager labels by unit, a builder by lot.
 */
@Serializable
data class ContactAddress(
    val id: String = "",
    val label: String? = null,
    val address: String = "",
    val is_primary: Boolean = false,
    val created_at: String = "",
)

@Serializable
data class Contact(
    val id: String,
    val phone_e164: String,
    /**
     * #410: how many conversations this contact has had, and when the first
     * one was. Derived server-side so three clients cannot each count
     * differently, and scoped to the numbers the caller may see. Defaults
     * because a lagging build must not fail a decode over a summary.
     */
    val conversation_count: Int = 0,
    val first_conversation_at: String? = null,
    val name: String? = null,
    /**
     * #291: the company this customer represents, when they represent one.
     * For a property manager or a general contractor it is most of the record.
     */
    val business_name: String? = null,
    val address: String? = null,
    /**
     * #291: for quotes (#287) and receipts (#224), and as the fallback a human
     * can use when a text will not reach somebody.
     */
    val email: String? = null,
    /**
     * #291: the OTHER addresses. Primary first, then oldest. Empty for every
     * contact that predates the feature — `address` above still holds their
     * one address and still works.
     */
    val addresses: List<ContactAddress> = emptyList(),
    /**
     * #291: values for the fields this workspace defined, keyed on the field's
     * key. Empty on every contact nobody has filled one in for — which is most
     * of them — and on the LIST projection, which does not carry them.
     */
    val custom_fields: Map<String, String> = emptyMap(),
    /**
     * #291: the OTHER numbers this customer answers, oldest first. No primary
     * among them — `phone_e164` above IS the primary, and a second flag for
     * the same idea would let the two disagree.
     */
    val phones: List<ContactPhone> = emptyList(),
    val notes: String? = null,
    val consent_source: String? = null,
    val consent_at: String? = null,
    val consent_attested_by: String? = null,
    /** #393: null means a first text to this customer would be SIGNED, so the
     *  composer folds the signature into its part count. Non-null means they
     *  have already been told who we are and it is not added again. */
    val first_identification_sent_at: String? = null,
    val deleted_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val opted_out: Boolean = false,
    /**
     * Which kind of opt-out this is, because only some of them can be undone
     * from inside the app. "stop_keyword" and "carrier" are both CARRIER
     * blocks: clearing our record would not clear theirs, so every send would
     * still be rejected. Ask [isCarrierEnforcedOptOut] rather than comparing
     * to one of them. "manual" and "import" are records someone in the office
     * made, with no carrier involved. Null when not opted out.
     */
    val opt_out_source: String? = null,
    /**
     * #292/D49: a person's CORRECTION to the area-code inference, or null to
     * keep inferring. Never a cached copy of the inferred zone — that would go
     * stale the day the area-code table is fixed, with nothing to tell it
     * apart from a deliberate choice.
     */
    val timezone: String? = null,
    /**
     * #228: the language automated texts to THIS customer go out in, or null to
     * follow the workspace.
     *
     * Null is not English. A workspace working in fr-CA texts this customer in
     * French until somebody says otherwise here, so storing a resolved "en" on
     * every contact would freeze them all against a later change; the owner
     * would switch the workspace and watch the setting do nothing.
     */
    val locale: String? = null,
    /**
     * What the server actually resolved, and which rung of the ladder answered
     * ("contact", "area_code", "company"). Detail reads only — the list does
     * not carry them, hence the defaults.
     */
    val timezone_resolved: String? = null,
    val timezone_source: String? = null,
    /** 0–23 where they are, at the moment the detail was read. */
    val local_hour: Int? = null,
    val last_activity_at: String? = null,
    val created_by_user_id: String? = null,
    val created_by_name: String? = null,
    val updated_by_user_id: String? = null,
    val updated_by_name: String? = null,
)

@Serializable
data class OptOut(
    val id: String,
    val phone_e164: String,
    val source: String,
    val created_at: String,
    val revoked_at: String? = null,
)

/** POST /v1/contacts/import + import-vcard response. */
@Serializable
data class ImportResult(
    val imported: Int,
    val updated: Int,
    val skipped: Int,
    val errors: List<ImportRowError> = emptyList(),
    /**
     * #248 — how many rows ARRIVED but could not carry the file's consent
     * attestation, because those people have already told this business to
     * stop. The file claims everybody in it agreed; the carrier record says
     * otherwise about these, and the carrier record wins.
     *
     * Deliberately NOT folded into [skipped], for the same reason the server
     * named it separately: these contacts were imported. Reporting them as
     * skipped would be a second wrong answer about the same rows.
     *
     * Defaulted so this app still decodes an API that predates #248 — a server
     * that could not refuse anything refused nothing, which is what 0 says.
     */
    val consent_refused: Int = 0,
    /**
     * Which rows, in the same `{row, reason}` shape as [errors] — the
     * workspace's next question after "how many" is always "which of them?".
     */
    val consent_refusals: List<ImportRowError> = emptyList(),
    /**
     * The server's own sentence about what a refusal means, rendered verbatim
     * and never paraphrased.
     *
     * Not hand-ported into Kotlin: it is already on the wire, and a second copy
     * here could drift out of step with the record the workspace is shown. Null
     * whenever nothing was refused, which is how the server sends it.
     */
    val consent_refused_note: String? = null,
) {
    @Serializable
    data class ImportRowError(val row: Int, val reason: String)
}

/**
 * #292/D49: how honest to be about the clock we are showing.
 *
 * "From their area code" is an inference a dispatcher may know better than —
 * a mobile number keeps its original code when its owner moves provinces.
 * "Using your timezone" is us admitting we do not know, which is the one they
 * most need to see before scheduling anything.
 *
 * #228: [locale] is last and defaulted, so the callers that pin the English are
 * untouched while the screen that knows the reader's language can pass it.
 */
fun timezoneProvenanceLabel(source: String?, locale: String? = null): String = when (source) {
    "contact" -> AppStrings.translate(locale, "domain.contactClockSetByCrew")
    "area_code" -> AppStrings.translate(locale, "domain.contactClockFromAreaCode")
    "company" -> AppStrings.translate(locale, "domain.contactClockUnknown")
    else -> ""
}

/**
 * The zones worth offering when correcting a contact's clock. Taken from the
 * platform's own tz database rather than a list of ours, so it cannot go stale
 * when IANA renames one — and narrowed to North America because every number
 * this product can text is there. The server validates whatever is sent.
 */
fun northAmericanTimeZoneIds(): List<String> =
    java.util.TimeZone.getAvailableIDs()
        .filter { it.startsWith("America/") || it.startsWith("Pacific/Honolulu") }
        .distinct()
        .sorted()

/**
 * #246 — two contact records that look like the same customer.
 *
 * The `reason` is the server's, in its own words, and it is rendered verbatim:
 * a suggestion somebody cannot verify is one they learn to dismiss.
 */
@Serializable
data class DuplicatePair(
    val contact_a: String,
    val name_a: String? = null,
    val phone_a: String,
    val contact_b: String,
    val name_b: String? = null,
    val phone_b: String,
    val reason: String,
)

/** #246: what a merge actually did, so the confirmation can say it back. */
@Serializable
data class ContactMergeResult(
    val merged: Boolean = false,
    val moved: Int = 0,
    val closed: Int = 0,
    val opted_out: Boolean = false,
)

/**
 * #291: one field a workspace defined for itself.
 *
 * `key` is the stable identity — values are stored under it, so relabelling a
 * field keeps every value attached.
 */
/**
 * #291: one of a customer's other numbers.
 *
 * A number recorded here is matched against every inbound text and call, so it
 * decides which customer a message is FROM.
 */
@Serializable
data class ContactPhone(
    val id: String = "",
    val phone_e164: String = "",
    val label: String? = null,
    val created_at: String = "",
)

@Serializable
data class ContactPhoneBody(
    val phone_e164: String,
    val label: String? = null,
)

@Serializable
data class ContactPhoneCreated(val data: ContactPhone = ContactPhone())

@Serializable
data class ContactFieldDef(
    val key: String = "",
    val label: String = "",
    val kind: String = "text",
    val options: List<String>? = null,
    val position: Int = 0,
)

/** GET /v1/contact-fields. */
@Serializable
data class ContactFieldsResponse(
    val data: List<ContactFieldDef> = emptyList(),
    /**
     * The ceiling, sent with the list rather than hardcoded on the phone — a
     * client keeping its own copy would eventually disagree with the server
     * about when the Add button disappears.
     */
    val cap: Int = 10,
)

/** PUT /v1/contact-fields — the whole set at once. */
@Serializable
data class ContactFieldsBody(val fields: List<ContactFieldDef>)

@Serializable
data class ContactAddressBody(
    val address: String? = null,
    val label: String? = null,
    val is_primary: Boolean? = null,
)

@Serializable
data class ContactAddressCreated(val data: ContactAddress = ContactAddress())
