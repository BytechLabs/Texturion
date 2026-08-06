package com.loonext.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * A task is metadata over a real message; `done`/`status` are DERIVED from the
 * source message's done_at. Toggling done is PATCH /v1/messages/{message_id},
 * never a task route.
 */
@Serializable
data class Task(
    val id: String,
    val company_id: String,
    val message_id: String,
    val conversation_id: String,
    val title: String,
    val description: String = "",
    val assigned_user_id: String? = null,
    val due_at: String? = null,
    val created_by_user_id: String,
    val created_at: String,
    val updated_at: String,
    /**
     * DERIVED fields: done-ness lives on the source message server-side, so
     * list/detail responses include these but MUTATION responses (POST/PATCH
     * /v1/tasks*) return the raw row WITHOUT them. Defaults keep a 2xx
     * mutation response decodable — requiring them made every successful
     * task mutation throw and surface a false "something went wrong". When
     * replacing UI state from a mutation response, preserve the previous
     * done/status rather than trusting these defaults.
     */
    val done: Boolean = false,
    val status: String = "open",
    /**
     * #237: whether this job texts its customer before it happens, and whether
     * they said they would be there.
     *
     * `confirmed_by` matters as much as `confirmed_at`: 'crew' is a note to
     * ourselves and 'customer' is a promise, and a screen showing them the same
     * way would let a dispatcher trust the weaker of the two. Defaulted, like
     * the derived fields above, so a mutation response without them decodes.
     */
    val reminders_off: Boolean = false,
    val confirmed_at: String? = null,
    val confirmed_by: String? = null,
    val contact: TaskContactLocation? = null,
    /** Present on checklist rows (GET /v1/conversations/:id/tasks). */
    val attachment_count: Int? = null,
    /**
     * #214 structured job address + provenance. All null for a task without an
     * address (and every pre-#214 row); `addr_provenance` is one of
     * message/contact/company/manual, or null. Returned by every task read
     * (TASK_COLUMNS) and echoed on create/update mutation rows.
     */
    val addr_street: String? = null,
    val addr_unit: String? = null,
    val addr_city: String? = null,
    val addr_state: String? = null,
    val addr_postal_code: String? = null,
    val addr_country: String? = null,
    val addr_provenance: String? = null,
    /**
     * #214/Map: the task's OWN geocoded coordinates (from its addr_* address,
     * cached by the geocode-tasks cron; projected by TASK_COLUMNS). Null until
     * geocoded or when the task has no address. The Map view prefers these over
     * the contact's saved location so a job pins at its SITE, not where the
     * customer lives — the founder-reported wrong-pin fix, web parity with
     * apps/web/src/components/tasks/views/map-types.ts.
     */
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class TaskContactLocation(
    val id: String,
    val name: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class TaskProfile(
    val user_id: String,
    val display_name: String? = null,
)

@Serializable
data class TaskSourceMessage(
    val id: String,
    val body: String,
    val done_at: String? = null,
    val done_by_user_id: String? = null,
    val created_at: String,
    val direction: String,
)

/**
 * Merged activity+discussion item: kind 'event' (task_* audit) or 'note'
 * (task-linked internal note). Modeled flat — the absent kind's fields null.
 */
@Serializable
data class TaskActivityItem(
    val kind: String,
    val id: String,
    val created_at: String,
    // kind = event
    val type: String? = null,
    val payload: JsonObject? = null,
    val actor_user_id: String? = null,
    val actor: TaskProfile? = null,
    // kind = note
    val body: String? = null,
    val author_user_id: String? = null,
    val author: TaskProfile? = null,
)

/** One item of the D28 derived attachments union (no URL — mint per item). */
@Serializable
data class TaskAttachmentItem(
    val id: String,
    val source: String,
    val kind: String,
    val file_name: String? = null,
    val content_type: String? = null,
    val size_bytes: Long? = null,
    val created_at: String,
)

/** GET /v1/tasks/:id. viewer_level 'none' withholds conversation content. */
@Serializable
data class TaskDetail(
    val id: String,
    val company_id: String,
    val message_id: String,
    val conversation_id: String,
    val title: String,
    val description: String = "",
    val assigned_user_id: String? = null,
    val due_at: String? = null,
    val created_by_user_id: String,
    val created_at: String,
    val updated_at: String,
    /**
     * DERIVED fields: done-ness lives on the source message server-side, so
     * list/detail responses include these but MUTATION responses (POST/PATCH
     * /v1/tasks*) return the raw row WITHOUT them. Defaults keep a 2xx
     * mutation response decodable — requiring them made every successful
     * task mutation throw and surface a false "something went wrong". When
     * replacing UI state from a mutation response, preserve the previous
     * done/status rather than trusting these defaults.
     */
    val done: Boolean = false,
    val status: String = "open",
    /**
     * #237: whether this job texts its customer before it happens, and whether
     * they said they would be there. Defaulted for the same reason the derived
     * fields above are — a mutation response omits them.
     */
    val reminders_off: Boolean = false,
    val confirmed_at: String? = null,
    val confirmed_by: String? = null,
    val assignee: TaskProfile? = null,
    val created_by: TaskProfile? = null,
    val source_message: TaskSourceMessage? = null,
    val attachments: List<TaskAttachmentItem> = emptyList(),
    val activity: List<TaskActivityItem> = emptyList(),
    val viewer_level: String = "text",
    /** #214 structured job address + provenance (see [Task]). */
    val addr_street: String? = null,
    val addr_unit: String? = null,
    val addr_city: String? = null,
    val addr_state: String? = null,
    val addr_postal_code: String? = null,
    val addr_country: String? = null,
    val addr_provenance: String? = null,
)

// ---------------------------------------------------------------------------
// #214 — AI task enrichment (a pure SUGGESTION the user reviews before saving)
// + the per-company opt-in. Mirrors apps/web/src/lib/api/types.ts.
// ---------------------------------------------------------------------------

/** Where a task's address came from — drives the provenance badge. */
object AddressProvenance {
    const val MESSAGE = "message"
    const val CONTACT = "contact"
    const val COMPANY = "company"
    const val MANUAL = "manual"
}

/**
 * #214 provenance badge copy — shown ONLY for AI sources (message/contact/
 * company). "manual" and null return null (no badge). Pure, unit-testable, and
 * shared by the make-task sheet and the task-detail address section.
 */
fun addressProvenanceLabel(provenance: String?): String? = when (provenance) {
    AddressProvenance.MESSAGE -> "From the message"
    AddressProvenance.CONTACT -> "From the contact"
    AddressProvenance.COMPANY -> "Inferred from area code"
    else -> null
}

/** #214 a structured task/job address (enrichment result + read-back). */
@Serializable
data class TaskAddress(
    val street: String? = null,
    val unit: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postal_code: String? = null,
    val country: String? = null,
)

/**
 * #214 the POST /v1/tasks/enrich result — a pure SUGGESTION. Any field may be
 * null (toggle off, nothing found, or a degraded/failed call, which resolves to
 * this all-null shape client-side). `enrichment_disabled` is true only when the
 * endpoint short-circuited because every toggle is off.
 */
@Serializable
data class TaskEnrichment(
    val address: TaskAddress? = null,
    /** The model's provenance; never "manual" (that's a user edit, client-side). */
    val address_provenance: String? = null,
    val due_at: String? = null,
    val enrichment_disabled: Boolean = false,
)

/**
 * #214 per-company enrichment opt-in (Settings → AI). Defaults ON to match the
 * server (GET /v1/company/ai-settings returns {true,true} when unset), so an
 * absent-field decode or a missing cache also resolves to ON.
 */
@Serializable
data class CompanyAiSettings(
    val enrich_task_address: Boolean = true,
    val enrich_task_due: Boolean = true,
    /** Offer AI-drafted replies in the composer. Never sent for you. */
    val suggest_replies: Boolean = true,
    /**
     * One sentence about what the business does, used to ground Lou's drafts.
     * Null means Lou has been told nothing and may not describe the business.
     */
    val business_description: String? = null,
    /**
     * Transcribe new voicemails. Off leaves the recording exactly as it was:
     * this only decides whether the words appear beside it.
     */
    val transcribe_voicemail: Boolean = true,
    /**
     * #367/D89: ask callers for the problem and the address in the voicemail
     * greeting, and break the transcript out into those fields.
     *
     * The one Lou setting that defaults to FALSE — every other one produces
     * something a member reads before a customer sees it, and this one changes
     * what a stranger hears when they ring, in the business's own name.
     */
    val voicemail_intake: Boolean = false,
    /**
     * #507: after a call ends, the crew member holds a button on their own
     * phone and says what was agreed; Lou writes their words down for them to
     * check and post as a note.
     *
     * Their own voice, about a call that has ENDED — never the call, never the
     * customer. D117 is why that line is the whole design and not a detail.
     */
    val call_wrapup: Boolean = true,
    /**
     * #247: whether a long or long-forgotten thread can be summarised on demand.
     *
     * The broadest disclosure of the five — a whole conversation leaves for
     * inference rather than one message, one field, or one recording — which is
     * why it is its own toggle rather than folded into drafting. A workspace
     * comfortable with Lou drafting a reply from the last twelve messages has
     * not thereby agreed to send forty.
     */
    val summarize_threads: Boolean = true,
)

/** Matches the column's CHECK constraint (migration 20260724120000). */
const val BUSINESS_DESCRIPTION_MAX = 280

/**
 * POST /v1/conversations/:id/reply-suggestions — up to three drafts the person
 * reads and edits. An empty list is the normal "nothing to offer" answer
 * (toggle off, nothing to reply to, over the monthly cap, model unavailable).
 */
@Serializable
data class ReplySuggestions(
    val suggestions: List<String> = emptyList(),
    val suggestions_disabled: Boolean = false,
    /**
     * Lou has not been told what this business does. The prompt refuses to say
     * anything about the trade without that line, so every draft is thinner
     * until someone writes it.
     */
    val business_unknown: Boolean = false,
    /** Why the list is empty; absent on success. See replyDraftMessage. */
    val reason: String? = null,
)

/**
 * Plain-language copy for an empty result. One blanket "nothing to suggest"
 * hid real breakage behind what looked like a shrug, so each reason says what
 * happened and whether trying again will help. Mirrors
 * suggestionFailureMessage in apps/web/src/lib/api/reply-suggestions.ts.
 */
fun replyDraftMessage(reason: String?): String = when (reason) {
    "disabled" -> "Drafting is turned off for this workspace. Settings, AI turns it back on."
    // #250: a thread somebody marked as spam never spends AI budget.
    "spam" -> "This thread is marked as spam, so Lou skips it. Unmark it to draft a reply."
    "nothing_to_reply" -> "Nothing to draft from yet. Type a few words and try again."
    "over_cap" -> "This month's drafting is used up. It starts again next month."
    "rate_limited" -> "That was a lot of drafts at once. Try again in a moment."
    "model_error", "unavailable" -> "Couldn't reach Lou just now. Try again."
    "unusable_output" -> "Nothing came back worth sending. Try again, or add a few words first."
    else -> "No drafts this time. Try again."
}

/**
 * #214 the confirmed (enriched or hand-entered) job address a create/update
 * body carries. Every field nullable — a partial address is legitimate;
 * `provenance` is the enrichment's own value for a confirmed suggestion, or
 * "manual" for a hand-typed/edited address.
 */
data class TaskAddressInput(
    val street: String? = null,
    val unit: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postal_code: String? = null,
    val country: String? = null,
    val provenance: String,
)
