package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/** #691: what POST /v1/trash/restore brings back. Mirrors the server's kinds. */
object TrashKind {
    const val MESSAGE = "message"
    const val CONVERSATION = "conversation"
    const val CALL = "call"
    const val VOICEMAIL = "voicemail"
}

/** The 200 body of every DELETE: what went to the Trash. */
@Serializable
data class DeletedRecord(
    val kind: String,
    val id: String,
)

/** #691: deleting is its own permission, held by owners and admins by default. */
fun canDeleteRecords(role: String?): Boolean = MemberRole.has(role, Capability.RECORDS_DELETE)

/**
 * A text the carrier already took. Deleting it removes it from Loonext only:
 * the customer still has it on their phone, and the confirmation must say so.
 * Queued and failed texts never reached them, notes and inbound texts are ours.
 */
val Message.customerStillHasCopy: Boolean
    get() = direction == MessageDirection.OUTBOUND &&
        (status == MessageStatus.SENT || status == MessageStatus.DELIVERED)

/**
 * #735: one row of GET /v1/trash. Exactly one of the four detail objects is
 * present, the one [kind] names; the rest are absent.
 */
@Serializable
data class TrashItem(
    val id: String,
    val kind: String,
    val deleted_at: String,
    val deleted_by_user_id: String? = null,
    /** When the nightly purge erases it for good. */
    val purge_after: String,
    val conversation: TrashConversationDetail? = null,
    val message: TrashMessageDetail? = null,
    val call: TrashCallDetail? = null,
    val voicemail: TrashVoicemailDetail? = null,
)

@Serializable
data class TrashConversationDetail(
    val contact_name: String? = null,
    val contact_phone: String? = null,
    val message_count: Int = 0,
)

@Serializable
data class TrashMessageDetail(
    val contact_name: String? = null,
    val contact_phone: String? = null,
    val conversation_id: String? = null,
    /** inbound, outbound or note. */
    val direction: String? = null,
    val snippet: String? = null,
)

@Serializable
data class TrashCallDetail(
    val contact_name: String? = null,
    val contact_phone: String? = null,
    /** answered, voicemail or missed. */
    val outcome: String? = null,
    val started_at: String? = null,
    val has_voicemail: Boolean = false,
)

@Serializable
data class TrashVoicemailDetail(
    val contact_name: String? = null,
    val contact_phone: String? = null,
    val started_at: String? = null,
    val voicemail_seconds: Int? = null,
)
