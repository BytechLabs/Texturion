package com.loonext.android.features.thread

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Tag
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage

/**
 * In-thread tag add/remove (#165): every company tag with an attached
 * checkmark (tap toggles attach/detach), plus a create-on-attach field —
 * typing a name that already exists attaches the existing tag (matched
 * case-insensitively, like the server); a new name is created by the attach
 * itself (SPEC §7). Attached state renders from the conversation detail the
 * caller passes, so the sheet always agrees with the header row.
 */
@Composable
internal fun TagManageSheet(
    repo: MessagingRepository,
    companyId: String,
    attached: List<Tag>,
    /**
     * #298: whether this person may INVENT a tag here. False hides the Create
     * affordance rather than failing it — the server refuses either way
     * (api_find_or_create_tag holds the lock and the existence check in one
     * statement), and being told no after typing a name is exactly what sends
     * somebody to the notes field instead. Every existing tag stays one tap
     * away regardless.
     */
    mayCreate: Boolean = true,
    onAttach: (TagAttachPlan) -> Unit,
    onDetach: (Tag) -> Unit,
    onDismiss: () -> Unit,
) {
    var allTags by remember { mutableStateOf<LoadState<List<Tag>>>(LoadState.Loading) }
    var retryKey by remember { mutableIntStateOf(0) }
    var input by remember { mutableStateOf("") }

    // Keyed on [attached] too: a create-on-attach lands the new tag in the
    // conversation's rows first — refetching keeps the full list in step.
    LaunchedEffect(companyId, retryKey, attached) {
        allTags = try {
            LoadState.Ready(repo.tags(companyId).data)
        } catch (cause: Exception) {
            if (allTags !is LoadState.Ready) LoadState.Failed(cause.userMessage())
            else allTags // keep the loaded list on a quiet refresh failure
        }
    }

    val attachedIds = attached.mapTo(HashSet()) { it.id }
    val haptics = rememberHaptics()

    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so every tag row is reachable at
        // ANY viewport height (inert on tall screens).
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            Text(
                t("thread.tags"),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )

            when (val current = allTags) {
                // First-fetch shimmer in the sheet's own row grammar.
                is LoadState.Loading -> SkeletonList(rows = 4, avatar = false)

                is LoadState.Failed -> Column(Modifier.padding(horizontal = 20.dp)) {
                    Text(
                        current.message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(onClick = { retryKey++ }) { Text(t("common.retry")) }
                }

                is LoadState.Ready -> {
                    val plan = resolveTagInput(input, current.value)
                    // #298: the tag this typing probably means, if one already
                    // exists. The list below is an exact-name affair, which
                    // does not know that "quote-sent" and "Quote sent" are the
                    // same idea, or that "warrenty" is a typo. This does.
                    val suggestion = suggestExistingTag(input, current.value)
                    val creating = plan is TagAttachPlan.CreateNew
                    val blocked = creating && !mayCreate
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it.take(TAG_NAME_MAX) },
                            placeholder = {
                                Text(
                                    if (mayCreate) t("thread.addOrCreateTag")
                                    else t("thread.findTag"),
                                )
                            },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        TextButton(
                            enabled = plan != null && !blocked,
                            onClick = {
                                haptics.confirm()
                                plan?.let(onAttach)
                                input = ""
                            },
                        ) {
                            Text(if (creating) t("thread.create") else t("thread.add"))
                        }
                    }

                    // The existing tag comes FIRST, and it says why it is being
                    // offered. A prompt that just reorders the list teaches
                    // nothing; one that names the near-duplicate is how
                    // somebody stops making it.
                    if (suggestion != null && !suggestion.exact &&
                        suggestion.tag.id !in attachedIds
                    ) {
                        TextButton(
                            onClick = {
                                haptics.confirm()
                                onAttach(TagAttachPlan.Existing(suggestion.tag))
                                input = ""
                            },
                            modifier = Modifier.padding(horizontal = 12.dp),
                        ) {
                            Text(t("thread.didYouMean", "name" to suggestion.tag.name))
                        }
                    }

                    if (blocked) {
                        Text(
                            t("thread.tagsLocked"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                    }

                    if (current.value.isEmpty()) {
                        Text(
                            if (mayCreate) t("thread.noTagsCreate")
                            else t("thread.noTagsAdmin"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp),
                        )
                    }
                    current.value.forEach { tag ->
                        val isAttached = tag.id in attachedIds
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    haptics.tap()
                                    if (isAttached) onDetach(tag)
                                    else onAttach(TagAttachPlan.Existing(tag))
                                }
                                .padding(horizontal = 20.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(tag.name, style = MaterialTheme.typography.bodyLarge)
                                // #298: what it means, under what it is called.
                                // This is the moment somebody picks between two
                                // similar tags, and a description written
                                // anywhere else is one nobody reads.
                                if (!tag.description.isNullOrBlank()) {
                                    Text(
                                        tag.description,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            if (isAttached) {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = t("thread.attached"),
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
