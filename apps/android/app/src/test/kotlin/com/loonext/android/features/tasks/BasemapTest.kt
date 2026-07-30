package com.loonext.android.features.tasks

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #428 — the tile source.
 *
 * The regex is a HAND PORT of the web twin's `isUnlicensedTileHost`, and the two
 * failure directions are not symmetric:
 *
 *   MISSING a match reintroduces the licensing violation silently, because a map
 *   that draws looks identical to a map that draws legally.
 *   OVER-matching blocks a provider we ARE licensed to use, which at least
 *   presents as a visibly missing basemap.
 *
 * Both are tested. Kotlin's Regex also treats escapes differently from JS in ways
 * that have bitten this codebase before, so the port is asserted rather than
 * assumed.
 */
class BasemapTest {
    @Test
    fun `refuses every subdomain form a tile template uses`() {
        for (url in listOf(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/1/2/3.png",
            "http://tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://TILE.OPENSTREETMAP.ORG/{z}/{x}/{y}.png",
        )) {
            assertTrue(url, Basemap.isUnlicensedTileHost(url))
        }
    }

    @Test
    fun `does not refuse a lookalike domain that merely contains the string`() {
        // Over-blocking is its own bug: a licensed provider whose hostname happens
        // to contain the phrase must still work.
        for (url in listOf(
            "https://tiles.example.com/tile.openstreetmap.org.png",
            "https://tile.openstreetmap.org.evil.example.com/{z}/{x}/{y}.png",
            "https://my-tile-openstreetmap-org.example.com/{z}/{x}/{y}.png",
        )) {
            assertFalse(url, Basemap.isUnlicensedTileHost(url))
        }
    }

    @Test
    fun `still permits a provider that serves OSM DATA under its own terms`() {
        // OSM data is fine and widely resold; it is OSM's donated tile SERVERS that
        // are not ours to use. Blocking the data would be the wrong lesson.
        assertFalse(
            Basemap.isUnlicensedTileHost(
                "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k",
            ),
        )
    }

    @Test
    fun `ships unconfigured, which is the compliant state`() {
        // The build defaults are empty on purpose. If this ever fails because
        // somebody filled them in, that is fine — but it must be a deliberate act
        // with a provider whose terms permit it, not a default nobody chose.
        assertFalse(Basemap.isConfigured())
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
