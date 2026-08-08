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

/**
 * #293 — one follow-up reminder that has come DUE.
 *
 * Its own section rather than folded into "waiting on you": that one means
 * "you have not answered them". This means "they have not answered YOU, and
 * you asked to be told" — a different job, and the highest-value one in the
 * business to be reminded about.
 */
@Serializable
data class ForYouFollowUp(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val last_message_at: String,
    val unread: Boolean = false,
    /** When you asked to be reminded. Always past by the time it is here. */
    val due_at: String,
    /** The reason you gave, if you gave one. */
    val note: String? = null,
)

/** Owner/admin-only strip; the whole field is null for a member. */
@Serializable
data class ForYouTriage(
    val conversations: List<ForYouTriageConversation> = emptyList(),
    val tasks: List<ForYouTriageTask> = emptyList(),
)

/**
 * GET /v1/reports/response-time (#239) — how fast this workspace answers a NEW
 * customer, and how that changed since they started.
 *
 * Every number here is computed server-side; the client does no arithmetic on
 * them. A median computed twice is a median that can disagree with itself, and
 * the whole value of this metric is that the crew trusts it. The definition lives
 * in docs/RESPONSE-TIME.md.
 */
@Serializable
data class ResponseTimeSide(
    val leads: Int = 0,
    val answered: Int = 0,
    val median_seconds: Double? = null,
)

@Serializable
data class ResponseTimeMember(
    val user_id: String,
    val answered: Int = 0,
    val median_seconds: Double? = null,
)

/**
 * #482: one line's response time.
 *
 * ALREADY labelled and already filtered by the server — an empty list means the
 * leads arrived on one number, where this row would repeat the headline. There
 * is no condition here to get wrong, which is the point: the same rule written
 * in three clients is three chances to disagree about it.
 */
@Serializable
data class ResponseTimeNumber(
    val phone_number_id: String,
    /** The number a person would recognise, e.g. "+14165551234". */
    val number_e164: String,
    val leads: Int = 0,
    val answered: Int = 0,
    val median_seconds: Double? = null,
)

@Serializable
data class ResponseTimeBaseline(
    val leads: Int = 0,
    val answered: Int = 0,
    val median_seconds: Double? = null,
)

@Serializable
data class ResponseTimeWindow(val days: Int = 30)

@Serializable
/**
 * #313 — the satisfaction report, hand-ported from the web client's type.
 *
 * Every refusal in here is the SERVER's: `average` arrives null when the sample
 * is too thin to mean anything, and `by_member` arrives null when the owner has
 * not turned per-person scores on. This client never fills either gap — the
 * whole point is that three clients cannot disagree about when five answers
 * become a trend.
 */
data class SatisfactionMember(
    val user_id: String = "",
    /** Null when the profile row is missing — our gap, not "Unknown". */
    val name: String? = null,
    val answered: Int = 0,
    /** Null when this member alone is under the floor. */
    val average: Double? = null,
)

data class SatisfactionBaseline(
    val since: String = "",
    val until: String = "",
    val answered: Int = 0,
    val average: Double = 0.0,
)

data class SatisfactionReport(
    val window: ResponseTimeWindow = ResponseTimeWindow(),
    val asked: Int = 0,
    val answered: Int = 0,
    val average: Double? = null,
    val sample_too_small: Boolean = false,
    val minimum_sample: Int = 0,
    val distribution: Map<String, Int> = emptyMap(),
    /** Jobs that needed a call back. Each already woke somebody that day. */
    val poor: Int = 0,
    val by_member: List<SatisfactionMember>? = null,
    val per_member_enabled: Boolean = false,
    val baseline: SatisfactionBaseline? = null,
    val improved_by: Double? = null,
    val truncated: Boolean = false,
    val row_limit: Int = 0,
)

data class ResponseTimeReport(
    val window: ResponseTimeWindow = ResponseTimeWindow(),
    val leads: Int = 0,
    val answered: Int = 0,
    /** The leak, named. Never hidden beside the median it would otherwise flatter. */
    val unanswered: Int = 0,
    val median_seconds: Double? = null,
    val p90_seconds: Double? = null,
    val business_hours: ResponseTimeSide = ResponseTimeSide(),
    val after_hours: ResponseTimeSide = ResponseTimeSide(),
    /** NULL means the owner has not opted in — not that the crew answered nothing. */
    val by_member: List<ResponseTimeMember>? = null,
    /** #482: slowest line first. Empty for a one-number workspace. */
    val by_number: List<ResponseTimeNumber> = emptyList(),
    val per_member_enabled: Boolean = false,
    val baseline: ResponseTimeBaseline? = null,
    /** 'too_new' | 'no_answered_leads' | null — why there is no arc. */
    val baseline_unavailable: String? = null,
    val improved_by_seconds: Double? = null,
    val split_truncated: Boolean = false,
    val split_row_limit: Int = 0,
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
    /** #293: follow-up reminders that have come due. */
    val follow_ups: Int = 0,
    val distinct_work: Int = 0,
)

@Serializable
data class ForYou(
    /**
     * #293. Empty from an older Worker, which is "no reminders" — the state
     * every client written before this shipped was already rendering.
     */
    val follow_ups: List<ForYouFollowUp> = emptyList(),
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
        // #293: a due reminder is work. Leaving it out made the header say
        // "all caught up" while a section below listed a quote to chase — the
        // count lying in exactly the direction #293 is about. The Set keeps it
        // honest when the same thread is also unread.
        forYou.follow_ups.forEach { add(it.conversation_id) }
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
    /**
     * #244: this member's own do-not-disturb window, "22:00"/"07:00". Both or
     * neither — half a window is not a window. Null on every member who has
     * not set one.
     */
    val quiet_from: String? = null,
    val quiet_to: String? = null,
    /** Their own zone; null falls back to the workspace's. */
    val quiet_timezone: String? = null,
    /**
     * #297: category -> "immediate" | "batched" | "summary". An ABSENT key
     * means immediate, which is what every member receives today — so an empty
     * map and "never touched this" are the same state, deliberately.
     */
    val delivery: Map<String, String> = emptyMap(),
    /** How long a group waits. Null when nothing is grouped. */
    val batch_window_minutes: Int? = null,
    /** When the daily summary goes, in their own clock. Null = no summary. */
    val summary_at: String? = null,
)

/**
 * #354 — one period's pipeline, as GET /v1/reports/pipeline returns it.
 *
 * Every figure is computed server-side: a win rate computed twice is a win rate
 * that can disagree with itself, and this one is a claim about the customer's
 * own business.
 */
@Serializable
data class PipelineReport(
    val quoted: Int = 0,
    val won: Int = 0,
    val lost: Int = 0,
    /** Quoted, and neither won nor lost yet. The money still outstanding. */
    val open: Int = 0,
    val median_days_to_win: Double? = null,
)

/** Which tag each stage currently IS, so a rename never breaks a link. */
@Serializable
data class PipelineStageTag(
    val stage: String = "",
    val tag_id: String = "",
    val name: String = "",
)

@Serializable
data class PipelineReportResponse(
    val days: Int = 30,
    val current: PipelineReport = PipelineReport(),
    val previous: PipelineReport = PipelineReport(),
    val win_rate: Int? = null,
    val previous_win_rate: Int? = null,
    /** Null when there is not enough decided work to say anything honest. */
    val insight: String? = null,
    val stages: List<PipelineStageTag> = emptyList(),
)

// --- Referrals (#288/#399) ---

/**
 * #399 — this workspace's referral link, and what it has done.
 *
 * `link` is null when the server has no site origin configured; the code alone is
 * still usable, and a broken URL that looks authoritative is not.
 */
@Serializable
data class ReferralsView(
    val code: String = "",
    val link: String? = null,
    val referrals: List<ReferralRow> = emptyList(),
    val rewarded_this_year: Int = 0,
    val reward_cap_per_year: Int = 0,
)

@Serializable
data class ReferralRow(
    val id: String = "",
    val created_at: String = "",
    /** invited | signed_up | active | rewarded | voided, from the shared rule. */
    val stage: String = "invited",
)

/**
 * #288 — whether this crew has earned the ask.
 *
 * The DECISION is the server's, made once by `referralAskDecision` in
 * packages/shared, so the three clients cannot disagree about when an owner gets
 * asked for a favour. This carries the answer and the number the headline quotes.
 *
 * `ask` defaults to false, which is the safe direction for a payload this app
 * cannot parse: the cost of not asking is a month, and the cost of asking at the
 * wrong moment is the credibility #288 exists to protect.
 */
@Serializable
data class ReferralMoment(
    val ask: Boolean = false,
    /** Why not. For us, never shown to the owner. */
    val refusal: String? = null,
    val customers: Int = 0,
)
