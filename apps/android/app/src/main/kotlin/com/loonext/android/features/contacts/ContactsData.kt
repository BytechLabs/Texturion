package com.loonext.android.features.contacts

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ContactAddressBody
import com.loonext.android.core.model.ContactAddressCreated
import com.loonext.android.core.model.ContactFieldDef
import com.loonext.android.core.model.ContactPhoneBody
import com.loonext.android.core.model.ContactPhoneCreated
import com.loonext.android.core.model.ContactFieldsBody
import com.loonext.android.core.model.ContactFieldsResponse
import com.loonext.android.core.model.ContactMergeResult
import com.loonext.android.core.model.DuplicatePair
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.OptOut
import com.loonext.android.core.model.Page
import com.loonext.android.core.contacts.ContactImport
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.format.DateTimeFormatter

/** Field limits mirrored client-side (server is authoritative). */
const val CONTACT_NAME_MAX = 200
const val CONTACT_ADDRESS_MAX = 500

/** #291: the DB caps this at 254, which is the RFC's own limit. */
const val CONTACT_EMAIL_MAX = 254
const val CONTACT_NOTES_MAX = 5000

/** Contacts feature data access (detail, edits, consent, import/export). */
class ContactMutations(private val api: ApiClient, baseUrl: String) {

    private val multipart = MultipartClient(api, baseUrl)

    suspend fun detail(companyId: String, contactId: String): Contact =
        api.get("/v1/contacts/$contactId", companyId = companyId)

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    suspend fun create(
        companyId: String,
        phoneE164: String,
        name: String?,
        address: String?,
        notes: String?,
    ): Contact = api.post(
        "/v1/contacts",
        buildJsonObject {
            put("phone_e164", phoneE164)
            if (name != null) put("name", name)
            if (address != null) put("address", address)
            if (notes != null) put("notes", notes)
        },
        companyId = companyId,
    )

    /** Patch ONE field; blank input clears it (an explicit JSON null). */
    // -- #291 addresses ---------------------------------------------------

    /**
     * One row, one request. A whole-list replace would make "add one address"
     * a read-modify-write, and two people editing a property manager's forty
     * buildings would silently lose each other's work.
     */
    suspend fun addAddress(
        companyId: String,
        contactId: String,
        body: ContactAddressBody,
    ): ContactAddressCreated =
        api.post("/v1/contacts/$contactId/addresses", body = body, companyId = companyId)

    suspend fun makeAddressPrimary(
        companyId: String,
        contactId: String,
        addressId: String,
    ): ContactAddressCreated = api.patch(
        "/v1/contacts/$contactId/addresses/$addressId",
        body = ContactAddressBody(is_primary = true),
        companyId = companyId,
    )

    suspend fun removeAddress(companyId: String, contactId: String, addressId: String) {
        api.delete("/v1/contacts/$contactId/addresses/$addressId", companyId = companyId)
    }

    /**
     * #291: record another number this customer answers.
     *
     * One row per request, like the addresses. The server refuses a number
     * somebody else already has and its message names them — taking it would
     * silently redirect that customer's texts and calls onto this record.
     */
    suspend fun addPhone(
        companyId: String,
        contactId: String,
        body: ContactPhoneBody,
    ): ContactPhoneCreated =
        api.post("/v1/contacts/$contactId/phones", body = body, companyId = companyId)

    suspend fun removePhone(companyId: String, contactId: String, phoneId: String) {
        api.delete("/v1/contacts/$contactId/phones/$phoneId", companyId = companyId)
    }

    suspend fun updateField(
        companyId: String,
        contactId: String,
        field: String,
        value: String?,
    ): Contact = api.patch(
        "/v1/contacts/$contactId",
        buildJsonObject {
            if (value == null) put(field, JsonNull) else put(field, value)
        },
        companyId = companyId,
    )

    /**
     * #291: the fields this workspace defined for itself.
     *
     * Read by anyone who can read conversations, not just owners: a member
     * cannot DEFINE a field, but they have to see the definitions to fill one
     * in on a contact.
     */
    suspend fun contactFields(companyId: String): ContactFieldsResponse =
        api.get("/v1/contact-fields", companyId = companyId)

    /**
     * Replace the whole set.
     *
     * Not per-field saves: there are at most ten, they are ordered relative to
     * each other, and the order in the list IS the order they appear on every
     * contact.
     */
    suspend fun saveContactFields(
        companyId: String,
        fields: List<ContactFieldDef>,
    ): ContactFieldsResponse = api.put(
        "/v1/contact-fields",
        body = ContactFieldsBody(fields),
        companyId = companyId,
    )

    /**
     * #291: the WHOLE values object, every time.
     *
     * The API stores what it is given, so sending only the field that changed
     * would empty every other one — and that failure is invisible at the
     * moment it happens: the edited field saves, the rest go blank on the next
     * load.
     */
    suspend fun updateCustomFields(
        companyId: String,
        contactId: String,
        values: Map<String, String>,
    ): Contact = api.patch(
        "/v1/contacts/$contactId",
        buildJsonObject {
            put(
                "custom_fields",
                JsonObject(values.mapValues { (_, value) -> JsonPrimitive(value) }),
            )
        },
        companyId = companyId,
    )

    /** Soft delete — hidden from lists only; resurrects on next text. */
    suspend fun delete(companyId: String, contactId: String) {
        api.delete("/v1/contacts/$contactId", companyId = companyId)
    }

    suspend fun optOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out", companyId = companyId)

    suspend fun revokeOptOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out/revoke", companyId = companyId)

    /**
     * The contact's existing conversation, found the way the web does (#82):
     * the inbox list's q search on the phone. Null = no thread yet (compose).
     */
    suspend fun findConversation(companyId: String, phoneE164: String): ConversationListItem? {
        val page: Page<ConversationListItem> = api.get(
            "/v1/conversations",
            query = mapOf("q" to phoneE164, "limit" to "1"),
            companyId = companyId,
        )
        return page.data.firstOrNull()
    }

    /**
     * The contact's slice of the company call log (#205): GET /v1/calls with
     * the additive contact_id filter, newest first, keyset cursor-paged, with
     * ALL of the log's existing semantics (#106 number-access filtering
     * included) preserved server-side.
     */
    suspend fun calls(
        companyId: String,
        contactId: String,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<Call> = api.get(
        "/v1/calls",
        query = mapOf(
            "contact_id" to contactId,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /**
     * #324 — one chronology of everything done for this customer.
     *
     * D7 threads by recency, so a customer returning after 31 days starts a new
     * conversation: a homeowner serviced once a year for six years is six
     * threads. Paginated with the shared opaque cursor (SPEC §7/D10), which
     * carries the FULL `(occurred_at, id)` sort key — a timestamp alone skips
     * the second of any two entries sharing an instant.
     */
    internal suspend fun timeline(
        companyId: String,
        contactId: String,
        cursor: String? = null,
        limit: Int = 50,
    ): ContactTimelinePage = api.get(
        "/v1/contacts/$contactId/timeline",
        query = mapOf(
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /**
     * Mint a fresh signed voicemail playback URL — on demand, per view, NEVER
     * cached (SPEC: signed attachment URLs are always fetched on view). Same
     * data path as the call log's player (features/calls/CallsData.kt).
     */
    suspend fun voicemail(companyId: String, sessionId: String): ContactVoicemailPlayback =
        api.get("/v1/calls/$sessionId/voicemail", companyId = companyId)

    /** Raw UTF-8-BOM CSV (respects the list's q filter; ≤50k rows). */
    suspend fun exportCsv(companyId: String, q: String?): String = api.raw(
        "GET",
        "/v1/contacts/export",
        query = mapOf("q" to q),
        companyId = companyId,
    )

    /**
     * Admin CSV import: multipart 'file' plus the #226 consent attestation,
     * bounded by ContactImportKind.CSV.
     *
     * [attested] has no default on purpose. It is somebody else's phone number
     * arriving in a shared inbox, and the one thing this call must not be able
     * to do is make the claim on its own — a defaulted `true` would put the
     * attestation back where it was before #226, and a defaulted `false` would
     * make forgetting it look like a network failure.
     *
     * [columns] is #248 round 3: one declaration per column of the file, in the
     * shared `<index>:<action>:<header>` form, saying what every one of them is.
     * NO DEFAULT, for the same reason [attested] has none — a default would let a
     * caller reach this route without anybody having answered, and "nobody
     * answered" is the single failure this whole mechanism exists to close.
     */
    suspend fun importCsv(
        companyId: String,
        fileName: String,
        bytes: ByteArray,
        attested: Boolean,
        columns: List<String>,
    ): ImportResult = api.json.decodeFromString(
        multipart.postFile(
            path = "/v1/contacts/import",
            companyId = companyId,
            fields = ContactImport.csvFields(attested, columns),
            fileField = "file",
            fileName = fileName,
            contentType = "text/csv",
            bytes = bytes,
        ),
    )

    /**
     * Admin vCard import: the same attestation, bounded by
     * ContactImportKind.VCARD. A phone's address book is not a consent
     * record — it is every number its owner ever dialled — so if either bulk
     * door asks the question, this is the one that must.
     *
     * [properties] is the same rule as the CSV door's declaration, in the shape
     * a .vcf allows: one `<PROPERTY>:<action>` per property the cards carry that
     * the importer does not read. `CATEGORIES:DNC`, a `NOTE` saying they asked us
     * to stop, and a label like `X-ABLabel=DO NOT CALL` are where a .vcf says
     * do-not-text, and this door dropped all three in silence until round 3.
     *
     * Empty is now the RARE answer rather than the ordinary one: a property's
     * PARAMETERS are enumerated too, so `TEL;TYPE=CELL` — which every phone on
     * earth exports — is one question. Still no default either way, so it is said
     * rather than assumed.
     */
    suspend fun importVcard(
        companyId: String,
        fileName: String,
        bytes: ByteArray,
        attested: Boolean,
        properties: List<String>,
    ): ImportResult = api.json.decodeFromString(
        multipart.postFile(
            path = "/v1/contacts/import-vcard",
            companyId = companyId,
            fields = ContactImport.vcardFields(attested, properties),
            fileField = "file",
            fileName = fileName,
            contentType = "text/vcard",
            bytes = bytes,
        ),
    )


    /** #246: the pairs that look like one customer, newest signal first. */
    suspend fun duplicates(companyId: String): Page<DuplicatePair> =
        api.get("/v1/contacts/duplicates", companyId = companyId)

    /**
     * #246: fold [fromContactId] into [intoContactId].
     *
     * Everything from both ends up under the survivor and both numbers keep
     * working. A STOP on either side holds for the merged contact — the server
     * writes that union, and it is never undone by an unmerge.
     */
    suspend fun merge(
        companyId: String,
        fromContactId: String,
        intoContactId: String,
    ): ContactMergeResult = api.post(
        "/v1/contacts/$fromContactId/merge",
        buildJsonObject { put("into_contact_id", intoContactId) },
        companyId = companyId,
    )
}

/**
 * GET /v1/calls/:sessionId/voicemail — a short-lived (1h) signed URL. Local
 * mirror of features/calls/CallsData.kt VoicemailPlayback so the parallel-
 * owned calls feature stays untouched (#205); a later consolidation pass may
 * merge them.
 */
@Serializable
data class ContactVoicemailPlayback(
    val url: String,
    val seconds: Int = 0,
    /**
     * The words, written down. Carried on the playback response as well as the
     * call row, because the server transcribes a recording that has no
     * transcript yet on this very request: recordings from before
     * transcription existed, and any whose transcription failed at the time,
     * get their words on first play.
     */
    val transcript: String? = null,
)

object ConsentSource {
    const val INBOUND_SMS = "inbound_sms"
    const val ATTESTED = "attested"
    const val IMPORT = "import"
}

/**
 * The record-attribution caption (#191): who added the contact, and who last
 * edited it when that was someone else. Ported from the web contact page's
 * RecordAttribution so the two clients never phrase it differently.
 *
 * The API resolves each actor to a company-member display name (the same join
 * message-sender and task-actor names already use) and returns null for
 * contacts that predate attribution — so a missing name renders NOTHING rather
 * than "Added by unknown". Both lines are null when neither actor resolves; the
 * edited line is null when it would only echo the added line.
 */
data class ContactAttribution(val added: String?, val edited: String?)

fun contactAttribution(
    createdByName: String?,
    createdAt: String?,
    updatedByName: String?,
    clock: Clock = Clock.systemDefaultZone(),
): ContactAttribution {
    val added = createdByName?.trim()?.ifEmpty { null }
    val edited = updatedByName?.trim()?.ifEmpty { null }
    val addedLine = added?.let {
        val date = com.loonext.android.features.tasks.parseInstant(createdAt)
            ?.atZone(clock.zone)
            ?.format(DateTimeFormatter.ofPattern("MMM d, yyyy"))
        if (date != null) "Added by $it on $date" else "Added by $it"
    }
    val editedLine = if (edited != null && edited != added) "Edited by $edited" else null
    return ContactAttribution(added = addedLine, edited = editedLine)
}

/**
 * The consent card's one line, ported from the web contact page's
 * ConsentLine so the copy never drifts:
 *  - no consent recorded → the teaching sentence,
 *  - inbound_sms → "Texted you first · Jul 8",
 *  - anything else (attested/import) → "Consent recorded by {member} · Jul 8"
 *    (the attester resolved against GET /v1/members; omitted when unknown).
 */
fun consentLine(
    consentSource: String?,
    consentAt: String?,
    consentAttestedBy: String?,
    memberName: (String?) -> String?,
    clock: Clock = Clock.systemDefaultZone(),
): String {
    if (consentSource == null) {
        return "No consent recorded yet. It's recorded when they text you first, " +
            "or when you send them their first text, which attests they asked for it."
    }
    val date = com.loonext.android.features.tasks.parseInstant(consentAt)
        ?.atZone(clock.zone)
        ?.format(DateTimeFormatter.ofPattern("MMM d"))
    val suffix = if (date != null) " · $date" else ""
    if (consentSource == ConsentSource.INBOUND_SMS) return "Texted you first$suffix"
    val attester = memberName(consentAttestedBy)
    return if (attester != null) "Consent recorded by $attester$suffix"
    else "Consent recorded$suffix"

}
