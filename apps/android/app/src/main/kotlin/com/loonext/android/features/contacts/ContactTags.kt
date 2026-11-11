package com.loonext.android.features.contacts

import com.loonext.android.ui.common.IconSize
import androidx.compose.foundation.layout.Arrangement
import com.loonext.android.ui.common.ConfirmDialog
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactTag
import com.loonext.android.core.model.MergedFrom
import com.loonext.android.core.model.Tag
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.spokenAs
import com.loonext.android.ui.common.timedText
import java.time.ZoneId
import java.time.format.FormatStyle
import java.util.Locale

/**
 * #695 - the tags a customer carries, on their page.
 *
 * The same workspace vocabulary the conversations use, so "Warranty" is one word
 * on a thread and on the person. Pick an existing tag, or type a new one: the
 * server reuses a tag of that spelling, refuses a new one when the workspace has
 * locked its list, and its message is shown as it is.
 *
 * Removing a chip is one tap and needs no confirmation: the control that undid
 * it is the one that did it (docs/UNDO-AUDIT.md, self-reversing).
 *
 * *Applying: Zen of Clarity - chips and one quiet add chip; the picker is a
 * dialog so the page stays sparse.*
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ContactTagsRow(
    tags: List<ContactTag>,
    available: List<Tag>,
    onAdd: (tagId: String?, name: String?) -> Unit,
    onRemove: (tagId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var picking by remember { mutableStateOf(false) }

    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text(
            t("contactsTasks.tagsHeading"),
            style = MaterialTheme.typography.labelLarge,
        )
        FlowRow(
            Modifier.padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (tag in tags) {
                InputChip(
                    selected = false,
                    onClick = { onRemove(tag.id) },
                    label = { Text(tag.name) },
                    trailingIcon = {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = t("contactsTasks.tagRemove", "name" to tag.name),
                            modifier = Modifier.size(IconSize.Default),
                        )
                    },
                )
            }
            AssistChip(
                onClick = { picking = true },
                label = { Text(t("contactsTasks.tagAdd")) },
                leadingIcon = {
                    Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(IconSize.Default))
                },
            )
        }
    }

    if (picking) {
        var typed by remember { mutableStateOf("") }
        val unattached = available.filter { tag -> tags.none { it.id == tag.id } }
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(t("contactsTasks.tagPickTitle")) },
            text = {
                Column {
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it.take(80) },
                        singleLine = true,
                        placeholder = { Text(t("contactsTasks.tagFindOrCreate")) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val shown = unattached.filter {
                        typed.isBlank() || it.name.contains(typed.trim(), ignoreCase = true)
                    }
                    for (tag in shown.take(8)) {
                        TextButton(
                            onClick = {
                                picking = false
                                onAdd(tag.id, null)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(tag.name, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = typed.isNotBlank(),
                    onClick = {
                        picking = false
                        onAdd(null, typed.trim())
                    },
                ) {
                    Text(t("contactsTasks.tagCreate"))
                }
            },
            dismissButton = {
                TextButton(onClick = { picking = false }) { Text(t("common.cancel")) }
            },
        )
    }
}

/**
 * #695 - "Merged from Jane Smith (Nov 2)", and the way back.
 *
 * Shown on the SURVIVING contact for the most recent record folded into it.
 * Unmerge is gated like merge (`settings.manage`): the line is information for
 * everybody, the action only for those who could have done the merge.
 *
 * The confirmation says what does NOT come back (the threads stay put, an
 * opt-out stays) before the button does anything.
 */
@Composable
fun MergedFromRow(
    mergedFrom: MergedFrom,
    canUnmerge: Boolean,
    onUnmerge: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = LocalAppLocale.current
    val haptics = rememberHaptics()
    var confirming by remember(mergedFrom.id) { mutableStateOf(false) }
    val name = describeContact(mergedFrom.name, mergedFrom.phone_e164)
    val line = timedText(locale) { time ->
        t("contactsTasks.mergedFromLine", "name" to name, "date" to time(mergedFrom.merged_at))
    }

    Row(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            line.visible,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f).spokenAs(line),
        )
        if (canUnmerge) {
            TextButton(onClick = { confirming = true }) {
                Text(t("contactsTasks.unmergeAction"))
            }
        }
    }

    if (confirming) {
        ConfirmDialog(
            title = t("contactsTasks.unmergeTitle", "name" to name),
            body = t("contactsTasks.unmergeBody", "name" to name),
            confirmLabel = t("contactsTasks.unmergeConfirm"),
            onConfirm = {
                haptics.confirm()
                confirming = false
                onUnmerge()
            },
            onDismiss = {
                confirming = false
            },
        )
    }
}
