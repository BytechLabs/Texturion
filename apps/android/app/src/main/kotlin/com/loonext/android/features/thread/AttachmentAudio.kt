package com.loonext.android.features.thread

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.AttachmentSummary
import kotlinx.coroutines.delay

/**
 * A playable audio attachment in a thread bubble.
 *
 * Founder report (live device): a customer sent a voice message and there was
 * nowhere in the app to hear it — audio fell into the generic #189 file chip,
 * so listening meant handing the clip to another app and leaving the thread.
 * A voice message is a message; it belongs in the bubble like a photo does.
 *
 * Playback uses the platform `MediaPlayer` — no new dependency, and it decodes
 * every format carriers deliver (mp3/m4a/amr/wav/ogg/3gp). The signed URL is
 * minted per view and never cached, matching SignedAttachmentImage, and nothing
 * is fetched until someone presses play.
 */
@Composable
fun AttachmentAudio(
    attachment: AttachmentSummary,
    mintUrl: suspend (String) -> String,
    modifier: Modifier = Modifier,
) {
    var url by remember(attachment.id) { mutableStateOf<String?>(null) }
    var mintKey by remember(attachment.id) { mutableIntStateOf(0) }
    var failed by remember(attachment.id) { mutableStateOf(false) }
    var playing by remember(attachment.id) { mutableStateOf(false) }
    var progress by remember(attachment.id) { mutableFloatStateOf(0f) }
    val player = remember(attachment.id) { mutableStateOf<MediaPlayer?>(null) }

    LaunchedEffect(attachment.id, mintKey) {
        failed = false
        url = try {
            mintUrl(attachment.id)
        } catch (_: Exception) {
            failed = true
            null
        }
    }

    // One player per row, released with the row. Without this a scrolled-away
    // clip would keep playing and keep its decoder.
    DisposableEffect(attachment.id) {
        onDispose {
            player.value?.release()
            player.value = null
        }
    }

    // Advance the bar while playing. A quarter-second tick is smooth enough for
    // a short clip and costs nothing when paused (the effect does not run).
    LaunchedEffect(playing) {
        while (playing) {
            val active = player.value
            val duration = active?.duration ?: 0
            if (active != null && duration > 0) {
                progress = active.currentPosition.toFloat() / duration
            }
            delay(250)
        }
    }

    Row(
        modifier.padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = {
                if (failed) {
                    mintKey++
                    return@IconButton
                }
                val source = url ?: return@IconButton
                val existing = player.value
                if (existing != null) {
                    if (existing.isPlaying) {
                        existing.pause()
                        playing = false
                    } else {
                        existing.start()
                        playing = true
                    }
                    return@IconButton
                }
                val created = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    setOnCompletionListener {
                        playing = false
                        progress = 0f
                        seekTo(0)
                    }
                    setOnErrorListener { _, _, _ ->
                        failed = true
                        playing = false
                        true
                    }
                    setOnPreparedListener {
                        start()
                        playing = true
                    }
                }
                player.value = created
                try {
                    created.setDataSource(source)
                    created.prepareAsync()
                } catch (_: Exception) {
                    failed = true
                    created.release()
                    player.value = null
                }
            },
            modifier = Modifier.size(36.dp),
        ) {
            Icon(
                if (playing) Icons.Outlined.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (playing) {
                    t("thread.pauseAudio")
                } else {
                    t("thread.playAudio")
                },
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Spacer(Modifier.width(6.dp))
        Column(Modifier.width(170.dp)) {
            Text(
                audioRowCaption(failed, LocalAppLocale.current),
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { progress.coerceIn(0f, 1f) },
                modifier = Modifier
                    .height(3.dp)
                    .width(170.dp),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            )
            gallerySizeLabel(attachment.size_bytes)?.let { size ->
                Text(
                    size,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * The audio row's caption.
 *
 * #272: extracted so the failed wording is asserted rather than assumed, and so
 * it stays identical to the iOS twin — a voice message should read the same on
 * both phones. iOS had a comma where this had a middle dot, which is the sort of
 * drift nobody notices until a screenshot puts the two side by side.
 */
fun audioRowCaption(failed: Boolean, locale: String? = null): String =
    AppStrings.translate(
        locale,
        if (failed) "thread.audioUnavailable" else "thread.audioMessage",
    )
