package com.loonext.android.features.contacts

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ContactMergeResult
import com.loonext.android.core.model.DuplicatePair
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.OptOut
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.format.DateTimeFormatter

/** Field limits mirrored client-side (server is authoritative). */
const val CONTACT_NAME_MAX = 200
const val CONTACT_ADDRESS_MAX = 500
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

    /** Admin CSV import: multipart 'file', ≤2MB, ≤2000 rows. */
    suspend fun importCsv(companyId: String, fileName: String, bytes: ByteArray): ImportResult =
        api.json.decodeFromString(
            multipart.postFile(
                path = "/v1/contacts/import",
                companyId = companyId,
                fields = emptyMap(),
                fileField = "file",
                fileName = fileName,
                contentType = "text/csv",
                bytes = bytes,
            ),
        )

    /** Admin vCard import: multipart 'file', ≤5MB, ≤2000 cards. */
    suspend fun importVcard(companyId: String, fileName: String, bytes: ByteArray): ImportResult =
        api.json.decodeFromString(
            multipart.postFile(
                path = "/v1/contacts/import-vcard",
                companyId = companyId,
                fields = emptyMap(),
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
