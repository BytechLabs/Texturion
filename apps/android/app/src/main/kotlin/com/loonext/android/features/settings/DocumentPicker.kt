package com.loonext.android.features.settings

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The upload routes accept exactly these types, up to 10 MB each. */
private val ACCEPTED_MIME_TYPES = arrayOf("application/pdf", "image/png", "image/jpeg")

private const val MAX_DOCUMENT_BYTES = 10L * 1024 * 1024

/** Launches the system document picker for one multipart field at a time. */
class DocumentPickerState internal constructor(private val launch: (String) -> Unit) {
    /** Open the picker; the chosen file becomes the part named [fieldName]. */
    fun pick(fieldName: String) = launch(fieldName)
}

/**
 * A document picker for the LOA / carrier-invoice / bill upload routes:
 * PDF/PNG/JPEG only, 10 MB ceiling checked client-side (the server enforces
 * the same), bytes read off the main thread.
 */
@Composable
fun rememberDocumentPicker(
    onPicked: (DocumentUpload) -> Unit,
    onError: (String) -> Unit,
): DocumentPickerState {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingField by remember { mutableStateOf<String?>(null) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val field = pendingField
        pendingField = null
        if (field == null || uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val upload = withContext(Dispatchers.IO) { readDocument(context, uri, field) }
                if (upload == null) {
                    onError("Use a PDF, PNG, or JPEG up to 10 MB.")
                } else {
                    onPicked(upload)
                }
            } catch (_: Exception) {
                onError("Couldn't read that file. Try another one.")
            }
        }
    }

    return remember {
        DocumentPickerState { field ->
            pendingField = field
            launcher.launch(ACCEPTED_MIME_TYPES)
        }
    }
}

private fun readDocument(context: Context, uri: Uri, fieldName: String): DocumentUpload? {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: return null
    if (mime !in ACCEPTED_MIME_TYPES) return null

    var displayName: String? = null
    var size: Long? = null
    resolver.query(uri, null, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0) displayName = cursor.getString(nameIndex)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
        }
    }
    if ((size ?: 0L) > MAX_DOCUMENT_BYTES) return null

    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    if (bytes.size > MAX_DOCUMENT_BYTES) return null

    val fallbackExtension = when (mime) {
        "application/pdf" -> "pdf"
        "image/png" -> "png"
        else -> "jpg"
    }
    return DocumentUpload(
        fieldName = fieldName,
        fileName = displayName?.takeIf { it.isNotBlank() } ?: "$fieldName.$fallbackExtension",
        mimeType = mime,
        bytes = bytes,
    )
}
