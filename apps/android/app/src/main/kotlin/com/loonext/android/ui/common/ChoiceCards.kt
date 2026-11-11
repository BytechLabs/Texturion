package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/** One option in [ChoiceCards]. [description] says what choosing it means. */
data class Choice<T>(
    val value: T,
    val label: String,
    val description: String? = null,
)

/**
 * #746: the one described choice, for a few options that each have a consequence
 * worth reading before choosing: who rings, what happens after hours, who may use
 * a number. A radio row for each option with its description under the label, in
 * one selectable group so a screen reader says "2 of 3". Three or four words with
 * no consequence are a [SegmentedControl]; a longer list is a [SelectField].
 *
 * Tapping the chosen option again does nothing. The web twin is
 * `apps/web/src/components/ui/choice-cards.tsx`; `ChoiceCardsGuardTest` fails on
 * a hand-built radio row elsewhere.
 */
@Composable
fun <T> ChoiceCards(
    choices: List<Choice<T>>,
    selected: T?,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(modifier.selectableGroup()) {
        choices.forEach { choice ->
            val chosen = choice.value == selected
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .selectable(
                        selected = chosen,
                        enabled = enabled,
                        role = Role.RadioButton,
                        onClick = { if (!chosen) onSelect(choice.value) },
                    )
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = chosen, onClick = null, enabled = enabled)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(choice.label, style = MaterialTheme.typography.bodyLarge)
                    if (choice.description != null) {
                        Text(
                            choice.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
