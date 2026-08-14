package com.loonext.android.features.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.ContactFieldDef

/**
 * #291 — narrow the contacts list to one answer in one of the workspace's own
 * fields.
 *
 * Design notes, and the principles behind them:
 *
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
 *
 * Chips rather than the web's two dropdowns: a phone has room for one row of
 * taps and not for two selects side by side, and the answer set is short.
 * `contact-filter-parity.test.ts` keeps the words the same.
 */
@Composable
fun ContactFilter(
    defs: List<ContactFieldDef>,
    active: Pair<String, String>?,
    onChange: (Pair<String, String>?) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Only the kinds with a closed set of answers.
    val filterable = defs.filter { it.kind == "select" || it.kind == "checkbox" }
    if (filterable.isEmpty()) return

    LazyRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            FilterChip(
                selected = active == null,
                onClick = { onChange(null) },
                label = { Text(CONTACT_FILTER_ALL) },
            )
        }
        items(filterable.size) { index ->
            val field = filterable[index]
            var open by remember(field.key) { mutableStateOf(false) }
            val selected = active?.first == field.key
            Row {
                FilterChip(
                    selected = selected,
                    onClick = { open = true },
                    label = {
                        Text(
                            if (selected) {
                                "${field.label}: ${answerLabel(active.second)}"
                            } else {
                                field.label
                            },
                        )
                    },
                )
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    // Empty is an ANSWER on a custom field, and the most useful
                    // filter of the lot: the customers still to ask.
                    DropdownMenuItem(
                        text = { Text(CONTACT_FILTER_UNSET) },
                        onClick = {
                            open = false
                            onChange(field.key to "")
                        },
                    )
                    for (choice in answersFor(field)) {
                        DropdownMenuItem(
                            text = { Text(answerLabel(choice)) },
                            onClick = {
                                open = false
                                onChange(field.key to choice)
                            },
                        )
                    }
                }
            }
        }
    }
}

/** What a field can be filtered to. A yes/no field has two, not its options. */
private fun answersFor(field: ContactFieldDef): List<String> =
    if (field.kind == "checkbox") listOf("yes", "no") else field.options.orEmpty()

/** "yes" and "no" are stored values; these are the words on screen. */
private fun answerLabel(value: String): String = when (value) {
    "" -> CONTACT_FILTER_UNSET
    "yes" -> "Yes"
    "no" -> "No"
    else -> value
}

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
