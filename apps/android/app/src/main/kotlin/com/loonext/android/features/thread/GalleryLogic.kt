package com.loonext.android.features.thread

import com.loonext.android.core.model.GalleryItem
import java.util.Locale

/**
 * The gallery's two views (web parity: an Images | Files toggle).
 *
 * #228: the enum carries the catalogue KEY rather than the English word, so the
 * toggle reads in the reader's language without this pure file having to know
 * what a locale is.
 */
enum class GalleryView(val labelKey: String) {
    Images("thread.galleryImages"),
    Files("thread.galleryFiles"),
}

/** Server-tagged kind — `kind` is authoritative ("image" vs "file"). */
fun isGalleryImage(item: GalleryItem): Boolean = item.kind == "image"

/** The rows one toggle position shows. */
fun galleryItemsFor(view: GalleryView, items: List<GalleryItem>): List<GalleryItem> =
    when (view) {
        GalleryView.Images -> items.filter { isGalleryImage(it) }
        GalleryView.Files -> items.filterNot { isGalleryImage(it) }
    }

/** A file row's display name — MMS attachments have no file_name on record. */
fun galleryFileName(item: GalleryItem): String =
    item.file_name?.takeIf { it.isNotBlank() }
        ?: when (item.source) {
            "mms" -> "Text-message attachment"
            else -> "Attachment"
        }

/** "312 B" / "48 KB" / "2.4 MB" — null when the size wasn't recorded. */
fun gallerySizeLabel(sizeBytes: Long?): String? {
    if (sizeBytes == null || sizeBytes < 0) return null
    return when {
        sizeBytes < 1024 -> "$sizeBytes B"
        sizeBytes < 1024 * 1024 -> "${(sizeBytes + 512) / 1024} KB"
        else -> {
            val mb = sizeBytes / (1024.0 * 1024.0)
            String.format(Locale.US, "%.1f MB", mb)
        }
    }
}
