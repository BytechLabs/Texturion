package com.loonext.android.features.tasks

import com.loonext.android.BuildConfig
import com.loonext.android.core.i18n.AppStrings
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.XYTileSource

/**
 * #428 — where map tiles come from, and the one rule about it.
 *
 * THE VIOLATION THIS REPLACES. `TaskMap` called
 * `setTileSource(TileSourceFactory.MAPNIK)`, and MAPNIK is
 * `tile.openstreetmap.org` — the OpenStreetMap Foundation's own infrastructure,
 * run on donated resources. Their Tile Usage Policy exists for OSM's own use and
 * light third-party use, prohibits heavy use, and requires permission for
 * commercial applications. We are a paid product. The web client had the same
 * problem and this is its twin; iOS uses MapKit and never did.
 *
 * The failure mode made it worse: the OSMF blocks by user-agent, and a blocked map
 * simply stops drawing tiles. Markers still plot, nothing throws — the #387 shape,
 * arriving exactly when the feature is being used most.
 *
 * THE RULE: WE FAIL TOWARD NO BASEMAP, NEVER TOWARD SOMEBODY ELSE'S GOODWILL.
 * With no provider configured the map shows pins on an empty ground and the screen
 * says why. Quietly keeping MAPNIK as a fallback would mean the compliant path is
 * the one nobody is on, which is how this got here.
 */
object Basemap {
    /**
     * The configured tile source, or null when none is.
     *
     * Both the URL and the attribution are required together: a tile source with
     * no credit is the same licensing problem wearing a different provider's name,
     * so half-configured is treated as unconfigured.
     */
    fun tileSource(): OnlineTileSourceBase? {
        val url = BuildConfig.MAP_TILE_URL.trim()
        val attribution = BuildConfig.MAP_TILE_ATTRIBUTION.trim()
        if (url.isEmpty() || attribution.isEmpty()) return null
        // A provider we are NOT licensed to use cannot be configured back in by
        // accident. The violation has to be impossible to reintroduce quietly,
        // not merely removed once.
        if (isUnlicensedTileHost(url)) return null

        return XYTileSource(
            "loonext-basemap",
            MIN_ZOOM,
            MAX_ZOOM,
            TILE_SIZE,
            ".png",
            arrayOf(url),
            attribution,
        )
    }

    /** True when the map should render without a basemap layer. */
    fun isConfigured(): Boolean = tileSource() != null

    /**
     * Hosts we must not serve tiles from, whatever the config says. Not a general
     * blocklist — the specific mistake #428 documents, made unrepeatable. Mirrors
     * the web twin's `isUnlicensedTileHost`.
     */
    fun isUnlicensedTileHost(url: String): Boolean =
        Regex(
            """(^|//)([^/]*\.)?tile\.openstreetmap\.org(/|$)""",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(url)

    /**
     * What the map tells the crew when there is no basemap. Names the state and who
     * fixes it, and does not apologise for a bug — this is a configuration an owner
     * completes. Same sentence as the web twin.
     *
     * #228: the sentence itself is `contactsTasks.mapNoBasemap`, copied from web's
     * `misc.mapNoBasemap`. The ATTRIBUTION drawn beside it is never translated —
     * it is the provider's own required credit line, and a reworded credit is a
     * second licensing problem rather than a copy change.
     */
    const val NO_BASEMAP_NOTICE_KEY: String = "contactsTasks.mapNoBasemap"

    /**
     * The same sentence in English, for the parity guard on each side.
     *
     * Read straight off the catalogue rather than typed a second time, exactly as
     * the web twin's `NO_BASEMAP_NOTICE` is. Falling back to the KEY rather than to
     * a blank is what makes `BasemapTest` fail loudly if the entry ever goes.
     */
    val NO_BASEMAP_NOTICE: String = AppStrings.translate(null, NO_BASEMAP_NOTICE_KEY)

    private const val MIN_ZOOM = 3
    private const val MAX_ZOOM = 19
    private const val TILE_SIZE = 256
}
