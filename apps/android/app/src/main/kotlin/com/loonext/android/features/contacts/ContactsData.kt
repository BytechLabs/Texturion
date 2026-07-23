package com.loonext.android.features.contacts

import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.OptOut
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
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

}

object ConsentSource {
    const val INBOUND_SMS = "inbound_sms"
    const val ATTESTED = "attested"
    const val IMPORT = "import"
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
