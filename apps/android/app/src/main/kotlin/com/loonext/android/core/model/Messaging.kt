package com.loonext.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

object ConversationStatus {
    const val NEW = "new"
    const val OPEN = "open"
    const val WAITING = "waiting"
    const val CLOSED = "closed"
}

object MessageDirection {
    const val INBOUND = "inbound"
    const val OUTBOUND = "outbound"
    const val NOTE = "note"
}

object MessageStatus {
    const val RECEIVED = "received"
    const val QUEUED = "queued"
    const val SENT = "sent"
    const val DELIVERED = "delivered"
    const val FAILED = "failed"
}

/** Carrier code for "recipient opted out at the carrier" — retry never offered. */
const val CARRIER_OPT_OUT_ERROR_CODE = "40300"

@Serializable
data class ContactSummary(
    val id: String,
    val name: String? = null,
    val phone_e164: String,
)

@Serializable
data class Tag(
    val id: String,
    val name: String,
    val color: String? = null,
    val created_at: String? = null,
    val updated_at: String? = null,
)

@Serializable
data class Conversation(
    val id: String,
    val company_id: String,
    val contact_id: String,
    val phone_number_id: String,
    val status: String,
    val is_spam: Boolean,
    val assigned_user_id: String? = null,
    val pinned_at: String? = null,
    val pinned_by_user_id: String? = null,
    val last_message_at: String,
    val closed_at: String? = null,
    val created_at: String,
    val updated_at: String,
)

/** Newest-message snippet embedded on every GET /v1/conversations row. */
@Serializable
data class ConversationSnippet(
    val id: String,
    val direction: String,
    val body: String,
    val created_at: String,
    val has_attachments: Boolean,
)

/** GET /v1/conversations row (api_list_conversations RPC). */
@Serializable
data class ConversationListItem(
    val id: String,
    val company_id: String,
    val contact_id: String,
    val phone_number_id: String,
    val status: String,
    val is_spam: Boolean,
    val assigned_user_id: String? = null,
    val pinned_at: String? = null,
    val pinned_by_user_id: String? = null,
    val last_message_at: String,
    val closed_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val contact: ContactSummary,
    val tags: List<Tag> = emptyList(),
    val unread: Boolean = false,
    val last_message: ConversationSnippet? = null,
)

@Serializable
data class AttachmentSummary(
    val id: String,
    val content_type: String,
    val size_bytes: Long? = null,
)

/** The linked-task chip a promoted message / task-linked note carries. */
@Serializable
data class MessageTaskLink(val id: String, val title: String)

@Serializable
data class Message(
    val id: String,
    val conversation_id: String,
    val direction: String,
    val body: String,
    /** null iff direction='note'. */
    val status: String? = null,
    val segments: Int? = null,
    val encoding: String? = null,
    val sent_by_user_id: String? = null,
    val error_code: String? = null,
    val error_detail: String? = null,
    val telnyx_message_id: String? = null,
    val done_at: String? = null,
    val done_by_user_id: String? = null,
    val pinned_at: String? = null,
    val pinned_by_user_id: String? = null,
    val created_at: String,
    val attachments: List<AttachmentSummary> = emptyList(),
    val has_task: Boolean = false,
    val promoted_task: MessageTaskLink? = null,
    val task_id: String? = null,
    val task: MessageTaskLink? = null,
) {
    /**
     * The one retry affordance rule: API-level failure only (no carrier id),
     * and never a carrier opt-out block.
     */
    val retryable: Boolean
        get() = direction == MessageDirection.OUTBOUND &&
            status == MessageStatus.FAILED &&
            telnyx_message_id == null &&
            error_code != CARRIER_OPT_OUT_ERROR_CODE
}

/** Contact embed on GET /v1/conversations/:id. */
@Serializable
data class ConversationDetailContact(
    val id: String,
    val name: String? = null,
    val phone_e164: String,
    val address: String? = null,
    val notes: String? = null,
    val consent_source: String? = null,
    val consent_at: String? = null,
    val deleted_at: String? = null,
)

/** GET /v1/conversations/:id — embeds the first page of messages. */
@Serializable
data class ConversationDetail(
    val id: String,
    val company_id: String,
    val contact_id: String,
    val phone_number_id: String,
    val status: String,
    val is_spam: Boolean,
    val assigned_user_id: String? = null,
    val pinned_at: String? = null,
    val pinned_by_user_id: String? = null,
    val last_message_at: String,
    val closed_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val contact: ConversationDetailContact,
    val tags: List<Tag> = emptyList(),
    val messages: Page<Message>,
    /** #106: 'note' = read + internal notes only (composer hides SMS mode). */
    val viewer_level: String = "text",
)

@Serializable
data class ConversationEvent(
    val id: String,
    val conversation_id: String,
    /** null = system. */
    val actor_user_id: String? = null,
    val type: String,
    val payload: JsonObject,
    val created_at: String,
)

@Serializable
data class ReadReceipt(
    val conversation_id: String,
    val user_id: String,
    val last_read_at: String,
)

/** POST /v1/conversations (compose) response. */
@Serializable
data class ComposeResult(
    val conversation: Conversation,
    val message: Message,
)

@Serializable
data class Template(
    val id: String,
    val name: String,
    val body: String,
    val created_by: String? = null,
    val created_at: String,
    val updated_at: String,
)

/** GET /v1/attachments/:id/url — short-lived signed URL; never cache. */
@Serializable
data class AttachmentUrl(val url: String, val expires_at: String)

/** A generic (note/task) attachment row (D19; upload door is notes-only). */
@Serializable
data class Attachment(
    val id: String,
    val owner_type: String,
    val owner_id: String,
    val conversation_id: String? = null,
    val file_name: String? = null,
    val content_type: String? = null,
    val size_bytes: Long? = null,
    val created_at: String,
)

/** One item from GET /v1/conversations/:id/attachments (gallery). */
@Serializable
data class GalleryItem(
    val id: String,
    val source: String,
    val kind: String,
    val file_name: String? = null,
    val content_type: String? = null,
    val size_bytes: Long? = null,
    val created_at: String,
    val url: String,
)

/** Outbound media item for compose/send (base64 inline, jpeg/png/gif ≤1MB). */
@Serializable
data class OutboundMedia(
    val content_type: String,
    val base64: String,
)
