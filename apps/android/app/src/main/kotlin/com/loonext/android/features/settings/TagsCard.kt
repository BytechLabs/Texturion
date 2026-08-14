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
import androidx.compose.material3.OutlinedTextField
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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.TagUsage
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
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
    // #228: the list load runs in a LaunchedEffect, so its failure sentence is
    // composed where `t` cannot be called.
    val locale = LocalAppLocale.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<List<TagUsage>>>(LoadState.Loading) }
    var merging by remember { mutableStateOf<TagUsage?>(null) }

    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(repo.tagUsage(scope.companyId).data)
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (state is LoadState.Ready) scope.showMessage(cause.userMessage(locale))
            else state = LoadState.Failed(cause.userMessage(locale))
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
                    title = t("settingsMore.tagsTitle"),
                    description = t("settingsMore.tagsDesc"),
                ) {
                    rows.forEachIndexed { index, row ->
                        if (index > 0) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        TagUsageRow(
                            scope = scope,
                            repo = repo,
                            row = row,
                            canManage = canManage,
                            canMerge = canManage && rows.size > 1,
                            onMerge = { merging = row },
                            onChanged = { refreshKey++ },
                        )
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

/**
 * One tag: what it is called, what it means, and how much it is used.
 *
 * # Why the description is editable from HERE and nowhere else
 *
 * A description answers "does this mean the same thing as that one?", and this
 * list is the only screen where somebody asks that question. Putting the editor
 * behind a separate tag screen would mean the answer gets written somewhere
 * other than where it is needed.
 *
 * *Applying: Zen of Clarity — the editor is a pencil that opens on the row, not
 * a permanent field per tag; forty always-open inputs would bury the counts
 * that are the point of the list.*
 */
@Composable
private fun TagUsageRow(
    scope: SettingsScope,
    repo: MessagingRepository,
    row: TagUsage,
    canManage: Boolean,
    canMerge: Boolean,
    onMerge: () -> Unit,
    onChanged: () -> Unit,
) {
    var editing by remember(row.tag_id) { mutableStateOf(false) }
    var draft by remember(row.tag_id) { mutableStateOf(row.description.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // #228: the save failure is written from a coroutine, outside composition.
    val locale = LocalAppLocale.current
    val coroutines = rememberCoroutineScope()

    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.name,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
            Text(
                // Last used beside the count: a tag with forty uses and nothing
                // since March is a category the crew has stopped believing in,
                // and the count alone cannot say that.
                usesLabel(row.uses) + lastUsedSuffix(row.last_used),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (canManage) {
                Spacer(Modifier.width(4.dp))
                LinkButton(onClick = {
                    draft = row.description.orEmpty()
                    editing = !editing
                }) {
                    Text(
                        if (row.description.isNullOrBlank()) {
                            t("settingsMore.describe")
                        } else {
                            t("settingsMore.edit")
                        },
                    )
                }
            }
            if (canMerge) {
                Spacer(Modifier.width(4.dp))
                LinkButton(onClick = onMerge) { Text(t("settingsMore.merge")) }
            }
        }

        if (editing) {
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = draft,
                onValueChange = { if (it.length <= TAG_DESCRIPTION_MAX) draft = it },
                placeholder = { Text(t("settingsMore.tagDescribePlaceholder")) },
                singleLine = true,
                enabled = !saving,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                LinkButton(
                    enabled = !saving,
                    onClick = {
                        error = null
                        saving = true
                        coroutines.launch {
                            try {
                                repo.describeTag(scope.companyId, row.tag_id, draft.trim())
                                editing = false
                                onChanged()
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                saving = false
                            }
                        }
                    },
                ) { Text(if (saving) t("common.saving") else t("common.save")) }
                LinkButton(enabled = !saving, onClick = { editing = false }) {
                    Text(
                        t("common.cancel"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else if (!row.description.isNullOrBlank()) {
            Text(
                row.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        InlineError(error)
    }
}

/** Mirrors tags_description_len: a sentence, not a policy. */
private const val TAG_DESCRIPTION_MAX = 200

/** " · last 2d" when it has ever been used; nothing when it has not. */
@Composable
private fun lastUsedSuffix(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    val relative = relativeTime(iso)
    return if (relative.isEmpty()) "" else t("settingsMore.tagLastUsed", "ago" to relative)
}

/** "never used" reads as a verdict; "0 threads" reads as a loading state. */
@Composable
private fun usesLabel(uses: Long): String = when (uses) {
    0L -> t("settingsMore.tagNeverUsed")
    1L -> t("settingsMore.tagOneThread")
    else -> t("settingsMore.tagThreads", "count" to "$uses")
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
    val locale = LocalAppLocale.current

    AlertDialog(
        onDismissRequest = { if (!merging) onDismiss() },
        title = { Text(t("settingsMore.mergeTitle", "tag" to from.name)) },
        text = {
            Column {
                Text(
                    t("settingsMore.mergeBody", "tag" to from.name),
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
                        t(
                            "settingsMore.mergeDirection",
                            "uses" to usesLabel(from.uses)
                                .replaceFirstChar { it.uppercase() },
                            "target" to target.name,
                            "tag" to from.name,
                        ),
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
                            scope.showMessage(
                                AppStrings.translate(
                                    locale,
                                    "settingsMore.mergedInto",
                                    mapOf("target" to target.name),
                                ),
                            )
                            onMerged()
                        } catch (cause: Exception) {
                            error = cause.userMessage(locale)
                        } finally {
                            merging = false
                        }
                    }
                },
            ) {
                Text(if (merging) t("settingsMore.merging") else t("settingsMore.merge"))
            }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !merging) { Text(t("common.cancel")) }
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
    // #228: the save failure is written from a coroutine, outside composition.
    val locale = LocalAppLocale.current

    SettingsCard(
        title = t("settingsMore.tagLockTitle"),
        description = t("settingsMore.tagLockDesc"),
    ) {
        LabeledSwitchRow(
            label = t("settingsMore.tagLockLabel"),
            supporting = t("settingsMore.tagLockSupporting"),
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
                        error = cause.userMessage(locale)
                    } finally {
                        saving = false
                    }
                }
            },
        )
        if (company.tags_locked) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(t("settingsMore.tagLockedNote"))
        }
        InlineError(error)
    }
}
