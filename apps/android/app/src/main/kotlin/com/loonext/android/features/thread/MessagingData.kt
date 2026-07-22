package com.loonext.android.features.thread

import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.AttachmentUrl
import com.loonext.android.core.model.ComposeResult
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.Conversation
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.GalleryItem
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.OptOut
import com.loonext.android.core.model.OutboundMedia
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.Template
import com.loonext.android.core.model.Usage
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** POST /v1/messages/send request body. */
@Serializable
data class SendBody(
    val conversation_id: String,
    val body: String,
    val media: List<OutboundMedia>? = null,
)

/** POST /v1/conversations (outbound-first compose) request body. */
@Serializable
data class ComposeBody(
    val contact_id: String? = null,
    val phone_e164: String? = null,
    val phone_number_id: String,
    val body: String,
    val quiet_hours_confirmed: Boolean? = null,
    val media: List<OutboundMedia>? = null,
)

/** POST /v1/conversations/:id/notes request body. */
@Serializable
data class NoteBody(
    val body: String,
    val task_id: String? = null,
)

/**
 * All messaging reads + mutations for the inbox / thread / composer features
 * (#153). Honors the binding invariants: Bearer + X-Company-Id ride every call
 * via [ApiClient], sends carry a client Idempotency-Key, cursor pagination is
 * opaque, and signed attachment URLs are minted per view — never cached.
 */
class MessagingRepository(private val api: ApiClient) {

    // --- Inbox list -------------------------------------------------------

    suspend fun conversations(
        companyId: String,
        status: String? = null,
        assignedUserId: String? = null,
        tagId: String? = null,
        spam: Boolean? = null,
        unread: Boolean? = null,
        pinned: String? = null,
        q: String? = null,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<ConversationListItem> = api.get(
        "/v1/conversations",
        query = mapOf(
            "status" to status,
            "assigned_user_id" to assignedUserId,
            "tag_id" to tagId,
            "is_spam" to spam?.toString(),
            "unread" to unread?.toString(),
            "pinned" to pinned,
            "q" to q,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /**
     * This contact's conversations, found the way the web contact panel does
     * (G6): the list endpoint's `q` matches the phone exactly, which is unique
     * per company — an honest "conversations with this number" query.
     */
    suspend fun conversationsForPhone(
        companyId: String,
        phoneE164: String,
    ): Page<ConversationListItem> = conversations(companyId, q = phoneE164, limit = 25)

    // --- Thread reads -----------------------------------------------------

    suspend fun detail(companyId: String, conversationId: String): ConversationDetail =
        api.get("/v1/conversations/$conversationId", companyId = companyId)

    suspend fun messages(
        companyId: String,
        conversationId: String,
        cursor: String? = null,
        limit: Int = 50,
    ): Page<Message> = api.get(
        "/v1/conversations/$conversationId/messages",
        query = mapOf("cursor" to cursor, "limit" to limit.toString()),
        companyId = companyId,
    )

    suspend fun events(
        companyId: String,
        conversationId: String,
        cursor: String? = null,
        limit: Int = 50,
    ): Page<ConversationEvent> = api.get(
        "/v1/conversations/$conversationId/events",
        query = mapOf("cursor" to cursor, "limit" to limit.toString()),
        companyId = companyId,
    )

    /** The COMPLETE pinned-message set, pinned_at DESC (banner endpoint). */
    suspend fun pinnedMessages(companyId: String, conversationId: String): Page<Message> =
        api.get("/v1/conversations/$conversationId/pinned", companyId = companyId)

    suspend fun markRead(companyId: String, conversationId: String) {
        api.post<JsonObject>("/v1/conversations/$conversationId/read", companyId = companyId)
    }

    // --- Conversation mutations --------------------------------------------

    private suspend fun patchConversation(
        companyId: String,
        conversationId: String,
        body: JsonObject,
    ): Conversation =
        api.patch("/v1/conversations/$conversationId", body, companyId = companyId)

    suspend fun setStatus(companyId: String, conversationId: String, status: String): Conversation =
        patchConversation(companyId, conversationId, buildJsonObject { put("status", status) })

    /** null = unassign (the server needs an explicit null). */
    suspend fun setAssignee(
        companyId: String,
        conversationId: String,
        userId: String?,
    ): Conversation = patchConversation(
        companyId,
        conversationId,
        buildJsonObject {
            if (userId == null) put("assigned_user_id", JsonNull)
            else put("assigned_user_id", userId)
        },
    )

    suspend fun setSpam(companyId: String, conversationId: String, spam: Boolean): Conversation =
        patchConversation(companyId, conversationId, buildJsonObject { put("is_spam", spam) })

    suspend fun setConversationPinned(
        companyId: String,
        conversationId: String,
        pinned: Boolean,
    ): Conversation =
        patchConversation(companyId, conversationId, buildJsonObject { put("pinned", pinned) })

    // --- Tags (#165) --------------------------------------------------------

    /** Attach an existing tag by id. Attaching an attached tag is a no-op. */
    suspend fun attachTag(companyId: String, conversationId: String, tagId: String): Tag =
        api.post(
            "/v1/conversations/$conversationId/tags",
            buildJsonObject { put("tag_id", tagId) },
            companyId = companyId,
        )

    /**
     * Create-on-attach (SPEC §7): the server reuses the company's tag with
     * this name (case-insensitive) or creates it, then attaches.
     */
    suspend fun attachTagByName(companyId: String, conversationId: String, name: String): Tag =
        api.post(
            "/v1/conversations/$conversationId/tags",
            buildJsonObject { put("name", name) },
            companyId = companyId,
        )

    /** Detach. 404 = it wasn't attached (already removed elsewhere). */
    suspend fun detachTag(companyId: String, conversationId: String, tagId: String) {
        api.delete("/v1/conversations/$conversationId/tags/$tagId", companyId = companyId)
    }

    // --- Sending -----------------------------------------------------------

    suspend fun send(
        companyId: String,
        conversationId: String,
        body: String,
        media: List<OutboundMedia>?,
        idempotencyKey: String,
    ): Message = api.post(
        "/v1/messages/send",
        SendBody(conversation_id = conversationId, body = body, media = media),
        companyId = companyId,
        idempotencyKey = idempotencyKey,
    )

    suspend fun compose(
        companyId: String,
        body: ComposeBody,
        idempotencyKey: String,
    ): ComposeResult = api.post(
        "/v1/conversations",
        body,
        companyId = companyId,
        idempotencyKey = idempotencyKey,
    )

    suspend fun retry(companyId: String, messageId: String): Message =
        api.post("/v1/messages/$messageId/retry", companyId = companyId)

    suspend fun createNote(
        companyId: String,
        conversationId: String,
        body: String,
        taskId: String? = null,
    ): Message = api.post(
        "/v1/conversations/$conversationId/notes",
        NoteBody(body = body, task_id = taskId),
        companyId = companyId,
    )

    // --- Per-message facets --------------------------------------------------

    suspend fun setDone(companyId: String, messageId: String, done: Boolean): Message =
        api.patch(
            "/v1/messages/$messageId",
            buildJsonObject { put("done", done) },
            companyId = companyId,
        )

    suspend fun setMessagePinned(
        companyId: String,
        messageId: String,
        pinned: Boolean,
    ): Message = api.patch(
        "/v1/messages/$messageId",
        buildJsonObject { put("pinned", pinned) },
        companyId = companyId,
    )

    /** Promote a message into a task ("Make a task"). 409 = already promoted. */
    suspend fun createTask(
        companyId: String,
        messageId: String,
        title: String,
        assignedUserId: String? = null,
        dueAtIso: String? = null,
    ): Task = api.post(
        "/v1/tasks",
        buildJsonObject {
            put("message_id", messageId)
            put("title", title)
            if (assignedUserId != null) put("assigned_user_id", assignedUserId)
            if (dueAtIso != null) put("due_at", dueAtIso)
        },
        companyId = companyId,
    )

    // --- Supporting reads -----------------------------------------------------

    suspend fun templates(companyId: String): Page<Template> =
        api.get("/v1/templates", companyId = companyId)

    suspend fun tags(companyId: String): Page<Tag> =
        api.get("/v1/tags", companyId = companyId)

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    suspend fun contact(companyId: String, contactId: String): Contact =
        api.get("/v1/contacts/$contactId", companyId = companyId)

    suspend fun contacts(
        companyId: String,
        q: String? = null,
        limit: Int = 10,
    ): Page<Contact> = api.get(
        "/v1/contacts",
        query = mapOf("q" to q, "limit" to limit.toString()),
        companyId = companyId,
    )

    suspend fun usage(companyId: String): Usage =
        api.get("/v1/usage", companyId = companyId)

    suspend fun search(companyId: String, q: String, cursor: String? = null): SearchResult =
        api.get(
            "/v1/search",
            query = mapOf("q" to q, "cursor" to cursor),
            companyId = companyId,
        )

    // --- Opt-out ---------------------------------------------------------------

    suspend fun optOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out", companyId = companyId)

    suspend fun revokeOptOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out/revoke", companyId = companyId)

    // --- Attachments -------------------------------------------------------------

    /** Mint a short-lived signed URL — call per view, NEVER cache the result. */
    suspend fun attachmentUrl(companyId: String, attachmentId: String): AttachmentUrl =
        api.get("/v1/attachments/$attachmentId/url", companyId = companyId)

    /** One note's live file attachments (renders the note bubble Files section). */
    suspend fun noteAttachments(companyId: String, noteId: String): Page<Attachment> =
        api.get(
            "/v1/attachments",
            query = mapOf("owner_type" to "note", "owner_id" to noteId),
            companyId = companyId,
        )

    /**
     * The conversation gallery (D21): MMS + note/task attachments merged,
     * newest first, cursor-paged. Every item carries a freshly-minted
     * short-lived signed URL — fetched per view, NEVER cached (each visit to
     * the gallery refetches, which is the per-view mint).
     */
    suspend fun gallery(
        companyId: String,
        conversationId: String,
        cursor: String? = null,
        limit: Int = 50,
    ): Page<GalleryItem> = api.get(
        "/v1/conversations/$conversationId/attachments",
        query = mapOf("cursor" to cursor, "limit" to limit.toString()),
        companyId = companyId,
    )

    // --- Contact panel (#165) -----------------------------------------------

    /** Patch ONE contact field; blank clears it (an explicit JSON null). */
    suspend fun updateContactField(
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

    /** The conversation checklist (T5.2): all live tasks, created_at ASC. */
    suspend fun conversationTasks(companyId: String, conversationId: String): Page<Task> =
        api.get("/v1/conversations/$conversationId/tasks", companyId = companyId)
}
