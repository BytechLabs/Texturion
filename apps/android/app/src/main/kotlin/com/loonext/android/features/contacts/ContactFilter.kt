package com.loonext.android.features.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.loonext.android.ui.common.ChoiceChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactFieldDef
import com.loonext.android.core.model.Tag
import com.loonext.android.ui.common.AppSheet

/**
 * #291 / #711 — narrow the contacts list to a tag, or to one answer in one of
 * the workspace's own fields, from the same Filter button the inbox and Tasks
 * use.
 *
 * Design notes, and the principles behind them:
 *
 * - **Behind the Filter button, not in rows of chips.** The inbox, Tasks and
 *   Contacts lists all answer "which ones am I looking at?" the same way: one
 *   Filter button, and the applied filters as removable chips only while any is
 *   on. *Applying: Zen of Clarity, and the Safety principle.*
 * - **Absent unless there is something worth filtering on.** Only a dropdown or
 *   a yes/no field has a closed set of answers; a serial number does not, and
 *   offering to filter by one would be a text box that returns nothing until it
 *   is typed perfectly — which is search, and search already reads it.
 *   *Applying: Zen of Clarity, and Prioritize Intent.*
 * - **One field at a time.** Two conditions combined is a report, and a report
 *   is a different screen with different expectations about accuracy.
 * - **The active filter is a chip you can see and clear.** A list quietly
 *   filtered is a list that looks wrong: somebody scrolls for a customer who is
 *   not missing, they are excluded. *Applying: the Safety principle — the state
 *   of the view is always legible.*
 * - **"Not set" is a choice**, and the most useful one: exactly the customers
 *   somebody still has to ask.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ContactFilterSheet(
    defs: List<ContactFieldDef>,
    tags: List<Tag>,
    active: Pair<String, String>?,
    onChange: (Pair<String, String>?) -> Unit,
    activeTag: String?,
    onTagChange: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    // Only the kinds with a closed set of answers.
    val filterable = filterableFields(defs)
    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                t("inbox.filterAction"),
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 21.sp),
                color = MaterialTheme.colorScheme.onBackground,
            )
            if (tags.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        t("settingsMore.tagsTitle"),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        tags.forEach { tag ->
                            ChoiceChip(
                                label = tag.name,
                                chosen = activeTag == tag.id,
                                onClick = {
                                    onTagChange(if (activeTag == tag.id) null else tag.id)
                                },
                            )
                        }
                    }
                }
            }
            filterable.forEach { field ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        field.label,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        // Empty is an ANSWER on a custom field, and the most useful
                        // filter of the lot: the customers still to ask.
                        ChoiceChip(
                            label = CONTACT_FILTER_ALL,
                            chosen = active?.first != field.key,
                            onClick = { onChange(null) },
                        )
                        val choices = listOf("") + answersFor(field)
                        choices.forEach { choice ->
                            val chosen = active?.first == field.key && active.second == choice
                            ChoiceChip(
                                label = answerLabel(choice),
                                chosen = chosen,
                                onClick = { onChange(if (chosen) null else field.key to choice) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The fields a customer list can be narrowed by: a dropdown or a yes/no. */
internal fun filterableFields(defs: List<ContactFieldDef>): List<ContactFieldDef> =
    defs.filter { it.kind == "select" || it.kind == "checkbox" }

/** What a field can be filtered to. A yes/no field has two, not its options. */
private fun answersFor(field: ContactFieldDef): List<String> =
    if (field.kind == "checkbox") listOf("yes", "no") else field.options.orEmpty()

/** "yes" and "no" are stored values; these are the words on screen. */
internal fun answerLabel(value: String): String = when (value) {
    "" -> CONTACT_FILTER_UNSET
    "yes" -> "Yes"
    "no" -> "No"
    else -> value
}

/** The applied field filter as a chip label: "Field: answer". */
internal fun fieldFilterChipLabel(defs: List<ContactFieldDef>, active: Pair<String, String>): String =
    "${defs.firstOrNull { it.key == active.first }?.label ?: active.first}: ${answerLabel(active.second)}"

/**
 * The words this surface owns, kept where the parity test can read them.
 *
 * The two CHIP labels are still spelled here: `contact-filter-parity.test.ts`
 * reads this file's bytes and asserts both of them against web's catalogue, and
 * that test lives in a tree this change may not touch. They move when all three
 * clients do.
 *
 * #228: the two EMPTY-STATE sentences are catalogue KEYS, not sentences. The
 * same parity test looks for the IDENTIFIER on the list screen rather than for
 * the words, so `ContactsTab` reaching them through `t()` keeps it honest —
 * what it is asking is whether the filtered-empty state exists at all.
 */
const val CONTACT_FILTER_ALL = "Everyone"
const val CONTACT_FILTER_UNSET = "Not set"
const val CONTACT_FILTER_EMPTY_TITLE = "contactsTasks.filterEmptyTitle"
const val CONTACT_FILTER_EMPTY_BODY = "contactsTasks.filterEmptyBody"
