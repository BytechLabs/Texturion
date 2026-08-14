package com.loonext.android.features.compose

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.OutboundMedia
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale
import com.loonext.android.core.jobs.PhotoMarkup

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
 *
 * #228: [locale] is the reader's language, carried in because a refusal built
 * on an IO dispatcher cannot ask composition for it. It defaults to English so
 * the existing callers and their tests are unchanged.
 */
suspend fun preparePhoto(
    context: Context,
    uri: Uri,
    locale: String? = null,
): PhotoPrepResult =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val raw = try {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        } ?: return@withContext PhotoPrepResult.Rejected(
            AppStrings.translate(locale, "thread.photoReadFailed"),
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
                AppStrings.translate(locale, "thread.imageCantBeSent"),
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
/**
 * The D19 note-attachment allow-list: images (never SVG), PDFs, plain text,
 * CSV, zip, and the Office/OpenDocument family. The server is the authority
 * (it sniffs the bytes), so this only stops a file the picker should never
 * have offered — an .exe, say — before it is staged, with the same sentence
 * the web composer uses. Mirrors isAllowedAttachmentType in
 * apps/web/src/lib/attachments/validate.ts.
 */
/**
 * #262: the image half is ENUMERATED, from the same list the API, the Storage
 * bucket and the other two clients use — `packages/shared/src/attachment-types.ts`.
 *
 * A `startsWith("image/")` rule admitted image/tiff, image/avif and image/bmp,
 * none of which the bucket accepts and none of which the byte sniffer has a
 * signature for. Web and the API were fixed for exactly that; this one still
 * staged them, so a tech picking a HEIC-adjacent format from a gallery got as
 * far as the upload and then a 422 with no idea why.
 */
val ALLOWED_IMAGE_TYPES = setOf(
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
)

fun isAllowedImageType(contentType: String): Boolean =
    contentType.trim().lowercase(Locale.US) in ALLOWED_IMAGE_TYPES

private val ALLOWED_NOTE_FILE_TYPES = setOf(
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
)

fun isAllowedNoteFileType(contentType: String): Boolean {
    val type = contentType.trim().lowercase(Locale.US)
    // SVG is denied by being absent from the enumeration above rather than by
    // its own line: an SVG is an active document, and so is whatever image
    // format arrives next with the same property.
    if (isAllowedImageType(type)) return true
    return type in ALLOWED_NOTE_FILE_TYPES
}

fun stageNoteFile(
    context: Context,
    uri: Uri,
    locale: String? = null,
): FileStageResult {
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
        AppStrings.translate(locale, "thread.fileReadFailedPick"),
    )
    val resolvedSize = size ?: return FileStageResult.Rejected(
        AppStrings.translate(locale, "thread.fileSizeReadFailed"),
    )
    // Only reject a type that is PRESENT and explicitly disallowed: the server
    // sniffs the bytes and is the authority, so an unknown type still goes.
    val declaredType = resolver.getType(uri).orEmpty()
    if (declaredType.isNotEmpty() && !isAllowedNoteFileType(declaredType)) {
        return FileStageResult.Rejected(
            AppStrings.translate(locale, "thread.fileTypeBlocked"),
        )
    }
    if (resolvedSize > MAX_NOTE_FILE_BYTES) {
        return FileStageResult.Rejected(
            AppStrings.translate(locale, "thread.fileSizeLimit"),
        )
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
/**
 * #294 — park marked-up bytes where the uploader already knows how to read them.
 *
 * The staged file is a Uri, not a buffer, so an edited photo needs somewhere to
 * live between the editor and the send. It goes in the app's own cache as a file://
 * Uri, which `readStagedFile` below opens exactly like any picked one — no second
 * read path, and nothing for the upload chain to learn.
 *
 * Cache rather than files: if the process dies before the note is sent, the draft is
 * gone anyway, and leaving a copy of a customer's kitchen in permanent storage to be
 * swept later is the opposite of what #330 just spent a day on.
 *
 * Returns null when the write fails, and the caller keeps the unmarked original —
 * losing the arrow is annoying, losing the photo is not acceptable.
 */
suspend fun stageMarkedUpPhoto(
    context: Context,
    original: StagedFile,
    bytes: ByteArray,
): StagedFile? = withContext(Dispatchers.IO) {
    try {
        val name = PhotoMarkup.markedUpFileName(original.name)
        val target = java.io.File(context.cacheDir, "markup-${'$'}{original.id}-${'$'}name")
        target.writeBytes(bytes)
        original.copy(
            uri = Uri.fromFile(target),
            name = name,
            contentType = "image/jpeg",
            sizeBytes = bytes.size.toLong(),
        )
    } catch (_: Exception) {
        null
    }
}

suspend fun readStagedFile(context: Context, file: StagedFile): ByteArray? =
    withContext(Dispatchers.IO) {
        try {
            context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
    }
