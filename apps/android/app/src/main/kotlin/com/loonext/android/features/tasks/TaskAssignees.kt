package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.TaskProfile
import com.loonext.android.ui.common.boundedGlyph

/** #689 C: the server's cap on people per task. */
const val MAX_TASK_ASSIGNEES = 10

/** How many avatars a stack draws before the rest collapse into "+N". */
const val ASSIGNEE_STACK_VISIBLE = 3

/**
 * Everyone on a task, first assignee first. A payload that lacks `assignee_ids`
 * (an older server, a cached snapshot) falls back to the single
 * `assigned_user_id`; a payload that has the field is taken at its word.
 */
fun taskAssigneeIds(assigneeIds: List<String>, assignedUserId: String?): List<String> =
    assigneeIds.ifEmpty { listOfNotNull(assignedUserId) }

val Task.assigneeIdList: List<String>
    get() = taskAssigneeIds(assignee_ids, assigned_user_id)

val TaskDetail.assigneeIdList: List<String>
    get() = taskAssigneeIds(assignee_ids, assigned_user_id)

/** "Is it mine" is membership in the crew, never equality with the first assignee. */
fun taskAssignedTo(assigneeIds: List<String>, assignedUserId: String?, userId: String?): Boolean =
    userId != null && taskAssigneeIds(assigneeIds, assignedUserId).contains(userId)

/** A display name per assignee: the server's own name first, then the member list. */
fun taskAssigneeNames(
    ids: List<String>,
    profiles: List<TaskProfile>,
    memberName: (String?) -> String?,
): List<String?> = ids.map { id ->
    profiles.firstOrNull { it.user_id == id }?.display_name?.ifBlank { null } ?: memberName(id)
}

/**
 * Toggle [id] in an ordered crew. Adding past [max] returns null (the caller
 * says so out loud); removing always works.
 */
fun toggleAssignee(current: List<String>, id: String, max: Int = MAX_TASK_ASSIGNEES): List<String>? =
    when {
        id in current -> current - id
        current.size >= max -> null
        else -> current + id
    }

/**
 * The stacked assignee avatars (#689 C): up to [ASSIGNEE_STACK_VISIBLE] initials
 * badges overlapping, then "+N" for the rest. Draws nothing for an empty crew.
 * The badge is the shared [TaskAvatar], so the initials rule and the glyph bound
 * are not restated here; the "+N" disc sizes its text through the same bound.
 * The whole stack is one accessibility node: "Assigned to A, B and 2 more".
 */
@Composable
internal fun AssigneeStack(
    names: List<String?>,
    modifier: Modifier = Modifier,
    size: Dp = 28.dp,
    glyph: TextUnit = 9.5.sp,
) {
    if (names.isEmpty()) return
    val teammate = t("contactsTasks.teammate")
    val shown = names.take(ASSIGNEE_STACK_VISIBLE)
    val extra = names.size - shown.size
    val list = shown.joinToString(", ") { it ?: teammate }
    val description = when {
        extra <= 0 -> t("contactsTasks.assignedToStack", "names" to list)
        extra == 1 -> t("contactsTasks.assignedToStackMoreOne", "names" to list)
        else -> t(
            "contactsTasks.assignedToStackMoreMany",
            "names" to list,
            "count" to "$extra",
        )
    }
    val ring = MaterialTheme.colorScheme.surface
    Row(
        modifier.clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(-(size * 0.3f)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        shown.forEach { name ->
            TaskAvatar(
                name,
                size = size,
                fontSize = glyph,
                modifier = Modifier.border(1.5.dp, ring, CircleShape),
            )
        }
        if (extra > 0) {
            Box(
                Modifier
                    .size(size)
                    .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape)
                    .border(1.5.dp, ring, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                val rendered = boundedGlyph(size, glyph)
                Text(
                    t("contactsTasks.assigneesOverflow", "count" to "$extra"),
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontSize = rendered,
                        lineHeight = rendered * 1.25f,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    maxLines = 1,
                    softWrap = false,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
