package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.OpenAlert
import com.loonext.android.core.oncall.OnCall

/**
 * #244 — the strip on a thread nobody has picked up.
 *
 * Design notes, and the principles behind them:
 *
 * - **The point is the NAME.** "When everyone is notified, no one is
 *   accountable." This turns "somebody should call these people" into "I have
 *   this", visible to everybody else who opens the thread.
 *   *Applying: Prioritize Intent — the core action first, and there is one.*
 * - **It shows on every route into the thread**, not just the notification's
 *   deep link: the person best placed to claim it is often not the one who was
 *   paged, because that person is asleep.
 * - **It disappears the moment it is claimed.** A banner that lingers after
 *   somebody took it teaches the crew to ignore banners.
 * - **No confirmation.** Taking responsibility for a callback is reversible by
 *   telling the crew. *Applying: Ethical Friction, on the irreversible edge
 *   only, and this edge is the opposite of that.*
 *
 * Mirrors the web and iOS banners; `OnCallCopyTest` keeps the words identical.
 */
@Composable
fun AlertBanner(
    alert: OpenAlert?,
    viewerId: String?,
    onClaim: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Absent on nearly every thread. Reserving space for it would be a
    // permanent cost paid for a rare event.
    if (alert == null) return

    // #228: read in composition — `buildString` below is not a composable
    // scope, so the sentence has to be resolved before it is appended.
    val waiting = t(OnCall.BANNER_WAITING_KEY)
    val claim = t(OnCall.BANNER_CLAIM_KEY)

    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.NotificationsActive,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSecondaryContainer,
        )
        Text(
            buildString {
                append(waiting)
                val paged = alert.on_call_name
                if (paged != null && alert.on_call_user_id != viewerId) {
                    append(" · ")
                    append(paged)
                    append(" was told first")
                }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
        )
        Button(onClick = { onClaim(alert.id) }) {
            Text(
                claim,
                style = MaterialTheme.typography.labelLarge.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
            )
        }
    }
}
