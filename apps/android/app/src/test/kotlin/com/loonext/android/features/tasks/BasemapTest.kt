package com.loonext.android.features.tasks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Map's tile source (#428, D160). */
class BasemapTest {
    @Test
    fun `ships OpenStreetMap's standard tiles with their credit, as the web does`() {
        val source = Basemap.tileSource()
        assertTrue(Basemap.isConfigured())
        assertEquals("© OpenStreetMap contributors", source?.copyrightNotice)
        assertTrue(source!!.baseUrl.startsWith("https://tile.openstreetmap.org/"))
    }

    @Test
    fun `refuses tiles over plain http`() {
        assertFalse(Basemap.isHttps("http://tile.openstreetmap.org/{z}/{x}/{y}.png"))
        assertTrue(Basemap.isHttps("https://tile.openstreetmap.org/{z}/{x}/{y}.png"))
        assertTrue(Basemap.isHttps("HTTPS://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k"))
    }

    @Test
    fun `the notice matches the web twin verbatim`() {
        // Same sentence on both clients: a crew member who sees it on the phone and
        // then on the laptop should not wonder whether they are two problems.
        assertTrue(Basemap.NO_BASEMAP_NOTICE.contains("Job pins are exact"))
        assertTrue(Basemap.NO_BASEMAP_NOTICE.contains("owner can do in one setting"))
        assertFalse(Basemap.NO_BASEMAP_NOTICE.contains("error"))
    }
}
