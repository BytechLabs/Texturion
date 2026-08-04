package com.loonext.android.features.attachments

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * #289 — "download photos on Wi-Fi only, at minimum".
 *
 * Hand-ported from packages/shared/src/metered-media.ts and covered by the same
 * vectors.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT AN ON/OFF SWITCH FOR PHOTOS.
 *
 * The obvious reading is "when this is on and I am on mobile data, do not
 * download photos". Building that would make the app look broken on a job site:
 * a thread of grey rectangles is not a thread, and a tech who turned the
 * setting on last month has no idea why today's photos will not load.
 *
 * #240 changed what the choice can be. A thread and a gallery now fetch a
 * bounded PREVIEW — a 1600px JPEG, 150-250 KB — and the ORIGINAL is fetched
 * only when somebody opens a photo full-size or downloads it. The setting
 * follows that line rather than cutting across it: the preview always loads, and
 * the original waits for a tap on metered data.
 */
object MeteredMedia {

    /** What the device says about the connection it is on. */
    enum class Connection { UNMETERED, METERED, UNKNOWN }

    /**
     * The system's own answer, which is the only one worth having.
     *
     * NOT_METERED covers Wi-Fi and ethernet AND a cellular plan the OS has been
     * told is unlimited, and it correctly reports a Wi-Fi hotspot the user
     * flagged as metered. Guessing from the transport type would get both of
     * those backwards.
     *
     * No capabilities means UNKNOWN, which reads as unmetered downstream: a
     * phone that cannot answer is usually one without the permission to answer,
     * and a photo that never loads with no explanation is the worse failure.
     */
    fun connection(context: Context): Connection {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return Connection.UNKNOWN
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
            ?: return Connection.UNKNOWN
        return if (
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        ) {
            Connection.UNMETERED
        } else {
            Connection.METERED
        }
    }

    /** May this fetch go ahead right now? */
    fun mayFetch(
        variant: String,
        connection: Connection,
        wifiOnlyOriginals: Boolean,
        requested: Boolean,
    ): Boolean {
        // The preview IS the thread. Always allowed, on any connection, with the
        // setting on or off.
        if (variant != "original") return true
        if (!wifiOnlyOriginals) return true
        if (connection != Connection.METERED) return true
        return requested
    }

    /**
     * The sentence shown in place of a full-size photo waiting for a tap.
     *
     * Says the CONDITION and the REMEDY in one line, because the alternative —
     * a spinner that never resolves, or a generic "couldn't load" — is how a
     * deliberate setting gets reported as a bug.
     */
    const val METERED_HINT = "You're on mobile data. Tap to load the full-size photo."

    const val SETTING_LABEL = "Full-size photos on Wi-Fi only"
    const val SETTING_DESCRIPTION =
        "Threads and galleries always load. Only full-size photos and downloads " +
            "wait for Wi-Fi — tap one to load it anyway."
}

/**
 * #289 — open a full-size attachment, unless this phone is on mobile data and
 * the person asked it not to.
 *
 * Returns false when it deferred, so a caller that has more to do after the
 * hand-off can stop. The snackbar's action re-runs the same open with the
 * request granted: a per-image escape rather than a per-session one, because
 * the point of the setting is that data is spent deliberately.
 *
 * Shared by every tap-through door — the thread, the file chip, the task
 * discussion — so a new one cannot quietly skip the check.
 */
suspend fun openOriginal(
    context: android.content.Context,
    wifiOnlyOriginals: Boolean,
    snackbar: androidx.compose.material3.SnackbarHostState,
    requested: Boolean = false,
    mint: suspend () -> String,
): Boolean {
    if (
        !MeteredMedia.mayFetch(
            variant = "original",
            connection = MeteredMedia.connection(context),
            wifiOnlyOriginals = wifiOnlyOriginals,
            requested = requested,
        )
    ) {
        val action = snackbar.showSnackbar(
            message = MeteredMedia.METERED_HINT,
            actionLabel = "Load",
            withDismissAction = true,
        )
        if (action != androidx.compose.material3.SnackbarResult.ActionPerformed) return false
        // Asked again with the request granted — and only for THIS photo.
        return openOriginal(context, wifiOnlyOriginals, snackbar, requested = true, mint = mint)
    }
    val url = mint()
    context.startActivity(
        android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)),
    )
    return true
}
