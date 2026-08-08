package com.loonext.android.features.thread

import com.loonext.android.core.time.TwoClocks
import com.loonext.android.core.model.AcknowledgeResult
import com.loonext.android.core.model.Attachment
import com.loonext.android.features.inbox.SAVED_VIEW_COUNT_MAX_VIEWS
import com.loonext.android.features.inbox.SavedView
import com.loonext.android.features.inbox.SavedViewCounts
import com.loonext.android.features.inbox.SavedViewPage
import com.loonext.android.core.model.AttachmentReport
import com.loonext.android.core.model.AttachmentUrl
import com.loonext.android.core.model.CarrierStanding
import com.loonext.android.core.model.ComposeResult
import com.loonext.android.core.model.BulkConversationsResult
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.add
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.model.Conversation
import com.loonext.android.core.model.LeadSource
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.GalleryItem
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.OptOut
import com.loonext.android.core.model.OutboundMedia
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.core.model.ScheduledMessageEnvelope
import com.loonext.android.core.model.ScheduledMessagePage
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.THREAD_SUMMARY_NOT_ALLOWED
import com.loonext.android.core.model.ThreadSummary
import com.loonext.android.core.model.TagMergeResult
import com.loonext.android.core.model.TagUsage
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.Template
import com.loonext.android.core.model.Usage
import com.loonext.android.core.data.taskAddressJson
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlin.coroutines.cancellation.CancellationException
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
    /** #475: the saved reply this was built from, if any. */
    val template_id: String? = null,
    /** #274: whether the words changed after it was inserted. */
    val template_edited: Boolean? = null,
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
    /** #475: the saved reply this was built from, if any. */
    val template_id: String? = null,
    /** #274: whether the words changed after it was inserted. */
    val template_edited: Boolean? = null,
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
        /**
         * #508: "only" narrows to threads nobody has replied to yet — the #388
         * lead clock, not `status`. Null is no filter at all (not "exclude"):
         * the ordinary inbox shows answered and unanswered alike.
         */
        awaiting: String? = null,
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
            "awaiting" to awaiting,
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

    // --- #233 send later --------------------------------------------------

    /**
     * What is queued — one thread's, or the whole workspace's when
     * [conversationId] is null.
     *
     * Live rows only by default. The finished ones are history, and a strip
     * that had to scroll past last month's sent messages to show what is coming
     * would be showing the wrong thing.
     */
    suspend fun scheduledMessages(
        companyId: String,
        conversationId: String? = null,
        status: String? = null,
    ): ScheduledMessagePage = api.get(
        "/v1/scheduled-messages",
        query = mapOf("conversation_id" to conversationId, "status" to status),
        companyId = companyId,
    )

    /**
     * Queue a text for [sendAtIso].
     *
     * [quietHoursConfirmed] rides the SECOND attempt only. The API answers 409
     * `quiet_hours_confirmation_required` against the FIRE instant, the screen
     * asks, and the retry carries the flag — #225 ask 2 is warned, never
     * blocked, and the handshake is recognised by CODE rather than by reading
     * the sentence.
     */
    suspend fun scheduleMessage(
        companyId: String,
        conversationId: String,
        body: String,
        sendAtIso: String,
        quietHoursConfirmed: Boolean = false,
    ): ScheduledMessage = api.post<ScheduledMessageEnvelope, JsonObject>(
        "/v1/scheduled-messages",
        buildJsonObject {
            put("conversation_id", conversationId)
            put("body", body)
            put("send_at", sendAtIso)
            if (quietHoursConfirmed) put("quiet_hours_confirmed", true)
        },
        companyId = companyId,
    ).scheduled_message

    /**
     * Move a queued text, or change its words.
     *
     * Rescheduling a HELD message puts it back in the queue — the person has
     * looked at why it stopped and decided it should still go. That is the
     * server's rule, not a guess made here; this only carries the new time.
     */
    suspend fun rescheduleMessage(
        companyId: String,
        id: String,
        sendAtIso: String? = null,
        body: String? = null,
        quietHoursConfirmed: Boolean = false,
    ): ScheduledMessage = api.patch<ScheduledMessageEnvelope, JsonObject>(
        "/v1/scheduled-messages/$id",
        buildJsonObject {
            if (sendAtIso != null) put("send_at", sendAtIso)
            if (body != null) put("body", body)
            if (quietHoursConfirmed) put("quiet_hours_confirmed", true)
        },
        companyId = companyId,
    ).scheduled_message

    /** Cancel it. A message that has already gone is a 404, not a success. */
    suspend fun cancelScheduledMessage(companyId: String, id: String) {
        api.delete("/v1/scheduled-messages/$id", companyId = companyId)
    }

    /** #244: "I have this." Returns the outcome so the caller can name whose. */
    suspend fun acknowledgeAlert(companyId: String, alertId: String): AcknowledgeResult =
        api.post("/v1/on-call/alerts/$alertId/acknowledge", companyId = companyId)

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

    /**
     * #301: where this customer came from, as a person answered it.
     *
     * Null CLEARS it back to unknown rather than falling back to the line's
     * source — a tech who picked the wrong chip needs to be able to say
     * "actually I don't know", and re-deriving would dress that up as a fact.
     */
    suspend fun setLeadSource(
        companyId: String,
        conversationId: String,
        leadSourceId: String?,
    ): Conversation = patchConversation(
        companyId,
        conversationId,
        buildJsonObject {
            if (leadSourceId == null) put("lead_source_id", JsonNull)
            else put("lead_source_id", leadSourceId)
        },
    )

    /** #301: the workspace's own list, for the picker. */
    suspend fun leadSources(companyId: String): List<LeadSource> =
        api.get<Page<LeadSource>>("/v1/lead-sources", companyId = companyId).data

    /**
     * #250: "this is not spam" against the CLASSIFIER, which is a different
     * sentence from [setSpam] against a person's own mark. The server accepts
     * only false — nothing may set a suspicion from outside, or it stops
     * being the machine's own opinion.
     */
    suspend fun clearSpamSuspicion(companyId: String, conversationId: String): Conversation =
        patchConversation(
            companyId,
            conversationId,
            buildJsonObject { put("spam_suspected", false) },
        )

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
        templateId: String? = null,
        templateEdited: Boolean = false,
    ): Message = api.post(
        "/v1/messages/send",
        SendBody(
            conversation_id = conversationId,
            body = body,
            media = media,
            template_id = templateId,
            // Omitted entirely without a template, so an ordinary typed send
            // carries exactly the payload it always did.
            template_edited = if (templateId != null) templateEdited else null,
        ),
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

    /**
     * #274 — two orders, because two people are asking different questions.
     *
     * [byUse] is the composer's picker: somebody about to send wants the reply
     * they send twenty times a day, and alphabetical puts it wherever its name
     * falls. The default is the settings list, where a stable place to find a
     * template beats a list that reorders itself as the crew works.
     */
    suspend fun templates(companyId: String, byUse: Boolean = false): Page<Template> =
        api.get(
            "/v1/templates",
            query = if (byUse) mapOf("sort" to "use") else emptyMap(),
            companyId = companyId,
        )

    // --- Saved replies (Settings → Templates) ---------------------------------
    // Member-level for every operation (routes/templates.ts): any active
    // teammate may write them, so these carry no extra role check.

    suspend fun createTemplate(
        companyId: String,
        name: String,
        body: String,
        /** #274: the crew's own grouping. Blank travels as "" and the API
         *  normalises it to null, which is how a clear is expressed. */
        category: String = "",
    ): Template =
        api.post(
            "/v1/templates",
            buildJsonObject {
                put("name", name)
                put("body", body)
                put("category", category)
            },
            companyId = companyId,
        )

    suspend fun updateTemplate(
        companyId: String,
        templateId: String,
        name: String,
        body: String,
        category: String = "",
    ): Template = api.patch(
        "/v1/templates/$templateId",
        buildJsonObject {
            put("name", name)
            put("body", body)
            put("category", category)
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

    /** #298: say what a tag means. Blank clears it back to unexplained. */
    suspend fun describeTag(companyId: String, tagId: String, description: String): Tag =
        api.patch(
            "/v1/tags/$tagId",
            buildJsonObject {
                if (description.isBlank()) put("description", JsonNull)
                else put("description", description)
            },
            companyId = companyId,
        )

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

    // --- Catch-up (#247) -------------------------------------------------------

    /**
     * POST /v1/conversations/:id/summary — three cited sections for a thread
     * that is long, or long enough forgotten, to be expensive to re-read.
     *
     * NOT cached here, and the reason is the opposite of the drafting one. The
     * SERVER caches this against the thread's last message id, so re-asking an
     * unchanged thread costs nothing and still comes back fresh if a message
     * arrived. A second cache on the device could only serve a catch-up that
     * predates a message the person can see on screen — the one failure that
     * matters most for a surface whose whole claim is "this is what the thread
     * says".
     *
     * Never rejects: every failure resolves to no lines and a reason the card
     * explains in place, and nothing else changes. A catch-up that fails must
     * leave the thread exactly as it was, because the thread was always the
     * record.
     *
     * WHICH reason is the part that had a defect. Every non-cancellation
     * exception used to become `model_error` — "Couldn't reach Lou just now.
     * Try again." — including the one refusal that has nothing to do with Lou
     * and cannot be fixed by trying again: a member whose ROLE may not spend
     * the workspace's catch-ups. See [threadSummaryReasonFor].
     *
     * WHAT ELSE A MANUFACTURED REFUSAL HAS TO CARRY: the contact's standing.
     * See [threadSummaryRefusal] — a failed re-ask used to take the customer's
     * STOP off the card with it.
     */
    suspend fun threadSummary(
        companyId: String,
        conversationId: String,
        /**
         * The last standing the SERVER stated for this thread, or null if it
         * has never stated one (a first ask).
         *
         * No default value, deliberately. A call site that forgets this
         * argument is one that drops a customer's STOP off the card at the
         * press that failed, and a defaulted parameter is how that forgetting
         * happens silently — there is nothing else about the resulting refusal
         * that looks wrong.
         */
        standing: CarrierStanding?,
    ): ThreadSummary = try {
        api.post("/v1/conversations/$conversationId/summary", companyId = companyId)
    } catch (e: CancellationException) {
        // The reader left the thread mid-request: never swallow cancellation.
        throw e
    } catch (cause: ApiException) {
        threadSummaryRefusal(threadSummaryReasonFor(cause.code), standing)
    } catch (_: Exception) {
        // Everything that is not an answer from the server: a decode mismatch
        // (our bug), an unexpected throw. Nothing here can name a cause the
        // reader could act on, so it keeps the sentence that at least says the
        // catch-up did not happen.
        threadSummaryRefusal("model_error", standing)
    }

    // --- Opt-out ---------------------------------------------------------------

    suspend fun optOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out", companyId = companyId)

    suspend fun revokeOptOut(companyId: String, contactId: String): OptOut =
        api.post("/v1/contacts/$contactId/opt-out/revoke", companyId = companyId)

    // --- Attachments -------------------------------------------------------------

    /**
     * Mint a short-lived signed URL — call per view, NEVER cache the result.
     *
     * #240: the DEFAULT is the preview, because the callers that mint the most
     * of these are thread bubbles and gallery tiles, and a 25 MB original
     * behind a 176dp thumbnail was the single worst egress shape in the
     * product — on our allowance and on the tech's own mobile data (#289).
     *
     * Pass "original" to OPEN or DOWNLOAD the file: a deliberate act by a
     * caller that wants the file rather than a picture of it. A row with no
     * preview serves its original either way, so nothing uploaded before this
     * shipped changes behaviour.
     */
    suspend fun attachmentUrl(
        companyId: String,
        attachmentId: String,
        variant: String = "preview",
    ): AttachmentUrl =
        api.get(
            "/v1/attachments/$attachmentId/url",
            query = if (variant == "original") mapOf("variant" to "original") else emptyMap(),
            companyId = companyId,
        )

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
// The catch-up (#247)
// ---------------------------------------------------------------------------

/**
 * What to tell the reader when the summary route refused with an error
 * envelope, keyed on the SPEC §7 [ApiErrorCode] it sent.
 *
 * KEYED ON THE CODE, NEVER ON THE STATUS, and that is the whole care in this
 * function. Six codes share the 403: `forbidden`, `sending_suspended`,
 * `registration_pending`, `recipient_opted_out`, `mfa_required` and
 * `mfa_challenge_required`. Only the first of them is a statement about what
 * this reader's role may do, and a mapping written as `httpStatus == 403` would
 * tell somebody being asked for a second factor that their role is too small.
 *
 * What this DOES cover: `forbidden`, which on this route can only come from
 * `requireCapability("conversations.note")` — the per-number gate is called
 * with `need: "read"`, and that gate answers `not_found` rather than
 * `forbidden` (apps/api/src/auth/number-access.ts).
 *
 * What it does NOT cover, said plainly rather than implied: every other code
 * keeps `model_error`, whose sentence is "Couldn't reach Lou just now. Try
 * again." That is honest for the 5xx and the network drop and merely vague for
 * the rest; it is not a claim that the cause was the model. A code that
 * deserves its own sentence should get one here rather than a comment.
 */
fun threadSummaryReasonFor(code: String): String = when (code) {
    ApiErrorCode.FORBIDDEN -> THREAD_SUMMARY_NOT_ALLOWED
    else -> "model_error"
}

/**
 * The refusal this client writes when the server wrote none.
 *
 * THE DEFECT IT FIXES. `opt_out` and `opt_out_hint_at` ride on every answer the
 * ROUTE sends, and the card draws the carrier warning from them. A 403 and a
 * dead socket are the two answers the route did not send: this client invents
 * them, and it used to invent them with both fields empty. So a workspace whose
 * customer had texted STOP was told so on the card, pressed "try again", the
 * request failed — and the warning went, on the answer that replaced it, for
 * good. One user action, and the same press behaved differently on the web.
 *
 * WHAT THE TWO FIELDS MEAN HERE, since it is not what they mean on a response
 * and a comment claiming otherwise would be the worse failure: they are the last
 * standing the server stated for THIS thread, which is at most one request old.
 * Still a deterministic `opt_outs` read the server performed, still never
 * inferred and never model output — but not a read taken at this instant,
 * because no read happened at this instant. It is superseded by the next real
 * answer, including one that states the STOP is lifted, since that answer
 * carries its own two fields and replaces this whole object.
 *
 * A [CarrierStanding] and nothing else. Carrying the displaced answer forward
 * with a fresh reason stamped on it would be the easier change and the wrong
 * one: it would leave Lou's last reading of the thread on screen underneath a
 * failure, which is a stale catch-up wearing a current one's clothes.
 */
fun threadSummaryRefusal(reason: String, standing: CarrierStanding?): ThreadSummary =
    ThreadSummary(
        reason = reason,
        opt_out = standing?.optOut,
        opt_out_hint_at = standing?.optOutHintAt,
    )

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
    val line = "It's about $twelve$suffix where they are (${clockProvenance(clock.source)})."
    // #539: WHY theirs is the clock that counts, and that a wrong guess is
    // correctable. The issue asked "why are we deriving time from customers area
    // codes even? what if i bought my phone number in quebec but now live in
    // alberta?" and the answer was on no screen.
    //
    // Only on the GUESSED rung: somebody who already set the zone on the contact
    // does not need telling they can, and offering to correct a non-geographic
    // number would be offering to fix an inference we never made.
    if (clock.source != "area_code") return line
    return "$line ${TwoClocks.AREA_CODE_NOTE}"
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
