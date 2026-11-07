package com.loonext.android.core.diag

import android.app.Application
import com.loonext.android.BuildConfig
import com.posthog.PersonProfiles
import com.posthog.PostHog
import com.posthog.PostHogEvent
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig

/**
 * Error tracking in PostHog (D146): uncaught JVM exceptions and the failures
 * the app catches and lives through ([captureNonFatal]) reach the same PostHog
 * project as the web app and the API. Crashes and ANRs also appear in Google
 * Play Console's Android vitals. Nothing else is sent: no screen views,
 * lifecycle events, deep links, push tokens, session replay or person
 * profiles (D8).
 *
 * The project key comes from the build (`-PloonextPostHogKey`), which only the
 * release workflow passes, so a local or rig build without it sends nothing.
 */
object Telemetry {
    private const val HOST = "https://us.i.posthog.com"

    private val PHONE = Regex("""\+?\d[\d\s().-]{6,}\d""")
    private val EMAIL = Regex("""[\w.+-]+@[\w-]+\.[\w.-]+""")

    // The API's public links carry their secret in the path, so cutting at the
    // query string leaves it intact; the Worker's scrubber names the same four.
    private val TOKEN_PATH = Regex("""(?<=/(?:photos|invite|pay|q)/)[^/?#\s]+""")
    private val URL_QUERY = Regex("""(https?://[^\s?#]*)[?#]\S*""")

    @Volatile
    private var started = false

    internal val isStarted: Boolean get() = started

    fun setup(app: Application) {
        val key = BuildConfig.POSTHOG_PROJECT_KEY
        if (key.isBlank()) return
        runCatching {
            val config = PostHogAndroidConfig(projectToken = key, host = HOST).apply {
                captureApplicationLifecycleEvents = false
                captureDeepLinks = false
                captureScreenViews = false
                capturePushNotificationSubscriptions = false
                capturePushNotificationOpened = false
                sessionReplay = false
                personProfiles = PersonProfiles.NEVER
                setDefaultPersonProperties = false
                preloadFeatureFlags = false
                sendFeatureFlagEvent = false
                errorTrackingConfig.autoCapture = true
                errorTrackingConfig.inAppIncludes.add("com.loonext.android")
                addBeforeSend { event -> scrubbed(event) }
            }
            PostHogAndroid.setup(app, config)
            PostHog.register("environment", BuildConfig.TELEMETRY_ENVIRONMENT)
            PostHog.register("source", "android")
            started = true
        }
    }

    /** A failure the app caught and lived through. Never throws. */
    fun captureNonFatal(tag: String, error: Throwable) {
        if (!started) return
        runCatching { PostHog.captureException(error, mapOf("tag" to tag)) }
    }

    /**
     * What error text carries: the query string and fragment of a URL, the
     * token in a public link's path, email addresses and phone-shaped digit
     * runs. Names are not found by pattern; app code never puts one in an error.
     */
    fun scrubText(raw: String): String {
        val noToken = TOKEN_PATH.replace(raw, "[token]")
        val noQuery = URL_QUERY.replace(noToken) { match -> match.groupValues[1] }
        return PHONE.replace(EMAIL.replace(noQuery, "[email redacted]"), "[phone redacted]")
    }

    /**
     * Every `$exception` leaves with its messages scrubbed. Stack frames name
     * classes and lines, never data, so they pass as they are.
     */
    internal fun scrubbed(event: PostHogEvent): PostHogEvent {
        if (!event.isExceptionEvent()) return event
        val properties = event.properties ?: return event
        val list = properties["\$exception_list"] as? List<*> ?: return event
        properties["\$exception_list"] = list.map { entry ->
            val exception = entry as? Map<*, *> ?: return@map entry
            exception.mapValues { (name, value) ->
                if (name == "value" && value is String) scrubText(value) else value
            }
        }
        return event
    }
}
