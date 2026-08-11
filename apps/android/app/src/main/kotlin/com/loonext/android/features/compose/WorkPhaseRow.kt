package com.loonext.android.features.compose

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.jobs.WorkPhase

/**
 * #294 — before or after, on the note carrying the photos.
 *
 * ## Evaluation
 *
 * A tech attaching photos to a note has one more thing to say, and it is the one
 * classification the trade actually uses: is this how it looked when I arrived, or
 * how I left it. The whole value depends on it costing nothing — somebody standing in
 * a customer's kitchen with wet hands will not open a menu.
 *
 * ## What binds it
 *
 * *Prioritize Intent* — it appears only once there are photos. A before/after choice
 * on a text-only note is noise on the most common thing anybody does in this
 * composer.
 *
 * *Smart Defaults, and the one place that rule inverts* — nothing is preselected.
 * Everywhere else a sensible default saves a decision; here it would invent one. Most
 * notes are neither, so defaulting to Before would mislabel the majority, and a job
 * record that is confidently wrong is worse than one that says nothing.
 *
 * *Zen of Clarity* — two chips, not a three-option menu with "None". Tapping the
 * selected one clears it, so there is no third control for undo.
 *
 * *Relationship Strength* — directly under the file chips it describes, because it is
 * a property of those files rather than of the note's words.
 */
@Composable
fun WorkPhaseRow(
    value: String?,
    onChange: (String?) -> Unit,
) {
    // The `semantics` block below is not composition, so the language is read
    // here and the sentence built there.
    val locale = LocalAppLocale.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .semantics {
                contentDescription =
                    AppStrings.translate(locale, "thread.workPhaseAria")
            },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WorkPhase.ALL.forEach { phase ->
            val on = value == phase
            FilterChip(
                selected = on,
                // Tap the selected one to clear it: the honest answer for most
                // notes is neither, and it has to be reachable after a mis-tap.
                onClick = { onChange(if (on) null else phase) },
                label = { Text(WorkPhase.label(phase)) },
            )
        }
        Text(
            WorkPhase.HINT,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
