package com.loonext.android.core.jobs

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #294 — the arithmetic behind an arrow and a circle, and that this phone draws the
 * same marks the laptop does.
 *
 * Three hand-written versions of the same trigonometry is three chances for one
 * client to point an arrowhead slightly the wrong way, on a photo a customer keeps.
 */
class PhotoMarkupTest {

    @Test
    fun `it is an arrow and a circle, and nothing else`() {
        assertEquals(listOf("arrow", "circle"), PhotoMarkup.TOOLS)
        assertEquals("Arrow", PhotoMarkup.label("arrow"))
        assertEquals("Circle", PhotoMarkup.label("circle"))
    }

    @Test
    fun `the stroke scales with the photo`() {
        assertTrue(PhotoMarkup.strokeWidth(4000, 3000) > PhotoMarkup.strokeWidth(800, 600))
    }

    @Test
    fun `the stroke never disappears and never covers what it points at`() {
        assertTrue(PhotoMarkup.strokeWidth(40, 30) >= 3)
        assertTrue(PhotoMarkup.strokeWidth(20000, 20000) <= 18)
    }

    @Test
    fun `the stroke measures the short edge, so a panorama is not a fence post`() {
        assertEquals(PhotoMarkup.strokeWidth(600, 600), PhotoMarkup.strokeWidth(8000, 600))
    }

    @Test
    fun `the stroke survives a size it cannot use`() {
        assertTrue(PhotoMarkup.strokeWidth(0, 0) >= 3)
        assertTrue(PhotoMarkup.strokeWidth(-100, -100) >= 3)
    }

    @Test
    fun `the arrowhead sits behind the tip, on the side the shaft came from`() {
        // Pointing right: both barbs must be LEFT of the tip, or the arrow points
        // backwards on a photo somebody keeps.
        val (a, b) = PhotoMarkup.arrowHead(
            MarkupPoint(0f, 0f),
            MarkupPoint(100f, 0f),
            4f,
        )
        assertTrue(a.x < 100f)
        assertTrue(b.x < 100f)
        assertEquals(-b.y, a.y, 0.001f)
    }

    @Test
    fun `the arrowhead turns with the shaft`() {
        val (a, b) = PhotoMarkup.arrowHead(MarkupPoint(0f, 0f), MarkupPoint(0f, 100f), 4f)
        assertTrue(a.y < 100f)
        assertTrue(b.y < 100f)
        assertEquals(-b.x, a.x, 0.001f)
    }

    @Test
    fun `a long drag does not grow a comical head`() {
        val (a, _) = PhotoMarkup.arrowHead(MarkupPoint(0f, 0f), MarkupPoint(4000f, 0f), 4f)
        assertTrue(4000f - a.x < 400f)
    }

    @Test
    fun `a zero-length drag draws nothing rather than NaN`() {
        val (a, b) = PhotoMarkup.arrowHead(MarkupPoint(50f, 50f), MarkupPoint(50f, 50f), 4f)
        assertEquals(MarkupPoint(50f, 50f), a)
        assertEquals(MarkupPoint(50f, 50f), b)
        assertTrue(!a.x.isNaN())
    }

    @Test
    fun `the circle is centred on the drag, whichever corner it started from`() {
        val forward = PhotoMarkup.circleFromDrag(MarkupPoint(10f, 20f), MarkupPoint(110f, 220f))
        val backward = PhotoMarkup.circleFromDrag(MarkupPoint(110f, 220f), MarkupPoint(10f, 20f))
        assertEquals(forward, backward)
        assertEquals(MarkupEllipse(60f, 120f, 50f, 100f), forward)
    }

    @Test
    fun `a tap is not a drag, so scrolling leaves no dot on a job record`() {
        assertTrue(
            !PhotoMarkup.isDeliberateDrag(
                MarkupPoint(10f, 10f),
                MarkupPoint(12f, 11f),
                1000,
                1000,
            ),
        )
    }

    @Test
    fun `a drag is judged against the photo, so the same flick means the same thing`() {
        val from = MarkupPoint(0f, 0f)
        val to = MarkupPoint(40f, 0f)
        assertTrue(PhotoMarkup.isDeliberateDrag(from, to, 600, 600))
        assertTrue(!PhotoMarkup.isDeliberateDrag(from, to, 4000, 4000))
    }

    @Test
    fun `the marked-up name says so, and always ends jpg`() {
        // Keeping .png on JPEG bytes would be a lie the type check downstream
        // catches, and the customer would see a rejected upload for no reason.
        assertEquals("boiler-marked.jpg", PhotoMarkup.markedUpFileName("boiler.jpg"))
        assertEquals("plate-marked.jpg", PhotoMarkup.markedUpFileName("plate.png"))
        assertEquals("photo-marked.jpg", PhotoMarkup.markedUpFileName(".jpg"))
        assertEquals("marked-up.jpg", PhotoMarkup.markedUpFileName("   "))
    }

    // ------------------------------------------------------- against the original

    /** The shared source, with carriage returns stripped — this tree is CRLF. */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText().filterNot { it == '\r' }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    @Test
    fun `the copy matches the shared module`() {
        val shared = repoFile("packages/shared/src/photo-markup.ts")
        for (label in listOf(
            PhotoMarkup.label("arrow"),
            PhotoMarkup.label("circle"),
            PhotoMarkup.HINT,
            PhotoMarkup.HINT_SECOND_TAP,
            PhotoMarkup.SAVE,
            PhotoMarkup.UNDO,
        )) {
            assertTrue("this copy has drifted: $label", shared.contains("\"$label\""))
        }
    }

    @Test
    fun `the ink and the halo match the shared module`() {
        // A mark drawn in a different red on one client is a mark a crew stops
        // trusting to mean the same thing.
        val shared = repoFile("packages/shared/src/photo-markup.ts")
        val ink = "#%06X".format(PhotoMarkup.INK and 0xFFFFFF)
        val halo = "#%06X".format(PhotoMarkup.HALO and 0xFFFFFF)
        assertTrue("the ink has drifted: $ink", shared.contains("\"$ink\""))
        assertTrue("the halo has drifted: $halo", shared.contains("\"$halo\""))
    }

    @Test
    fun `the shared module still knows only these two tools`() {
        val shared = repoFile("packages/shared/src/photo-markup.ts")
        val declared = Regex("""MARKUP_TOOLS = \[([^\]]*)\]""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("MARKUP_TOOLS has moved — point this test at it")
        val names = Regex("\"([a-z]+)\"").findAll(declared).map { it.groupValues[1] }.toList()
        assertEquals(PhotoMarkup.TOOLS, names)
    }
}
