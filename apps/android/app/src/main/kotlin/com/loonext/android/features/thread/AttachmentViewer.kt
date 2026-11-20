package com.loonext.android.features.thread

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.widget.MediaController
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material.icons.outlined.ZoomOut
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.loonext.android.core.i18n.t
import com.loonext.android.features.compose.MmsKind
import com.loonext.android.features.compose.mmsKindOf
import com.loonext.android.ui.common.IconSize
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL
import javax.net.ssl.HttpsURLConnection

private const val MAX_ZOOM = 4f
private const val ZOOM_STEP = 0.5f
private const val PHOTO_DECODE_EDGE = 4096

internal fun attachmentFileName(contentType: String): String {
    val extension = when (val mime = contentType.substringBefore(';').trim().lowercase()) {
        "text/vcard", "text/x-vcard" -> "vcf"
        "text/calendar" -> "ics"
        "audio/mp4" -> "m4a"
        "audio/3gpp", "video/3gpp" -> "3gp"
        else -> MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
    }
    return if (extension == null) "attachment" else "attachment.$extension"
}

@Composable
internal fun AttachmentViewer(
    label: String,
    contentType: String,
    fileName: String = attachmentFileName(contentType),
    preview: String? = null,
    mintOriginal: suspend () -> String,
    onClose: () -> Unit,
) {
    val video = mmsKindOf(contentType) == MmsKind.Video
    var attempt by remember { mutableIntStateOf(0) }
    var original by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }

    LaunchedEffect(attempt) {
        original = null
        failed = false
        try {
            original = mintOriginal()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    IconButton(onClick = onClose) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = t("common.close"),
                            modifier = Modifier.size(IconSize.Default),
                        )
                    }
                }
                Box(
                    Modifier.weight(1f).fillMaxWidth().background(MaterialTheme.colorScheme.background),
                    contentAlignment = Alignment.Center,
                ) {
                    val source = original
                    if (video && source != null && !failed) {
                        key(source, attempt) { AttachmentVideo(source) { failed = true } }
                    } else if (!video && (preview != null || (source != null && !failed))) {
                        ZoomableAttachmentPhoto(
                            label = label,
                            preview = preview,
                            original = source?.takeUnless { failed },
                            zoom = zoom,
                            onZoom = { zoom = it },
                            onError = { failed = true },
                        )
                    } else if (!failed) {
                        LoadingIndicator()
                    }
                    if (failed) {
                        Surface(
                            modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp),
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            TextButton(onClick = { attempt++ }) { Text(t("thread.mediaRetry")) }
                        }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!video) {
                        IconButton(enabled = zoom > 1f, onClick = { zoom = (zoom - ZOOM_STEP).coerceAtLeast(1f) }) {
                            Icon(
                                Icons.Outlined.ZoomOut,
                                contentDescription = t("thread.zoomOut"),
                                modifier = Modifier.size(IconSize.Default),
                            )
                        }
                        val reset = t("thread.resetZoom")
                        TextButton(
                            enabled = zoom > 1f,
                            onClick = { zoom = 1f },
                            modifier = Modifier.semantics { contentDescription = reset },
                        ) {
                            Text("${(zoom * 100).toInt()}%")
                        }
                        IconButton(
                            enabled = (preview != null || (original != null && !failed)) && zoom < MAX_ZOOM,
                            onClick = { zoom = (zoom + ZOOM_STEP).coerceAtMost(MAX_ZOOM) },
                        ) {
                            Icon(
                                Icons.Outlined.ZoomIn,
                                contentDescription = t("thread.zoomIn"),
                                modifier = Modifier.size(IconSize.Default),
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    AttachmentSaveButton(contentType, fileName, mintOriginal, withLabel = true)
                }
            }
        }
    }
}

@Composable
private fun ZoomableAttachmentPhoto(
    label: String,
    preview: String?,
    original: String?,
    zoom: Float,
    onZoom: (Float) -> Unit,
    onError: () -> Unit,
) {
    var pan by remember { mutableStateOf(Offset.Zero) }
    val context = LocalContext.current
    val zoomState by rememberUpdatedState(zoom)
    val request = remember(context, original) {
        original?.let { ImageRequest.Builder(context).data(it).size(PHOTO_DECODE_EDGE).build() }
    }
    var loaded by remember(original) { mutableStateOf(false) }

    Box(
        Modifier.fillMaxSize().clipToBounds().pointerInput(Unit) {
            detectTransformGestures { _, movement, scale, _ ->
                onZoom((zoomState * scale).coerceIn(1f, MAX_ZOOM))
                pan += movement
            }
        },
    ) {
        val imageModifier = Modifier.fillMaxSize().graphicsLayer {
            val limitX = size.width * (zoom - 1f) / 2
            val limitY = size.height * (zoom - 1f) / 2
            translationX = pan.x.coerceIn(-limitX, limitX)
            translationY = pan.y.coerceIn(-limitY, limitY)
            scaleX = zoom
            scaleY = zoom
        }
        if (!loaded && preview != null) {
            AsyncImage(preview, label, imageModifier, contentScale = ContentScale.Fit)
        }
        if (request != null) {
            AsyncImage(
                request,
                if (loaded || preview == null) label else null,
                imageModifier,
                contentScale = ContentScale.Fit,
                onSuccess = { loaded = true },
                onError = { onError() },
            )
        }
    }
    LaunchedEffect(zoom) { if (zoom == 1f) pan = Offset.Zero }
}

@Composable
private fun AttachmentVideo(source: String, onError: () -> Unit) {
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                val controls = MediaController(context)
                setMediaController(controls)
                setOnPreparedListener { controls.show(0) }
                setOnErrorListener { _, _, _ ->
                    onError()
                    true
                }
                setVideoURI(source.toUri())
            }
        },
        modifier = Modifier.fillMaxSize(),
        onRelease = { it.stopPlayback() },
    )
}

@Composable
internal fun AttachmentSaveButton(
    contentType: String,
    fileName: String = attachmentFileName(contentType),
    mintOriginal: suspend () -> String,
    withLabel: Boolean = false,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val launch = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(contentType.substringBefore(';').ifBlank { "application/octet-stream" }),
    ) { destination ->
        if (destination == null) return@rememberLauncherForActivityResult
        saving = true
        failed = false
        scope.launch {
            try {
                saveAttachment(context, mintOriginal(), destination)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                saving = false
            }
        }
    }
    val label = t(if (failed) "thread.mediaSaveFailed" else "thread.saveAttachment")
    val onSave: () -> Unit = {
        try {
            launch.launch(fileName)
        } catch (_: Exception) {
            failed = true
        }
    }
    if (withLabel || failed) {
        TextButton(onClick = onSave, enabled = !saving) {
            Text(if (saving) t("thread.savingAttachment") else label)
        }
    } else {
        IconButton(onClick = onSave, enabled = !saving) {
            Icon(Icons.Outlined.FileDownload, contentDescription = label, modifier = Modifier.size(IconSize.Large))
        }
    }
}

private suspend fun saveAttachment(context: Context, source: String, destination: Uri) =
    withContext(Dispatchers.IO) {
        val connection = URL(source).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.inputStream.use { input ->
                checkNotNull(context.contentResolver.openOutputStream(destination, "wt")).use { output ->
                    input.copyTo(output)
                }
            }
        } finally {
            connection.disconnect()
        }
    }
