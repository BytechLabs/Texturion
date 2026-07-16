package com.loonext.android.features.thread

import com.loonext.android.core.model.GalleryItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Pure gallery helpers (#165): the Images|Files split and the file labels. */
class GalleryLogicTest {

    private fun item(
        id: String,
        kind: String,
        source: String = "mms",
        fileName: String? = null,
        sizeBytes: Long? = null,
    ) = GalleryItem(
        id = id,
        source = source,
        kind = kind,
        file_name = fileName,
        content_type = null,
        size_bytes = sizeBytes,
        created_at = "2026-07-15T12:00:00Z",
        url = "https://signed.example/$id",
    )

    private val mixed = listOf(
        item("a", kind = "image"),
        item("b", kind = "file", source = "note", fileName = "quote.pdf"),
        item("c", kind = "image"),
        item("d", kind = "file", source = "task", fileName = "permit.docx"),
    )

    @Test
    fun `images view keeps only server-tagged images, in order`() {
        assertEquals(
            listOf("a", "c"),
            galleryItemsFor(GalleryView.Images, mixed).map { it.id },
        )
    }

    @Test
    fun `files view keeps everything that is not an image, in order`() {
        assertEquals(
            listOf("b", "d"),
            galleryItemsFor(GalleryView.Files, mixed).map { it.id },
        )
    }

    @Test
    fun `file name falls back honestly when the record has none`() {
        assertEquals("quote.pdf", galleryFileName(item("x", "file", fileName = "quote.pdf")))
        assertEquals(
            "Text-message attachment",
            galleryFileName(item("x", "file", source = "mms")),
        )
        assertEquals(
            "Attachment",
            galleryFileName(item("x", "file", source = "note", fileName = "  ")),
        )
    }

    @Test
    fun `size label covers bytes kilobytes megabytes and the unknown case`() {
        assertNull(gallerySizeLabel(null))
        assertEquals("312 B", gallerySizeLabel(312))
        assertEquals("48 KB", gallerySizeLabel(48 * 1024))
        assertEquals("2.4 MB", gallerySizeLabel((2.4 * 1024 * 1024).toLong()))
    }
}
