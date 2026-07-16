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
    val done: Boolean,
    val status: String,
    val contact: TaskContactLocation? = null,
    /** Present on checklist rows (GET /v1/conversations/:id/tasks). */
    val attachment_count: Int? = null,
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
    val done: Boolean,
    val status: String,
    val assignee: TaskProfile? = null,
    val created_by: TaskProfile? = null,
    val source_message: TaskSourceMessage? = null,
    val attachments: List<TaskAttachmentItem> = emptyList(),
    val activity: List<TaskActivityItem> = emptyList(),
    val viewer_level: String = "text",
)
