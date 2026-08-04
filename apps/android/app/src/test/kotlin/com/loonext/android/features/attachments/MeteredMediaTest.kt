package com.loonext.android.features.attachments

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #289 — "download photos on Wi-Fi only, at minimum".
 *
 * Vectors shared with packages/shared/src/metered-media.test.ts and the Swift
 * port. The thing worth holding is the LINE the setting cuts along: #240 made a
 * thread fetch a 200 KB preview and a full-size view fetch the original, and
 * the setting follows that split rather than blocking photos outright. A phone
 * that got this wrong would show a wall of grey rectangles on a job site, which
 * is how a deliberate setting gets reported as a broken app.
 */
class MeteredMediaTest {

    private val all = listOf(
        MeteredMedia.Connection.UNMETERED,
        MeteredMedia.Connection.METERED,
        MeteredMedia.Connection.UNKNOWN,
    )

    @Test
    fun `the thread always reads`() {
        // The preview IS the thread. Blocking it would make the app look broken
        // to somebody who turned a setting on last month.
        for (connection in all) {
            for (wifiOnly in listOf(true, false)) {
                assertTrue(
                    "$connection/$wifiOnly",
                    MeteredMedia.mayFetch("preview", connection, wifiOnly, requested = false),
                )
            }
        }
    }

    @Test
    fun `the full-size photo loads normally when the setting is off`() {
        for (connection in all) {
            assertTrue(
                "$connection",
                MeteredMedia.mayFetch("original", connection, false, requested = false),
            )
        }
    }

    @Test
    fun `it waits on mobile data and loads on wifi`() {
        assertFalse(
            MeteredMedia.mayFetch(
                "original", MeteredMedia.Connection.METERED, true, requested = false,
            ),
        )
        assertTrue(
            MeteredMedia.mayFetch(
                "original", MeteredMedia.Connection.UNMETERED, true, requested = false,
            ),
        )
    }

    @Test
    fun `it loads the one the person tapped`() {
        // A per-image escape rather than a per-session one: the point of the
        // setting is that data is spent deliberately.
        assertTrue(
            MeteredMedia.mayFetch(
                "original", MeteredMedia.Connection.METERED, true, requested = true,
            ),
        )
    }

    @Test
    fun `a connection the OS will not describe reads as unmetered`() {
        // A phone that cannot answer is usually one without the permission to
        // answer, and a photo that never loads with no explanation is the worse
        // failure.
        assertTrue(
            MeteredMedia.mayFetch(
                "original", MeteredMedia.Connection.UNKNOWN, true, requested = false,
            ),
        )
    }

    @Test
    fun `the hint names the condition and the remedy`() {
        assertTrue(MeteredMedia.METERED_HINT.contains("mobile data"))
        assertTrue(MeteredMedia.METERED_HINT.lowercase().contains("tap"))
    }
}
