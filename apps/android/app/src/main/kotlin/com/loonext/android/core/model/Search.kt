package com.loonext.android.core.model

import kotlinx.serialization.Serializable

@Serializable
data class SearchConversationHit(
    val id: String,
    val status: String,
    val is_spam: Boolean = false,
    val last_message_at: String,
    val contact: ContactSummary,
    val matched_message_id: String,
    val matched_at: String,
    val direction: String,
    val snippet: String,
)

@Serializable
data class SearchTaskHit(
    val id: String,
    val title: String,
    val conversation_id: String,
    val done: Boolean = false,
    val matched_at: String,
)

@Serializable
data class SearchAttachmentHit(
    val id: String,
    val file_name: String,
    val owner_type: String,
    val conversation_id: String? = null,
    val content_type: String? = null,
    val created_at: String,
)

@Serializable
data class SearchTemplateHit(
    val id: String,
    val name: String,
    val snippet: String,
)

/**
 * #409: a voicemail transcript hit. `call_session_id` is the #336 permalink
 * key, so a result has somewhere to land — without it the best it could do is
 * drop the reader on the calls list to scroll.
 */
@Serializable
data class SearchVoicemailHit(
    val id: String,
    val call_session_id: String,
    val contact_id: String? = null,
    val caller_e164: String? = null,
    val started_at: String,
    val snippet: String,
)

/** GET /v1/search — conversations paginate; other arms first-page-only. */
@Serializable
data class SearchResult(
    val conversations: List<SearchConversationHit> = emptyList(),
    val contacts: List<ContactSummary> = emptyList(),
    val tasks: List<SearchTaskHit> = emptyList(),
    val attachments: List<SearchAttachmentHit> = emptyList(),
    val templates: List<SearchTemplateHit> = emptyList(),
    val voicemails: List<SearchVoicemailHit> = emptyList(),
    val next_cursor: String? = null,
)
