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
    /**
     * #298: what this tag MEANS, in the crew's own words. Null when nobody has
     * said — which is most of them, and must stay comfortable: a required
     * description would be answered with "warranty" for a tag named Warranty
     * by everybody in a hurry, and that looks like an answer without being one.
     */
    val description: String? = null,
    val created_at: String? = null,
    val updated_at: String? = null,
)

/**
 * #298: one tag and how much it is actually used. Ordered busiest-first by the
 * server, because the tail is where the duplicates and the dead ones both live
 * — and neither is visible from the tag names alone.
 */
@Serializable
data class TagUsage(
    val tag_id: String,
    val name: String,
    /** #298: what it means, so the merge decision can be made from this list. */
    val description: String? = null,
    val uses: Long = 0,
    val last_used: String? = null,
)

/** #298: what a merge did, so the confirmation can say it back. */
@Serializable
data class TagMergeResult(
    val merged: Boolean = false,
    val moved: Int = 0,
    val already_both: Int = 0,
    val stage_moved: Boolean = false,
)

/**
 * #250: one reason the classifier scored a thread.
 *
 * Hand-copied across the wire boundary from
 * apps/api/src/messaging/spam-signals.ts — the scoring never runs on a
 * client, so only the shape travels. Every field defaults, because a
 * badge is never worth failing a decode over.
 */
@Serializable
data class SpamSignal(
    val key: String = "",
    val weight: Int = 0,
    /** A full sentence, rendered verbatim. */
    val why: String = "",
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
    /**
     * #414: when this thread last carried an emergency reply (URGENT/
     * EMERGENCY/911/SOS). The inbox badges it while the thread is open.
     */
    val emergency_at: String? = null,
    /**
     * #396: when an inbound message here last READ as a plain-English opt-out.
     * A warning for whoever replies next, never an opt-out — only the contact
     * can opt out, and only they can lift it.
     */
    val opt_out_hint_at: String? = null,
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
    /** How many attachments ride the last message. Defaulted so a response from
     *  a server predating migration 20260724080000 still decodes. */
    val attachment_count: Int? = null,
    /** The kind they all share, "file" for a mixed set, null when there are
     *  none. The inbox labels from THIS instead of guessing a noun. */
    val attachment_kind: String? = null,
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
    /** #414: set when a customer replied URGENT; badged while the thread is open. */
    val emergency_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val contact: ContactSummary,
    val tags: List<Tag> = emptyList(),
    val unread: Boolean = false,
    val last_message: ConversationSnippet? = null,
    /**
     * #293: when THIS member's deferral brings the thread back, and why they
     * deferred it. Null for everyone else — the snooze is mine, the
     * conversation is the crew's — and null once the return time has passed,
     * because the server computes "currently deferred" rather than sweeping
     * rows on a timer.
     */
    val snoozed_until: String? = null,
    val snooze_note: String? = null,
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
    /**
     * #241: why the send failed, in OUR taxonomy rather than the carrier's.
     * Null on rows written before the column existed — readers use
     * [failureReasonOf], which falls back to classifying the code.
     */
    val error_reason: String? = null,
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
            // #241: OUR reason, not the vendor's code. This used to compare
            // against a Telnyx constant shipped inside the app.
            isRetryableFailure(failureReasonOf(error_reason, error_code))
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
    /**
     * #396: when an inbound message here last READ as a plain-English opt-out.
     * A warning for whoever replies next, never an opt-out — only the contact
     * can opt out, and only they can lift it.
     */
    val opt_out_hint_at: String? = null,
    /**
     * #250: when the inbound classifier last scored this thread above the
     * threshold. Never set by a person, and never a reason to hide the
     * thread — it suppressed the notification and nothing else.
     */
    val spam_suspected_at: String? = null,
    /** #250: the reasons behind it, so the badge can say WHY. */
    val spam_signals: List<SpamSignal> = emptyList(),
    val created_at: String,
    val updated_at: String,
    val contact: ConversationDetailContact,
    val tags: List<Tag> = emptyList(),
    val messages: Page<Message>,
    /**
     * #293: when THIS member's deferral brings the thread back, and why they
     * deferred it. Null for everyone else — the snooze is mine, the
     * conversation is the crew's — and null once the return time has passed,
     * because the server computes "currently deferred" rather than sweeping
     * rows on a timer.
     */
    val snoozed_until: String? = null,
    val snooze_note: String? = null,
    /**
     * #293: how it comes back — "snooze" quietly, "follow_up" as something to
     * chase. Detail only: the list cannot tell "back Thursday" from "chase
     * them Thursday", and in the thread that is the difference between a
     * reminder and a nap.
     */
    val snooze_kind: String? = null,
    /** #106: 'note' = read + internal notes only (composer hides SMS mode). */
    val viewer_level: String = "text",
    /**
     * #225 / D49: what time it is where the customer is. Resolved server-side
     * by the same module the send gate uses, so the composer's hint and the
     * gate's decision cannot disagree.
     */
    val destination_clock: DestinationClock? = null,
)

/**
 * #225 / D49 — the destination's clock, and which rung of the ladder answered.
 *
 * `source` matters as much as the hour: an area code is a GUESS that can be
 * wrong (a mobile keeps its code when its owner moves), so a screen shows the
 * provenance rather than presenting an inference as a fact.
 */
@Serializable
data class DestinationClock(
    val timezone: String,
    /** 'contact' | 'area_code' | 'company'. */
    val source: String = "company",
    val local_hour: Int = 0,
    /** Inside their quiet window, accounting for state rules (Texas Sundays). */
    val quiet: Boolean = false,
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
    /**
     * #274: the crew's own grouping. Free text and optional — a taxonomy we
     * imposed would be ignored, and a category is worth typing at thirty
     * templates and friction at five.
     */
    val category: String? = null,
    val created_by: String? = null,
    /** #419: who last edited this shared copy. */
    val updated_by: String? = null,
    /** #419: that editor's display name, resolved SERVER-side (#191
     *  attribution) so the three clients cannot disagree. Null when the id
     *  resolves to nobody — a member who has left, or an edit predating the
     *  column — and the row then omits the attribution rather than guessing. */
    val updated_by_name: String? = null,
    val created_at: String,
    val updated_at: String,
)

/** GET /v1/attachments/:id/url — short-lived signed URL; never cache. */
@Serializable
data class AttachmentUrl(val url: String, val expires_at: String)

/**
 * POST /v1/attachments/:id/report — #317. The response is the resulting state
 * rather than an ack, so a second report (which is a no-op, because two techs
 * flagging the same file is the normal case) still answers with the truth.
 */
@Serializable
data class AttachmentReport(val id: String, val quarantined: Boolean)

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

/**
 * #275 — what POST /v1/conversations/bulk returns.
 *
 * `previous` is a raw JsonObject on purpose: the server decides which field an
 * action records, the client hands it straight back to build the undo, and
 * narrowing it here would mean this file has to change every time an action is
 * added. `applied.size` is the only count that describes reality — `matched` can
 * be larger (the cap) and both can exceed it (rows that could not be reached).
 */
/**
 * #478 — what POST /v1/tasks/bulk returns. Identical in shape to the
 * conversations result on purpose: one renderer reads both, and the selection
 * module's `bulkResultMessage` takes either.
 */
@Serializable
data class BulkTasksResult(
    val action: String = "",
    val matched: Int = 0,
    val applied: List<BulkAppliedRow> = emptyList(),
    val failed: List<BulkFailedRow> = emptyList(),
    val capped: Boolean = false,
)

@Serializable
data class BulkAppliedRow(
    val id: String,
    val previous: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class BulkFailedRow(
    val id: String,
    val reason: String,
)

@Serializable
data class BulkConversationsResult(
    val action: String = "",
    val matched: Int = 0,
    val applied: List<BulkAppliedRow> = emptyList(),
    val failed: List<BulkFailedRow> = emptyList(),
    val capped: Boolean = false,
)
