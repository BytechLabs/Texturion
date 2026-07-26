package com.loonext.android.core.model

import kotlinx.serialization.Serializable

// --- For You (D23) ---

@Serializable
data class ForYouWaiting(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val assigned_user_id: String? = null,
    val last_message_at: String,
    val unread: Boolean = false,
    val has_overdue_task: Boolean = false,
    /** 0 overdue-task · 1 waiting · 2 unread · 3 new (lower = more urgent). */
    val urgency: Int = 3,
)

@Serializable
data class ForYouTask(
    val task_id: String,
    val title: String,
    val conversation_id: String,
    val message_id: String,
    val assigned_user_id: String? = null,
    val due_at: String? = null,
    val overdue: Boolean = false,
)

/**
 * #342 — one spam-marked thread whose activity does not look like spam.
 *
 * A spam-marked thread appends silently, never notifies, and is frozen at the
 * moment it was marked, so it sinks in every list including the spam filter.
 * Right for a robotexter, catastrophic for a mis-tap: the customer keeps
 * texting and the business believes they stopped.
 */
@Serializable
data class SpamReviewItem(
    val conversation_id: String,
    val contact: ContactSummary? = null,
    val marked_at: String,
    val marked_by_user_id: String? = null,
    /** Inbound since the mark, or since it was last confirmed. */
    val inbound_since: Int = 0,
    /** The REAL latest inbound time — not the frozen list sort key. */
    val last_inbound_at: String,
    /** We texted this number before marking it. The strongest signal. */
    val we_texted_them: Boolean = false,
    /** Messages spread across days rather than one burst. */
    val sustained: Boolean = false,
    val high_volume: Boolean = false,
)

@Serializable
data class SpamReviewPage(val data: List<SpamReviewItem> = emptyList())

/**
 * #342: why this thread was raised, in the order the signals are trusted.
 * A count alone reads as a counter; naming the signal reads as the mistake it
 * probably is.
 */
fun spamReviewReason(item: SpamReviewItem): String = when {
    item.we_texted_them -> "You texted them before this was marked"
    item.sustained -> "Still texting, over several days"
    else -> "${item.inbound_since} messages since it was marked"
}

@Serializable
data class ForYouUnread(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val assigned_user_id: String? = null,
    val last_message_at: String,
)

@Serializable
data class ForYouTriageConversation(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val last_message_at: String,
    val unread: Boolean = false,
)

@Serializable
data class ForYouTriageTask(
    val task_id: String,
    val title: String,
    val conversation_id: String,
    val message_id: String,
    val due_at: String? = null,
    val overdue: Boolean = false,
)

/** Owner/admin-only strip; the whole field is null for a member. */
@Serializable
data class ForYouTriage(
    val conversations: List<ForYouTriageConversation> = emptyList(),
    val tasks: List<ForYouTriageTask> = emptyList(),
)

/** GET /v1/for-you — the four-section focus queue. */
/**
 * #306 — what each section ACTUALLY holds, independent of the 20 rows returned.
 *
 * Counting the rows was counting the PAGE: a member with 60 conversations
 * waiting on them was told "20 things need you" and the queue looked finished.
 * `distinct_work` is the only one to render as that headline — the per-section
 * totals overlap, and a client cannot dedupe them because it only ever holds
 * 20 of the N ids.
 *
 * Nullable: a client running ahead of the Worker falls back to counting rows,
 * which is today's behaviour rather than a new wrong number.
 */
@Serializable
data class ForYouTotals(
    val waiting_on_you: Int = 0,
    val my_tasks: Int = 0,
    val unread: Int = 0,
    val triage_conversations: Int = 0,
    val triage_tasks: Int = 0,
    val distinct_work: Int = 0,
)

@Serializable
data class ForYou(
    val waiting_on_you: List<ForYouWaiting> = emptyList(),
    val my_tasks: List<ForYouTask> = emptyList(),
    val unread: List<ForYouUnread> = emptyList(),
    val triage: ForYouTriage? = null,
    /** #306. Null from an older Worker; see [ForYouTotals]. */
    val totals: ForYouTotals? = null,
)

/**
 * #306: the headline number, honest when the server sends totals and the old
 * row-derived count when it does not.
 *
 * The fallback deduplicates the way the shipped web helper does: "waiting on
 * you" and "unread" overlap by design — the second is a cross-cut of the first
 * — so a thread in both is one thing to do, not two.
 */
fun forYouHeadlineWork(forYou: ForYou): Int {
    forYou.totals?.let { return it.distinct_work }
    val conversations = buildSet {
        forYou.waiting_on_you.forEach { add(it.conversation_id) }
        forYou.unread.forEach { add(it.conversation_id) }
        forYou.triage?.conversations?.forEach { add(it.conversation_id) }
    }
    val tasks = buildSet {
        forYou.my_tasks.forEach { add(it.task_id) }
        forYou.triage?.tasks?.forEach { add(it.task_id) }
    }
    return conversations.size + tasks.size
}

// --- Notifications (D24 derived feed) ---

object NotificationType {
    const val INBOUND_MESSAGE = "inbound_message"
    const val ASSIGNED = "assigned"
    const val TASK_ASSIGNED = "task_assigned"
    const val MISSED_CALL = "missed_call"
    const val MENTION = "mention"
}

@Serializable
data class NotificationItem(
    val id: String,
    val type: String,
    val conversation_id: String? = null,
    val message_id: String? = null,
    val task_id: String? = null,
    val contact: ContactSummary? = null,
    val created_at: String,
    val unread: Boolean = false,
)

@Serializable
/**
 * #343 - whether the workspace's daily notification allowance is spent.
 *
 * At the ceiling notifications stop reaching EVERY member while only the owner
 * is emailed, so a tech's phone just goes quiet and the reasonable inference is
 * that the business had a slow afternoon. `resets_at` is the company's next
 * LOCAL midnight.
 */
@Serializable
data class AlertPause(
    val email_paused: Boolean = false,
    val push_paused: Boolean = false,
    val resets_at: String? = null,
) {
    val anyPaused: Boolean get() = email_paused || push_paused
}

@Serializable
data class UnreadCount(
    val count: Int,
    /** #343. Null from an older Worker - treat as nothing paused. */
    val alert_pause: AlertPause? = null,
)

@Serializable
data class MarkReadResult(val last_seen_at: String)

/** POST /v1/notifications/:id/read — false when it was already read. */
@Serializable
data class NewlyRead(val newly_read: Boolean)

/** GET /v1/notification-prefs (+ vapid_public_key for web; unused natively). */
@Serializable
data class NotificationPrefs(
    val email_enabled: Boolean,
    val push_enabled: Boolean,
)
