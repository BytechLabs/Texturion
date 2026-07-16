package com.loonext.android.features.compose

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.loonext.android.core.model.OutboundMedia
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** SPEC §7 outbound MMS limits — validated here AND by the API. */
const val MAX_PHOTOS = 3
const val MAX_PHOTO_BYTES = 1024 * 1024
val ACCEPTED_PHOTO_TYPES = setOf("image/jpeg", "image/png", "image/gif")

/** D19 note-file limits (server: 10 files per owner, 25 MB each). */
const val MAX_NOTE_FILES = 10
const val MAX_NOTE_FILE_BYTES = 25L * 1024 * 1024

/** A photo staged on the composer: bytes ready for base64 inline send. */
data class StagedPhoto(
    val id: String,
    val uri: Uri,
    val contentType: String,
    val bytes: ByteArray,
) {
    fun toOutboundMedia() = OutboundMedia(
        content_type = contentType,
        base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
    )

    // Identity by staged id — ByteArray equality is referential otherwise.
    override fun equals(other: Any?): Boolean = other is StagedPhoto && other.id == id
    override fun hashCode(): Int = id.hashCode()
}

/** A note file staged for upload AFTER the note row exists (D28 chain). */
data class StagedFile(
    val id: String,
    val uri: Uri,
    val name: String,
    val contentType: String,
    val sizeBytes: Long,
)

sealed interface PhotoPrepResult {
    data class Ready(val photo: StagedPhoto) : PhotoPrepResult
    data class Rejected(val reason: String) : PhotoPrepResult
}

/**
 * Read + normalize one picked image for MMS: jpeg/png/gif ≤1 MB pass through
 * untouched (an animated GIF survives); anything else — HEIC, WebP, or an
 * oversized photo — is transcoded to JPEG under 1 MB with the platform codecs
 * (progressive downscale + quality steps).
 */
suspend fun preparePhoto(context: Context, uri: Uri): PhotoPrepResult =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val raw = try {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        } ?: return@withContext PhotoPrepResult.Rejected(
            "Couldn't read that photo. Try attaching it again.",
        )

        val declaredType = resolver.getType(uri)
        if (declaredType in ACCEPTED_PHOTO_TYPES && raw.size <= MAX_PHOTO_BYTES) {
            return@withContext PhotoPrepResult.Ready(
                StagedPhoto(
                    id = java.util.UUID.randomUUID().toString(),
                    uri = uri,
                    contentType = declaredType!!,
                    bytes = raw,
                ),
            )
        }

        val jpeg = transcodeToJpeg(raw)
            ?: return@withContext PhotoPrepResult.Rejected(
                "That image can't be sent. Try a different photo.",
            )
        PhotoPrepResult.Ready(
            StagedPhoto(
                id = java.util.UUID.randomUUID().toString(),
                uri = uri,
                contentType = "image/jpeg",
                bytes = jpeg,
            ),
        )
    }

/**
 * Decode, downscale to a sane texting size, and JPEG-compress under the 1 MB
 * wire cap. Returns null when the bytes aren't a decodable image.
 */
private fun transcodeToJpeg(raw: ByteArray): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    // Power-of-two subsample down toward ≤2048px on the long edge first — this
    // keeps peak memory flat for 100-megapixel camera originals.
    var sample = 1
    val longEdge = maxOf(bounds.outWidth, bounds.outHeight)
    while (longEdge / sample > 2048) sample *= 2

    var bitmap = BitmapFactory.decodeByteArray(
        raw,
        0,
        raw.size,
        BitmapFactory.Options().apply { inSampleSize = sample },
    ) ?: return null

    // Quality steps, then halve dimensions and try again — always terminates.
    repeat(4) {
        for (quality in intArrayOf(85, 70, 55, 40)) {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            val bytes = out.toByteArray()
            if (bytes.size <= MAX_PHOTO_BYTES) return bytes
        }
        val nextW = maxOf(1, bitmap.width / 2)
        val nextH = maxOf(1, bitmap.height / 2)
        if (nextW == bitmap.width && nextH == bitmap.height) return null
        bitmap = Bitmap.createScaledBitmap(bitmap, nextW, nextH, true)
    }
    return null
}

sealed interface FileStageResult {
    data class Ready(val file: StagedFile) : FileStageResult
    data class Rejected(val reason: String) : FileStageResult
}

/** Resolve name/size/type for a document-picker URI and enforce D19 limits. */
fun stageNoteFile(context: Context, uri: Uri): FileStageResult {
    val resolver = context.contentResolver
    var name: String? = null
    var size: Long? = null
    try {
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIdx >= 0) name = cursor.getString(nameIdx)
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
            }
        }
    } catch (_: Exception) {
        // Fall through to the honest rejection below.
    }
    val resolvedName = name ?: return FileStageResult.Rejected(
        "Couldn't read that file. Try picking it again.",
    )
    val resolvedSize = size ?: return FileStageResult.Rejected(
        "Couldn't read that file's size. Try picking it again.",
    )
    if (resolvedSize > MAX_NOTE_FILE_BYTES) {
        return FileStageResult.Rejected("Files can be up to 25 MB each.")
    }
    return FileStageResult.Ready(
        StagedFile(
            id = java.util.UUID.randomUUID().toString(),
            uri = uri,
            name = resolvedName,
            contentType = resolver.getType(uri) ?: "application/octet-stream",
            sizeBytes = resolvedSize,
        ),
    )
}

/** Read a staged file's bytes at upload time (permissions are still live). */
suspend fun readStagedFile(context: Context, file: StagedFile): ByteArray? =
    withContext(Dispatchers.IO) {
        try {
            context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
    }
