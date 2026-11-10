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
