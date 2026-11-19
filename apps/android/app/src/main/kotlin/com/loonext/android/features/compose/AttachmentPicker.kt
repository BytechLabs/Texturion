package com.loonext.android.features.compose

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.loonext.android.core.i18n.t
import java.io.File
import java.io.IOException

private const val CAPTURES_DIRECTORY = "camera-captures"
private const val CAPTURE_MAX_AGE_MS = 86_400_000L
private const val MAX_LIBRARY_SELECTION = 10

class CameraFileProvider : FileProvider()

internal class AttachmentPicker(
    val takePhoto: () -> Unit,
    val pickPhotos: () -> Unit,
    val pickFiles: () -> Unit,
)

@Composable
internal fun rememberAttachmentPicker(
    mimeTypes: Array<String>,
    onCameraError: () -> Unit,
    onPick: (List<Uri>) -> Unit,
): AttachmentPicker {
    val context = LocalContext.current
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }
    val pictures = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_LIBRARY_SELECTION),
        onResult = onPick,
    )
    val documents = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
        onResult = onPick,
    )
    val camera = rememberLauncherForActivityResult(TakePhoto()) { saved ->
        val photo = pendingPhoto?.let { File(capturesDirectory(context), it) }
        pendingPhoto = null
        if (photo != null) {
            if (saved && photo.length() > 0) {
                onPick(listOf(photoUri(context, photo)))
            } else {
                photo.delete()
                if (saved) onCameraError()
            }
        }
    }
    return AttachmentPicker(
        takePhoto = {
            if (pendingPhoto == null) {
                val directory = capturesDirectory(context)
                directory.mkdirs()
                val expiredAt = System.currentTimeMillis() - CAPTURE_MAX_AGE_MS
                directory.listFiles()?.filter { it.lastModified() < expiredAt }?.forEach { it.delete() }
                val photo = try {
                    File.createTempFile("photo-", ".jpg", directory)
                } catch (_: IOException) {
                    null
                }
                if (photo == null) {
                    onCameraError()
                } else {
                    pendingPhoto = photo.name
                    try {
                        camera.launch(photoUri(context, photo))
                    } catch (_: ActivityNotFoundException) {
                        photo.delete()
                        pendingPhoto = null
                        onCameraError()
                    }
                }
            }
        },
        pickPhotos = { pictures.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        pickFiles = { documents.launch(mimeTypes) },
    )
}

@Composable
internal fun AttachmentMenu(
    picker: AttachmentPicker,
    enabled: Boolean,
    expanded: Boolean,
    dismiss: () -> Unit,
    additionalActions: @Composable ColumnScope.() -> Unit = {},
) {
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss) {
        DropdownMenuItem(text = { Text(t("thread.takePhoto")) }, enabled = enabled, onClick = {
            dismiss()
            picker.takePhoto()
        })
        DropdownMenuItem(text = { Text(t("thread.photoLibrary")) }, enabled = enabled, onClick = {
            dismiss()
            picker.pickPhotos()
        })
        DropdownMenuItem(text = { Text(t("thread.attachFiles")) }, enabled = enabled, onClick = {
            dismiss()
            picker.pickFiles()
        })
        additionalActions()
    }
}

private class TakePhoto : ActivityResultContracts.TakePicture() {
    override fun createIntent(context: Context, input: Uri): Intent =
        super.createIntent(context, input).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
}

private fun capturesDirectory(context: Context): File = File(context.cacheDir, CAPTURES_DIRECTORY)

private fun photoUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.camera", file)
