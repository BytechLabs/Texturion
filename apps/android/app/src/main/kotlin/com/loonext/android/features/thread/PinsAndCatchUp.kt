package com.loonext.android.features.thread

import com.loonext.android.ui.common.IconSize
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.ui.common.AiOrb
import com.loonext.android.ui.common.AiOrbState
import com.loonext.android.ui.theme.BrandColor

/*
 * #716: pins as one collapsed row, and Lou's catch-up as one line above the
 * composer. Neither stacks chrome above the first message: the pins are one
 * row until opened, and the catch-up offer sits beside the input.
 */

private const val PINS_PREFS = "loonext.thread-pins-open"
private const val CATCH_UP_PREFS = "loonext.catch-up-answered"

/** Pins newest-pin-first, as the web stack lists them. */
internal fun pinsNewestFirst(messages: List<Message>): List<Message> =
    messages.filter { it.pinned_at != null }.sortedByDescending { it.pinned_at }

/** Whether this conversation was left with its pins open on this device. */
internal fun readPinsOpen(context: Context, conversationId: String): Boolean =
    context.getSharedPreferences(PINS_PREFS, Context.MODE_PRIVATE)
        .getBoolean(conversationId, false)

internal fun writePinsOpen(context: Context, conversationId: String, open: Boolean) {
    context.getSharedPreferences(PINS_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(conversationId, open)
        .apply()
}

/** The message the hint was last answered for, by Recap or Not now. */
internal fun readCatchUpAnswered(context: Context, conversationId: String): String? =
    context.getSharedPreferences(CATCH_UP_PREFS, Context.MODE_PRIVATE)
        .getString(conversationId, null)

internal fun writeCatchUpAnswered(context: Context, conversationId: String, messageId: String) {
    context.getSharedPreferences(CATCH_UP_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(conversationId, messageId)
        .apply()
}

private fun instantMs(iso: String): Long? =
    runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()

/**
 * The newest customer-visible message somebody else sent. The hint comes back
 * when this changes: the member's own reply is not news they need a recap of.
 */
internal fun newestNotMineId(messages: List<Message>, meUserId: String): String? =
    messages
        .filter {
            (it.direction == MessageDirection.INBOUND || it.direction == MessageDirection.OUTBOUND) &&
                it.sent_by_user_id != meUserId
        }
        .maxWithOrNull(
            compareBy<Message>({ instantMs(it.created_at) ?: Long.MIN_VALUE }, { it.id }),
        )
        ?.id

/**
 * Whether the one-line offer shows: the shared offer rule says so, nothing is
 * being asked or already answered on screen, and the newest message from
 * someone else is one the reader has not already waved the offer off for.
 */
internal fun catchUpHintShown(
    offered: Boolean,
    recapOpen: Boolean,
    newestNotMineId: String?,
    answeredId: String?,
): Boolean = offered && !recapOpen && newestNotMineId != null && answeredId != newestNotMineId

/**
 * Pins as a stack. One row shows the newest pin and how many more there are,
 * and opens the full list on demand; each conversation remembers whether it
 * was left open. A single pin is just that pin, one tap from the message.
 */
@Composable
internal fun PinnedStack(
    conversationId: String,
    pinned: List<Message>,
    onJump: (String) -> Unit,
) {
    val context = LocalContext.current
    var expanded by remember(conversationId) {
        mutableStateOf(readPinsOpen(context, conversationId))
    }
    val newest = pinned.firstOrNull() ?: return
    val older = pinned.size - 1
    val photo = t("thread.photo")
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh
                else BrandColor.Cream,
            ),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable {
                    if (older == 0) {
                        onJump(newest.id)
                    } else {
                        expanded = !expanded
                        writePinsOpen(context, conversationId, expanded)
                    }
                }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.PushPin,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(IconSize.Small),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                newest.body.ifBlank { photo },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (older > 0) {
                val moreLabel = t("thread.morePinnedAria", "count" to older.toString())
                Spacer(Modifier.width(8.dp))
                Text(
                    "+$older",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.semantics { contentDescription = moreLabel },
                )
                Icon(
                    if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    contentDescription = if (expanded) t("thread.collapse") else t("thread.expand"),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (older > 0 && expanded) {
            pinned.forEach { message ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onJump(message.id) }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        message.body.ifBlank { photo },
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        bubbleTime(message.created_at),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * Lou offering a catch-up, as one line above the composer. It asks for nothing
 * by itself: Recap is the press that spends a call, and Not now is never a
 * dead end, because the conversation menu keeps Catch me up.
 */
@Composable
internal fun CatchUpHint(
    onRecap: () -> Unit,
    onNotNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 3.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh
                else BrandColor.Cream,
            )
            .padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AiOrb(state = AiOrbState.Idle, size = 14.dp)
        Spacer(Modifier.width(8.dp))
        Text(
            t("thread.catchUpHint"),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onRecap) {
            Text(
                t("thread.catchUpRecap"),
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            )
        }
        TextButton(onClick = onNotNow) {
            Text(
                t("thread.notNow"),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
