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

/** #214 per-company enrichment opt-in (Settings → AI). Default OFF. */
@Serializable
data class CompanyAiSettings(
    val enrich_task_address: Boolean = false,
    val enrich_task_due: Boolean = false,
)

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
