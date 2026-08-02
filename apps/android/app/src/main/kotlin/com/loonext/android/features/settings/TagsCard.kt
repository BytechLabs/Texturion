package com.loonext.android.features.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.TagUsage
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #298 — the tag list, with how much each one is actually used, and a way to
 * fold the duplicates together. Parity with the web's TagManagementCard.
 *
 * # Why usage is the headline and not the names
 *
 * "Cleanup is impossible without being able to see the problem." A list of
 * forty tag names tells an admin nothing — every one of them looked reasonable
 * to whoever made it. A list ordered by USE makes both problems visible at
 * once: the near-duplicates sit next to each other with wildly different
 * counts, and the dead ones are all at the bottom with zero.
 *
 * *Applying: Meaningful Highlights & Context — the count IS the insight here,
 * so it is the thing the eye lands on. Zen of Clarity — one row per tag, one
 * action, and the merge picker only appears once somebody asks for it.*
 */
@Composable
fun TagsCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val repo = remember(scope.graph) { MessagingRepository(scope.graph.api) }
    val canManage = MemberRole.has(scope.role, Capability.SETTINGS_MANAGE)
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<List<TagUsage>>>(LoadState.Loading) }
    var merging by remember { mutableStateOf<TagUsage?>(null) }

    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(repo.tagUsage(scope.companyId).data)
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (state is LoadState.Ready) scope.showMessage(cause.userMessage())
            else state = LoadState.Failed(cause.userMessage())
        }
    }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val rows = current.value
            if (rows.isNotEmpty()) {
                if (canManage) {
                    TagLockCard(scope, company, onCompanyUpdated)
                }
                SettingsCard(
                    title = "Tags",
                    description = "What the crew has been tagging, and how often. The " +
                        "quiet ones at the bottom are usually duplicates of something above.",
                ) {
                    rows.forEachIndexed { index, row ->
                        if (index > 0) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                row.name,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                usesLabel(row.uses),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (canManage && rows.size > 1) {
                                Spacer(Modifier.width(4.dp))
                                LinkButton(onClick = { merging = row }) { Text("Merge") }
                            }
                        }
                    }
                }
            }

            merging?.let { from ->
                MergeTagDialog(
                    scope = scope,
                    repo = repo,
                    from = from,
                    others = rows.filter { it.tag_id != from.tag_id },
                    onDismiss = { merging = null },
                    onMerged = {
                        merging = null
                        refreshKey++
                    },
                )
            }
        }
    }
}

/** "never used" reads as a verdict; "0 threads" reads as a loading state. */
private fun usesLabel(uses: Long): String = when (uses) {
    0L -> "never used"
    1L -> "1 thread"
    else -> "$uses threads"
}

/**
 * # Ethical Friction, and why merge earns it
 *
 * A merge rewrites how a workspace's history is categorised, and unlike a
 * rename it cannot be undone by typing the old name back. The dialog names the
 * direction in plain words and says what will happen to the threads, because
 * "merge A into B" is exactly the phrasing people get backwards.
 */
@Composable
private fun MergeTagDialog(
    scope: SettingsScope,
    repo: MessagingRepository,
    from: TagUsage,
    others: List<TagUsage>,
    onDismiss: () -> Unit,
    onMerged: () -> Unit,
) {
    var into by remember(from.tag_id) { mutableStateOf<TagUsage?>(null) }
    var merging by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    AlertDialog(
        onDismissRequest = { if (!merging) onDismiss() },
        title = { Text("Merge \"${from.name}\" into another tag") },
        text = {
            Column {
                Text(
                    "Every conversation tagged \"${from.name}\" keeps its place under " +
                        "the tag you pick, and this one goes away. Nothing is untagged.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                others.forEach { tag ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !merging) { into = tag }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = into?.tag_id == tag.tag_id,
                            onClick = { into = tag },
                            enabled = !merging,
                        )
                        Text(tag.name, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                into?.let { target ->
                    // Said back in the direction people get backwards. "Merge A
                    // into B" is ambiguous to almost everybody; a sentence
                    // naming what survives is not.
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "${usesLabel(from.uses).replaceFirstChar { it.uppercase() }} " +
                            "moves to \"${target.name}\". \"${from.name}\" stops existing.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                InlineError(error)
            }
        },
        confirmButton = {
            TextButton(
                enabled = into != null && !merging,
                onClick = {
                    val target = into ?: return@TextButton
                    haptics.confirm()
                    error = null
                    merging = true
                    coroutines.launch {
                        try {
                            repo.mergeTags(scope.companyId, from.tag_id, target.tag_id)
                            scope.showMessage("Merged into \"${target.name}\".")
                            onMerged()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            merging = false
                        }
                    }
                },
            ) {
                Text(if (merging) "Merging…" else "Merge")
            }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !merging) { Text("Cancel") }
        },
    )
}

/**
 * #298 acceptance 4 — restricting who may INVENT a tag. Off by default.
 *
 * # Why this exists at all, given the issue argues against taxonomies
 *
 * #298's own devil's advocate: "the temptation is to impose a taxonomy. That is
 * the wrong move for this market — a plumber's categories are not an HVAC
 * company's, and a locked-down tag list would be ignored in favour of the notes
 * field." That argument is against US imposing one. A crew that has BUILT a
 * vocabulary and wants it held still is the opposite case, and this is the only
 * thing here they cannot do without us.
 *
 * It restricts creation, never attachment: a tech who cannot categorise a
 * thread does not categorise it in the notes instead, they leave it
 * uncategorised, and the workspace loses the data it turned this on to protect.
 */
@Composable
private fun TagLockCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "Who can create tags",
        description = "Anyone on the crew can add a tag by default. Lock it once " +
            "your list is the list.",
    ) {
        LabeledSwitchRow(
            label = "Only owners and admins can create tags",
            supporting = "Everyone can still use every tag you already have. This only " +
                "stops new ones being invented mid-job.",
            checked = company.tags_locked,
            enabled = !saving,
            onCheckedChange = { next ->
                error = null
                saving = true
                coroutines.launch {
                    try {
                        val body = buildJsonObject { put("tags_locked", next) }
                        onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
        )
        if (company.tags_locked) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(
                "A tech who needs a category you do not have will leave the thread " +
                    "untagged rather than ask. Check the list below now and then.",
            )
        }
        InlineError(error)
    }
}
