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
                "Tags",
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
                    TextButton(onClick = { retryKey++ }) { Text("Try again") }
                }

                is LoadState.Ready -> {
                    val plan = resolveTagInput(input, current.value)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it.take(TAG_NAME_MAX) },
                            placeholder = { Text("Add or create a tag") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        TextButton(
                            enabled = plan != null,
                            onClick = {
                                haptics.confirm()
                                plan?.let(onAttach)
                                input = ""
                            },
                        ) {
                            Text(
                                when (plan) {
                                    is TagAttachPlan.CreateNew -> "Create"
                                    else -> "Add"
                                },
                            )
                        }
                    }

                    if (current.value.isEmpty()) {
                        Text(
                            "No tags yet. Create the first one above.",
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
                            Text(
                                tag.name,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.weight(1f),
                            )
                            if (isAttached) {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = "Attached",
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
