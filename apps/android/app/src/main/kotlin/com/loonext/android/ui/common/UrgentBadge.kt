package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

import com.loonext.android.core.model.URGENT_BADGE_LABEL

/**
 * #414: the one row state worth breaking the row's own visual rhythm for.
 *
 * A fourth quiet icon beside the attachment clip and the unread dot would blend
 * into that rhythm, which is the opposite of what this state needs — the whole
 * point is to be found at a glance, at 11pm, by someone a push notification just
 * woke.
 *
 * #565: moved out of the inbox, where it was private, because the thread header
 * needs the same mark. Somebody arriving from that notification lands on the
 * thread, and the thread was the one screen that did not say why. Two drawings of
 * one mark would be two things to keep in step — and this badge exists precisely
 * so the state is recognised without being read.
 */
@Composable
fun UrgentBadge(modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(
                MaterialTheme.colorScheme.errorContainer,
                RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .semantics { contentDescription = URGENT_BADGE_LABEL },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.WarningAmber,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.size(11.dp),
        )
        Spacer(Modifier.width(3.dp))
        Text(
            URGENT_BADGE_LABEL.uppercase(),
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.4.sp,
            ),
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}
