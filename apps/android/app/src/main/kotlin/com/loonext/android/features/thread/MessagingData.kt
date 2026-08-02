package com.loonext.android.features.thread

import com.loonext.android.core.model.Attachment
import com.loonext.android.features.inbox.SAVED_VIEW_COUNT_MAX_VIEWS
import com.loonext.android.features.inbox.SavedView
import com.loonext.android.features.inbox.SavedViewCounts
import com.loonext.android.features.inbox.SavedViewPage
import com.loonext.android.core.model.AttachmentReport
import com.loonext.android.core.model.AttachmentUrl
import com.loonext.android.core.model.ComposeResult
import com.loonext.android.core.model.BulkConversationsResult
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.add
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.DestinationClock
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
import com.loonext.android.core.model.TagMergeResult
import com.loonext.android.core.model.TagUsage
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.Template
import com.loonext.android.core.model.Usage
import com.loonext.android.core.data.taskAddressJson
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
    /**
     * Teammates named in the body. Omitted when empty so an older server, and
     * the no-mention case, send exactly what they always did.
     */
    val mention_user_ids: List<String>? = null,
)

/**
 * A teammate who may be named on a note in ONE conversation. The server
 * answers this, not the client: number access decides who can see a thread,
 * and a note quotes the customer.
 */
@Serializable
data class MentionableMember(
    val user_id: String,
    val role: String = "member",
    val display_name: String = "",
)

/**
 * All messaging reads + mutations for the inbox / thread / composer features
 * (#153). Honors the binding invariants: Bearer + X-Company-Id ride every call
 * via [ApiClient], sends carry a client Idempotency-Key, cursor pagination is
 * opaque, and signed attachment URLs are minted per view — never cached.
 */
/** #280 request bodies. Separate types so each PATCH sends exactly one field. */
@Serializable
internal data class CreateSavedViewBody(
    val surface: String,
    val name: String,
    val filters: JsonObject,
    val shared: Boolean,
)

@Serializable
internal data class RenameSavedViewBody(val name: String)

@Serializable
internal data class ShareSavedViewBody(val shared: Boolean)

@Serializable
data class DefaultSavedViewBody(val surface: String, val view_id: String?)

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
        /**
         * #293: null is the server's default — the ordinary inbox hides what
         * this member deferred. Only "only" (the Snoozed view) and "all"
         * (opting out of the filter entirely) ever travel.
         */
        snoozed: String? = null,
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
            "snoozed" to snoozed,
            "q" to q,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    // --- #280 saved views -------------------------------------------------

    /**
     * The views this member may see, in order, plus which one they land on.
     *
     * A view holds FILTER PARAMETERS, never conversation ids. Opening one
     * replays them through [conversations] above, so #106 number access applies
     * per viewer and a shared view grants nothing.
     */
    suspend fun savedViews(companyId: String, surface: String = "conversations"): SavedViewPage =
        api.get("/v1/saved-views", query = mapOf("surface" to surface), companyId = companyId)

    /**
     * Queue badges, for at most [SAVED_VIEW_COUNT_MAX_VIEWS] views.
     *
     * Capped on this side as well as the server's, so the two ends agree about
     * what was asked. A badge that silently never arrives looks like a bug.
     */
    suspend fun savedViewCounts(
        companyId: String,
        ids: List<String>,
        surface: String = "conversations",
    ): SavedViewCounts = api.get(
        "/v1/saved-views/counts",
        query = mapOf(
            "surface" to surface,
            "ids" to ids.take(SAVED_VIEW_COUNT_MAX_VIEWS).joinToString(","),
        ),
        companyId = companyId,
    )

    suspend fun createSavedView(
        companyId: String,
        name: String,
        filters: JsonObject,
        shared: Boolean,
        surface: String = "conversations",
    ): SavedView = api.post(
        "/v1/saved-views",
        body = CreateSavedViewBody(surface, name, filters, shared),
        companyId = companyId,
    )

    suspend fun renameSavedView(companyId: String, id: String, name: String): SavedView =
        api.patch("/v1/saved-views/$id", body = RenameSavedViewBody(name), companyId = companyId)

    suspend fun shareSavedView(companyId: String, id: String, shared: Boolean): SavedView =
        api.patch("/v1/saved-views/$id", body = ShareSavedViewBody(shared), companyId = companyId)

    suspend fun deleteSavedView(companyId: String, id: String) =
        api.delete("/v1/saved-views/$id", companyId = companyId)

    /** Land on this view, or on nothing when [viewId] is null. */
    suspend fun setDefaultSavedView(
        companyId: String,
        viewId: String?,
        surface: String = "conversations",
    ): DefaultSavedViewBody = api.put(
        "/v1/saved-views/default",
        body = DefaultSavedViewBody(surface, viewId),
        companyId = companyId,
    )

    /**
     * #293 — defer a thread out of MY list until [untilIso].
     *
     * The instant is absolute and resolved on the DEVICE, because #292 says
     * "tomorrow morning" is the user's morning and only the device knows what
     * that is. A customer reply cancels it in the database, whatever the timer
     * said, so nothing on this side has to remember that rule.
     */
    suspend fun snooze(
        companyId: String,
        conversationId: String,
        untilIso: String,
        note: String? = null,
        /** "snooze" returns it quietly; "follow_up" returns it to be chased. */
        kind: String = "snooze",
    ) {
        api.post<JsonObject, JsonObject>(
            "/v1/conversations/$conversationId/snooze",
            buildJsonObject {
                put("until", untilIso)
                if (note != null) put("note", note)
                put("kind", kind)
            },
            companyId = companyId,
        )
    }

    /** #293 — bring it back now. Idempotent, so one tap is always safe. */
    suspend fun unsnooze(companyId: String, conversationId: String) {
        api.delete("/v1/conversations/$conversationId/snooze", companyId = companyId)
    }

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

    /** Drops the caller's read watermark, so the conversation counts as unread everywhere. */
    suspend fun markUnread(companyId: String, conversationId: String) {
        api.delete("/v1/conversations/$conversationId/read", companyId = companyId)
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

    /**
     * #275 — one action over many conversations.
     *
     * Pass `ids` for a pointed-at selection, or leave it null and pass the filter
     * so the SERVER resolves the set. That distinction is the whole point: the
     * client never enumerates "everything matching", so it cannot include rows the
     * #106 deny list would have excluded.
     *
     * The response carries the prior values an undo needs. There is deliberately
     * no send action — bulk management only.
     */
    suspend fun bulkConversations(
        companyId: String,
        action: String,
        ids: List<String>? = null,
        filterStatus: String? = null,
        filterUnread: Boolean = false,
        filterSpam: Boolean = false,
        targetStatus: String? = null,
        targetUserId: String? = null,
        targetSpam: Boolean? = null,
        targetTagId: String? = null,
        /** True when the caller means "unassign", which is a null the server needs. */
        unassign: Boolean = false,
    ): BulkConversationsResult = api.post(
        "/v1/conversations/bulk",
        buildJsonObject {
            put("action", action)
            if (ids != null) {
                putJsonArray("ids") { ids.forEach { add(it) } }
            } else {
                putJsonObject("filter") {
                    if (filterStatus != null) put("status", filterStatus)
                    if (filterUnread) put("unread", true)
                    if (filterSpam) put("is_spam", true)
                }
            }
            if (targetStatus != null) put("target_status", targetStatus)
            if (targetSpam != null) put("target_spam", targetSpam)
            if (targetTagId != null) put("target_tag_id", targetTagId)
            // Explicit null is meaningful here (unassign), so it is only written
            // when the caller says so rather than whenever the id is absent.
            if (targetUserId != null) put("target_user_id", targetUserId)
            else if (unassign) put("target_user_id", JsonNull)
        },
        companyId = companyId,
    )

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
        mentionUserIds: List<String> = emptyList(),
    ): Message = api.post(
        "/v1/conversations/$conversationId/notes",
        NoteBody(
            body = body,
            task_id = taskId,
            mention_user_ids = mentionUserIds.ifEmpty { null },
        ),
        companyId = companyId,
    )

    /** Who this member may name on a note here (already number-access filtered). */
    suspend fun mentionableMembers(
        companyId: String,
        conversationId: String,
    ): List<MentionableMember> =
        api.get<Page<MentionableMember>>(
            "/v1/conversations/$conversationId/mentionable-members",
            companyId = companyId,
        ).data

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

    /**
     * Promote a message into a task ("Make a task"). 409 = already promoted.
     * #214: [address] carries the confirmed enriched (or hand-entered) job
     * address; null when the task has none.
     */
    suspend fun createTask(
        companyId: String,
        messageId: String,
        title: String,
        assignedUserId: String? = null,
        dueAtIso: String? = null,
        address: TaskAddressInput? = null,
    ): Task = api.post(
        "/v1/tasks",
        buildJsonObject {
            put("message_id", messageId)
            put("title", title)
            if (assignedUserId != null) put("assigned_user_id", assignedUserId)
            if (dueAtIso != null) put("due_at", dueAtIso)
            if (address != null) put("address", taskAddressJson(address))
        },
        companyId = companyId,
    )

    // --- Supporting reads -----------------------------------------------------

    suspend fun templates(companyId: String): Page<Template> =
        api.get("/v1/templates", companyId = companyId)

    // --- Saved replies (Settings → Templates) ---------------------------------
    // Member-level for every operation (routes/templates.ts): any active
    // teammate may write them, so these carry no extra role check.

    suspend fun createTemplate(companyId: String, name: String, body: String): Template =
        api.post(
            "/v1/templates",
            buildJsonObject {
                put("name", name)
                put("body", body)
            },
            companyId = companyId,
        )

    suspend fun updateTemplate(
        companyId: String,
        templateId: String,
        name: String,
        body: String,
    ): Template = api.patch(
        "/v1/templates/$templateId",
        buildJsonObject {
            put("name", name)
            put("body", body)
        },
        companyId = companyId,
    )

    suspend fun deleteTemplate(companyId: String, templateId: String) {
        api.delete("/v1/templates/$templateId", companyId = companyId)
    }

    suspend fun tags(companyId: String): Page<Tag> =
        api.get("/v1/tags", companyId = companyId)

    /** #298: the same list with use counts, busiest first (member-readable). */
    suspend fun tagUsage(companyId: String): Page<TagUsage> =
        api.get("/v1/tags/usage", companyId = companyId)

    /**
     * #298: fold [fromTagId] into [intoTagId], keeping every association.
     * Delete was the only cleanup and it loses them all, so an admin who found
     * six variants could previously only destroy five.
     */
    suspend fun mergeTags(
        companyId: String,
        fromTagId: String,
        intoTagId: String,
    ): TagMergeResult = api.post(
        "/v1/tags/$fromTagId/merge",
        buildJsonObject { put("into_tag_id", intoTagId) },
        companyId = companyId,
    )

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

    /**
     * #317 — pull a file back for the WHOLE workspace.
     *
     * The scan (D101) stops what it can recognise and is explicitly not
     * antivirus, so this is the path for whatever gets past it. Available to
     * any member on purpose: behind owner-only, the person holding the phone
     * cannot stop the thing they just spotted, and waiting is how somebody ends
     * up opening it to check.
     */
    suspend fun reportAttachment(
        companyId: String,
        attachmentId: String,
    ): AttachmentReport =
        api.post("/v1/attachments/$attachmentId/report", companyId = companyId)

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

// ---------------------------------------------------------------------------
// The destination clock (#225 / D49)
// ---------------------------------------------------------------------------

/**
 * "It's about 9pm where they are (from their area code)." — the line above the
 * composer, and only when it would change what somebody does.
 *
 * A reply inside a thread the customer started is reply-exempt and never
 * blocked: a trade owner texting their own customer back at 9:15pm is their
 * call. But most people have no idea what time it is in a 613 area code, and
 * finding out from an annoyed customer is the expensive way.
 *
 * Returns null when it is daytime there, because a clock that sits on screen
 * all day is furniture and furniture is not read.
 *
 * Hand-ported to three clients, so it lives here with a test: the failure mode
 * is one app telling somebody a different hour than another, which is worse
 * than no hint at all.
 */
fun theirTimeLine(clock: DestinationClock?): String? {
    if (clock == null || !clock.quiet) return null
    val suffix = if (clock.local_hour < 12) "am" else "pm"
    val twelve = if (clock.local_hour % 12 == 0) 12 else clock.local_hour % 12
    return "It's about $twelve$suffix where they are (${clockProvenance(clock.source)})."
}

/**
 * Which rung answered, said plainly.
 *
 * The weakest one admits itself outright: showing our own timezone as though
 * it were the customer's would be the quiet lie, and the whole value of the
 * ladder is that a screen can say how much to trust it.
 */
fun clockProvenance(source: String): String = when (source) {
    "contact" -> "set on their contact"
    "area_code" -> "from their area code"
    else -> "your workspace's timezone — we don't know theirs"
}
