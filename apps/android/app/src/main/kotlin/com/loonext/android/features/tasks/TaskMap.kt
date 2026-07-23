package com.loonext.android.features.tasks

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.drawable.ShapeDrawable
import android.graphics.drawable.shapes.OvalShape
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.rememberShimmerBrush
import kotlin.math.abs
import org.osmdroid.config.Configuration
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.CopyrightOverlay
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker

/**
 * /tasks Map view (#184, web parity: apps/web/src/components/tasks/views/
 * map-view.tsx + map-island.tsx) — the field-service differentiator: the
 * day's jobs on a map.
 *
 * Renderer: osmdroid over standard OSM raster tiles, the SAME tile source the
 * web island uses (D25 "Map view technology": no Google/Mapbox, no key). OSM
 * tile-policy compliance lives here: the app identifies itself via
 * `Configuration.userAgentValue = packageName` before the first MapView
 * inflates, and a [CopyrightOverlay] draws the attribution on the canvas.
 * The raster look is intentionally the same in both themes (as on the web);
 * a color-filter inversion never looks clean without custom colors, so the
 * dark theme keeps the standard tiles.
 *
 * Data: GET /v1/tasks?has_location=true drained to the last page — every row
 * embeds the source contact's cached geocode as `contact`, and coordinates
 * are guarded exactly like the web's `taskCoords` (finite, |lat| ≤ 90,
 * |lng| ≤ 180) so a bad geocode never plots. Tasks at the same contact fuse
 * into ONE pin whose peek card lists them all; tasks the join filtered out
 * surface as the quiet "N without a location" count instead of blocking the
 * view. Cache-first per (companyId, assignee scope) — a revisit paints pins
 * in the first frame and only revalidates silently (#176).
 */
@Composable
fun TaskMapView(
    graph: AppGraph,
    companyId: String,
    assigneeUserId: String? = null,
    unassigned: Boolean = false,
    onOpenTask: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val mutations = remember(companyId) { TaskMutations(graph.api) }
    var refreshKey by remember(companyId) { mutableIntStateOf(0) }

    // Realtime: the same triggers as the list/board — any task change or done
    // flip revalidates the pin set quietly.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "task.changed" || event.event == "message.status") refreshKey++
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // #215: heal a task.changed/message.status frame missed while
    // backgrounded/blurred by revalidating on return to the foreground.
    ResyncOnResume(companyId) { refreshKey++ }

    val cacheKey = CacheKeys.tasks(companyId, taskMapFilterKey(assigneeUserId, unassigned))
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        drainLocatedTasks(mutations, companyId, assigneeUserId, unassigned)
    }

    when (val current = state) {
        is LoadState.Loading -> TaskMapSkeleton(modifier)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = modifier,
        )

        is LoadState.Ready -> TaskMapContent(
            rows = current.value,
            onOpenTask = onOpenTask,
            modifier = modifier,
        )
    }
}

/**
 * Stable filterKey for [CacheKeys.tasks], "map|" prefixed so the map's payload
 * shape (a drained located list) never shares an entry with the list/board
 * snapshots (the same guard [taskBoardFilterKey] applies for the board).
 */
internal fun taskMapFilterKey(assigneeUserId: String?, unassigned: Boolean): String =
    listOf(
        "map",
        // ASSIGNEE_ALL and null both mean "no assignee pin" on the wire — key
        // them identically so the sugar can never split the cache.
        assigneeUserId?.takeUnless { it == ASSIGNEE_ALL } ?: "-",
        if (unassigned) "unassigned" else "-",
    ).joinToString("|")

// Web-parity camera constants (map-island.tsx): continental-US fallback view,
// zoom 13 for a lone pin, zoom 12 when centering on "my location".
private const val FALLBACK_LAT = 39.5
private const val FALLBACK_LNG = -98.35
private const val FALLBACK_ZOOM = 4.0
private const val SINGLE_PIN_ZOOM = 13.0
private const val LOCATE_ZOOM = 12.0

/** One map pin: every located task at one contact, plotted once. */
internal data class TaskPinGroup(
    val key: String,
    val lat: Double,
    val lng: Double,
    val contactName: String?,
    val tasks: List<Task>,
)

/** The render model: fused pins plus the count the join left out. */
internal data class TaskMapModel(
    val groups: List<TaskPinGroup>,
    val located: Int,
    val missing: Int,
)

/**
 * The web's `taskCoords` guard, ported exactly: only finite, in-range
 * coordinates plot; everything else counts as "without a location".
 */
internal fun taskPinCoords(task: Task): Pair<Double, Double>? {
    val contact = task.contact ?: return null
    val lat = contact.lat ?: return null
    val lng = contact.lng ?: return null
    if (!lat.isFinite() || !lng.isFinite() || abs(lat) > 90.0 || abs(lng) > 180.0) return null
    return lat to lng
}

/** Partition rows into per-contact pin groups + the unlocated count. */
internal fun buildTaskMapModel(rows: List<Task>): TaskMapModel {
    data class Located(val task: Task, val lat: Double, val lng: Double)

    val located = rows.mapNotNull { task ->
        taskPinCoords(task)?.let { (lat, lng) -> Located(task, lat, lng) }
    }
    val groups = located
        .groupBy { it.task.contact?.id ?: "${it.lat},${it.lng}" }
        .map { (key, pins) ->
            val first = pins.first()
            TaskPinGroup(
                key = key,
                lat = first.lat,
                lng = first.lng,
                contactName = first.task.contact?.name?.ifBlank { null },
                tasks = pins.map { it.task },
            )
        }
    return TaskMapModel(groups, located.size, rows.size - located.size)
}

@Composable
private fun TaskMapContent(
    rows: List<Task>,
    onOpenTask: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val model = remember(rows) { buildTaskMapModel(rows) }

    var selectedKey by remember { mutableStateOf<String?>(null) }
    val selected = model.groups.firstOrNull { it.key == selectedKey }
    // Keep the last shown group so the card's exit animation has content.
    var lastSelected by remember { mutableStateOf<TaskPinGroup?>(null) }
    if (selected != null) lastSelected = selected

    // "My location": tick-stamped so each successful read recenters exactly
    // once, however many recompositions follow.
    var locate by remember { mutableStateOf<LocatePoint?>(null) }

    fun centerOnLastKnown() {
        // No fix available = quiet no-op; the button stays for a later try.
        val (lat, lng) = lastKnownLocation(context) ?: return
        locate = LocatePoint(lat, lng, (locate?.tick ?: 0) + 1)
    }

    // Prompted only on tap (D25), never a silent permission ambush; denial is
    // a snackbar-free no-op and the button remains available.
    val locationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) centerOnLastKnown()
    }

    Column(modifier.fillMaxSize()) {
        if (model.located > 0) {
            Row(
                Modifier.padding(start = 24.dp, end = 24.dp, bottom = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(
                    Icons.Outlined.Place,
                    contentDescription = null,
                    modifier = Modifier.size(13.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // The quiet count line, web copy grammar: "N on the map · N
                // without a location".
                Text(
                    buildString {
                        append("${model.located} on the map")
                        if (model.missing > 0) append(" · ${model.missing} without a location")
                    },
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(start = 18.dp, end = 18.dp, bottom = 18.dp)
                .clip(RoundedCornerShape(22.dp))
                .border(
                    1.dp,
                    MaterialTheme.colorScheme.outlineVariant,
                    RoundedCornerShape(22.dp),
                ),
        ) {
            OsmTaskMap(
                groups = model.groups,
                locate = locate,
                onPickGroup = { key ->
                    if (key != null) haptics.tap()
                    selectedKey = key
                },
                modifier = Modifier.fillMaxSize(),
            )

            if (model.groups.isEmpty()) {
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(horizontal = 32.dp),
                ) {
                    Column(
                        Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "No located tasks yet.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            if (model.missing > 0) "${model.missing} without a location"
                            else "Add an address to a contact and its tasks appear here.",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
                }
            }

            PaperCircleButton(
                icon = Icons.Outlined.MyLocation,
                contentDescription = "My location",
                onClick = {
                    haptics.tap()
                    val granted = context.checkSelfPermission(
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    ) == PackageManager.PERMISSION_GRANTED
                    if (granted) centerOnLastKnown()
                    else locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp),
            )

            // BoxScope under an outer ColumnScope: AnimatedVisibility must be
            // fully qualified or Kotlin resolves the ColumnScope overload.
            androidx.compose.animation.AnimatedVisibility(
                visible = selected != null,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = fadeIn() + slideInVertically { it / 2 },
                exit = fadeOut() + slideOutVertically { it / 2 },
            ) {
                lastSelected?.let { group ->
                    PinPeekCard(
                        group = group,
                        onOpenTask = onOpenTask,
                        onDismiss = { selectedKey = null },
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }
    }
}

/**
 * The marker peek card, in the paper grammar (r22 surface, hairline border):
 * one task shows title + contact + an Open action; a multi-task contact lists
 * its tasks, each row opening its own detail.
 */
@Composable
private fun PinPeekCard(
    group: TaskPinGroup,
    onOpenTask: (String) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = rememberHaptics()
    val single = group.tasks.singleOrNull()
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 2.dp,
        modifier = modifier.widthIn(min = 232.dp, max = 340.dp),
    ) {
        Column {
            Row(
                Modifier.padding(start = 15.dp, top = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        single?.title ?: (group.contactName ?: "This location"),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    val subline =
                        if (single != null) group.contactName
                        else "${group.tasks.size} tasks here"
                    if (subline != null) {
                        Text(
                            subline,
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
                IconButton(
                    onClick = {
                        haptics.tap()
                        onDismiss()
                    },
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        modifier = Modifier.size(15.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (single != null) {
                TextButton(
                    onClick = {
                        haptics.tap()
                        onOpenTask(single.id)
                    },
                    modifier = Modifier.padding(start = 7.dp, bottom = 4.dp),
                ) {
                    Text(
                        "Open task",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            } else {
                RowDivider(Modifier.padding(top = 10.dp))
                group.tasks.take(5).forEachIndexed { index, task ->
                    if (index > 0) RowDivider(Modifier.padding(horizontal = 15.dp))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                haptics.tap()
                                onOpenTask(task.id)
                            }
                            .padding(horizontal = 15.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            task.title,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textDecoration =
                                if (task.done) TextDecoration.LineThrough else null,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier
                                .weight(1f)
                                .alpha(if (task.done) 0.62f else 1f),
                        )
                    }
                }
                if (group.tasks.size > 5) {
                    Text(
                        "+${group.tasks.size - 5} more",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 15.dp, top = 2.dp, bottom = 10.dp),
                    )
                }
            }
        }
    }
}

/** First-fetch stand-in: the count line stub over a shimmering map card. */
@Composable
private fun TaskMapSkeleton(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        Box(
            Modifier
                .padding(start = 24.dp, bottom = 9.dp)
                .size(132.dp, 11.dp)
                .background(rememberShimmerBrush(), RoundedCornerShape(6.dp)),
        )
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(start = 18.dp, end = 18.dp, bottom = 18.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(rememberShimmerBrush()),
        )
    }
}

/** A tick-stamped "center here" request; each tick recenters exactly once. */
private data class LocatePoint(val lat: Double, val lng: Double, val tick: Int)

/**
 * The best available last-known fix across enabled providers, newest wins.
 * Per-provider try: with only COARSE granted some providers still throw, and
 * one refusal must not discard the rest.
 */
private fun lastKnownLocation(context: Context): Pair<Double, Double>? {
    val granted = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) return null
    val manager =
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    return manager.getProviders(true)
        .mapNotNull { provider ->
            runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
        }
        .maxByOrNull { it.time }
        ?.let { it.latitude to it.longitude }
}

/** One-time osmdroid process config, run before the first MapView inflates. */
private var osmConfigured = false

private fun ensureOsmConfiguration(context: Context) {
    if (osmConfigured) return
    osmConfigured = true
    val app = context.applicationContext
    Configuration.getInstance().apply {
        // App-private tile cache paths (the pre-scoped-storage defaults are
        // not writable on modern Android).
        load(app, app.getSharedPreferences("osmdroid", Context.MODE_PRIVATE))
        // REQUIRED by the OSM tile policy: identify the app on every tile
        // request. Set after load() so a stale stored value can't win.
        userAgentValue = app.packageName
    }
}

/** Mutable bridge state the AndroidView update pass diffs against. */
private class MapSyncState {
    var pinsKey: String? = null
    val markers = mutableListOf<Marker>()
    var locateTick = 0
    var myMarker: Marker? = null
}

/**
 * The osmdroid MapView inside Compose. Markers are Android-View-free: a tap
 * reports the group key upward and the peek card is a Compose overlay (no
 * osmdroid InfoWindow bubbles). Lifecycle onResume/onPause is forwarded from
 * the composition's lifecycle owner; the view detaches with the composable.
 */
@Composable
private fun OsmTaskMap(
    groups: List<TaskPinGroup>,
    locate: LocatePoint?,
    onPickGroup: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val pinColor = MaterialTheme.colorScheme.primary.toArgb()
    val dotColor = MaterialTheme.colorScheme.tertiary.toArgb()
    val pick = rememberUpdatedState(onPickGroup)
    val lifecycleOwner = LocalLifecycleOwner.current
    var mapRef by remember { mutableStateOf<MapView?>(null) }
    val sync = remember { MapSyncState() }

    // Forward the host lifecycle: osmdroid pauses tile loading and sensors on
    // onPause and resumes them on onResume.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapRef?.onResume()
                Lifecycle.Event.ON_PAUSE -> mapRef?.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapRef?.onDetach()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            ensureOsmConfiguration(context)
            MapView(context).apply {
                setTileSource(TileSourceFactory.MAPNIK)
                setMultiTouchControls(true)
                isTilesScaledToDpi = true
                // Pinch is the zoom affordance; the +/- buttons are not in the
                // paper grammar.
                zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
                // Explicit setter calls: the getters return primitive double
                // while the setters take boxed Double, so the Kotlin synthetic
                // property does not resolve.
                setMinZoomLevel(3.0)
                setMaxZoomLevel(19.0)
                // Added FIRST so markers (added later, drawn on top) win the
                // tap; a bare map tap dismisses the peek card.
                overlays.add(
                    MapEventsOverlay(object : MapEventsReceiver {
                        override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean {
                            pick.value(null)
                            return false
                        }

                        override fun longPressHelper(p: GeoPoint?): Boolean = false
                    }),
                )
                // REQUIRED by the OSM tile policy: on-canvas attribution.
                overlays.add(CopyrightOverlay(context))
                controller.setZoom(FALLBACK_ZOOM)
                controller.setCenter(GeoPoint(FALLBACK_LAT, FALLBACK_LNG))
                if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    onResume()
                }
                mapRef = this
            }
        },
        update = { map ->
            syncPins(map, sync, groups, pinColor, pick)
            syncLocate(map, sync, locate, dotColor)
        },
    )
}

/**
 * Diff-and-replace the pin markers, then fit the camera — but ONLY when the
 * pin set actually changed, so silent revalidates that return the same rows
 * never yank the camera away from where the user panned.
 */
private fun syncPins(
    map: MapView,
    sync: MapSyncState,
    groups: List<TaskPinGroup>,
    pinColor: Int,
    pick: State<(String?) -> Unit>,
) {
    val key = "$pinColor|" +
        groups.joinToString("|") { "${it.key}@${it.lat},${it.lng}#${it.tasks.size}" }
    if (key == sync.pinsKey) return
    sync.pinsKey = key

    sync.markers.forEach { map.overlays.remove(it) }
    sync.markers.clear()
    groups.forEach { group ->
        val marker = Marker(map).apply {
            position = GeoPoint(group.lat, group.lng)
            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            // The stock osmdroid teardrop tinted to the theme's primary role —
            // the flat-pin look of the web island, zero custom colors.
            ContextCompat.getDrawable(map.context, org.osmdroid.library.R.drawable.marker_default)
                ?.mutate()
                ?.also { drawable ->
                    drawable.setTint(pinColor)
                    setIcon(drawable)
                }
            // No Android-View bubble: the peek card is a Compose overlay.
            infoWindow = null
            relatedObject = group.key
            setOnMarkerClickListener { tapped, _ ->
                pick.value(tapped.relatedObject as? String)
                true
            }
        }
        map.overlays.add(marker)
        sync.markers.add(marker)
    }
    fitCamera(map, groups)
    map.invalidate()
}

/**
 * Initial/refresh camera: fit every pin with padding, a sane single-pin zoom,
 * and the continental-US fallback when nothing plots (web parity).
 */
private fun fitCamera(map: MapView, groups: List<TaskPinGroup>) {
    val points = groups.map { GeoPoint(it.lat, it.lng) }
    val applyCamera = {
        when {
            points.isEmpty() -> {
                map.controller.setZoom(FALLBACK_ZOOM)
                map.controller.setCenter(GeoPoint(FALLBACK_LAT, FALLBACK_LNG))
            }

            points.size == 1 -> {
                map.controller.setZoom(SINGLE_PIN_ZOOM)
                map.controller.setCenter(points.first())
            }

            else -> {
                val box = BoundingBox.fromGeoPoints(points)
                // A degenerate box (pins meters apart) would zoom to max;
                // treat it as a single point instead.
                if (box.latitudeSpan < 0.0005 && box.longitudeSpanWithDateLine < 0.0005) {
                    map.controller.setZoom(SINGLE_PIN_ZOOM)
                    map.controller.setCenter(box.centerWithDateLine)
                } else {
                    val padding = (40 * map.context.resources.displayMetrics.density).toInt()
                    map.zoomToBoundingBox(box, false, padding)
                }
            }
        }
    }
    // zoomToBoundingBox needs a measured view; before first layout, defer.
    if (map.width > 0 && map.height > 0) {
        applyCamera()
    } else {
        map.addOnFirstLayoutListener { _, _, _, _, _ -> applyCamera() }
    }
}

/**
 * Drop/refresh the "you are here" dot (a plain oval in the theme's tertiary
 * role, visually distinct from task pins) and animate the camera to it. The
 * tick guard makes each button tap recenter exactly once.
 */
private fun syncLocate(
    map: MapView,
    sync: MapSyncState,
    locate: LocatePoint?,
    dotColor: Int,
) {
    if (locate == null || locate.tick == sync.locateTick) return
    sync.locateTick = locate.tick

    sync.myMarker?.let { map.overlays.remove(it) }
    val density = map.context.resources.displayMetrics.density
    val dot = ShapeDrawable(OvalShape()).apply {
        intrinsicWidth = (14 * density).toInt()
        intrinsicHeight = (14 * density).toInt()
        paint.color = dotColor
    }
    val point = GeoPoint(locate.lat, locate.lng)
    val marker = Marker(map).apply {
        position = point
        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
        setIcon(dot)
        infoWindow = null
        setOnMarkerClickListener { _, _ -> true }
    }
    map.overlays.add(marker)
    sync.myMarker = marker
    map.controller.animateTo(point, LOCATE_ZOOM, null)
    map.invalidate()
}
