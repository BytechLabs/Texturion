package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.dashboard.DashboardPanels
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.AppSheet

/**
 * #540 — "What's on this screen", on the phone.
 *
 * ## Evaluation
 *
 * The dashboard was not customisable anywhere. An owner who never sells on
 * referrals reads past "Where customers came from" every morning, and a screen
 * nobody can adjust slowly becomes somebody else's screen.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — five switches ON the tab would be five controls competing
 * with the work. One quiet icon in the header opens this; the switches exist
 * nowhere else.
 *
 * *Direct manipulation* — no Save button, no spinner. The member is looking at
 * the screen they are changing, so the feedback is the screen changing behind
 * the sheet. A Save step would make a layout preference feel like a form, and
 * would let somebody dismiss the sheet and lose it.
 *
 * *The Safety Principle* — a sheet, like every other secondary surface on this
 * tab. The control sits beside the notification bell that was already there.
 *
 * ## What is deliberately NOT offered
 *
 * The queue. Not "Unassigned", not "Waiting on you", not "Chase these". Hiding
 * those is not a preference — it is a way to stop seeing customers nobody has
 * answered. The reasoning lives in `core/dashboard/DashboardPanels.kt`.
 *
 * Manual reordering either: the queue is ordered by what has actually gone wrong,
 * and a member-set order would put an overdue task below "Unread".
 *
 * Mirrors apps/web/src/components/for-you/customise-dashboard.tsx.
 *
 * *Applying: Zen of Clarity, the Safety Principle, and Chunking — two labelled
 * groups rather than one list of five.*
 */
@Composable
fun CustomiseSheet(
    hidden: List<String>,
    onToggle: (panel: DashboardPanels.Panel, visible: Boolean) -> Unit,
    onDismiss: () -> Unit,
    /** True after a save failed — the row has already moved back by then. */
    failed: Boolean = false,
) {
    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Text(
                t("inbox.customiseTitle"),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            // Says what is NOT on offer, once, here — rather than leaving somebody
            // hunting for a switch that does not exist.
            Text(
                t("inbox.customiseQueueStays"),
                modifier = Modifier.padding(top = 4.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            GroupHeading(t("inbox.customiseGroupMeasures"), top = 20.dp)
            DashboardPanels.Panel.entries
                .filter { it != DashboardPanels.Panel.RECENT_CALLS }
                .forEach { panel ->
                    PanelRow(panel, hidden, onToggle)
                }

            HorizontalDivider(Modifier.padding(top = 16.dp))
            GroupHeading(t("inbox.customiseGroupHistory"), top = 14.dp)
            PanelRow(DashboardPanels.Panel.RECENT_CALLS, hidden, onToggle)

            // One line, and only when a write actually failed. The toggle is
            // optimistic, so this has to say the row went BACK rather than that
            // something is still pending.
            if (failed) {
                Text(
                    t("inbox.customiseSaveFailed"),
                    modifier = Modifier.padding(top = 16.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun GroupHeading(text: String, top: androidx.compose.ui.unit.Dp) {
    Text(
        text.uppercase(),
        modifier = Modifier.padding(top = top),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun PanelRow(
    panel: DashboardPanels.Panel,
    hidden: List<String>,
    onToggle: (panel: DashboardPanels.Panel, visible: Boolean) -> Unit,
) {
    val visible = DashboardPanels.isVisible(hidden, panel)
    // Read here rather than inside `semantics { }`: that lambda is not
    // composition, so the catalogue cannot be reached from inside it.
    val switchState =
        if (visible) t("inbox.customiseStateOn") else t("inbox.customiseStatePutAway")
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                DashboardPanels.label(panel),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            // The reason it exists, under its name. Four headings alone do not
            // distinguish "Pipeline" from "Response time" for anybody who has not
            // already read both cards.
            Text(
                DashboardPanels.note(panel),
                modifier = Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = visible,
            onCheckedChange = { onToggle(panel, it) },
            // TalkBack announces the switch by the row it is in; the state has to
            // be said in the product's own words rather than as "on"/"off", which
            // does not say on WHAT.
            modifier = Modifier.semantics { stateDescription = switchState },
        )
    }
}
