package com.loonext.android.core.data

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Process-lifetime render cache (#176). One entry per screen-level query,
 * keyed by [CacheKeys]. Screens render whatever is here INSTANTLY and only
 * revalidate in the background, so the sole spinner the app can ever show is
 * the true first fetch of a key in this process. Keys embed the companyId, so
 * tenants can never read each other's entries; [clear] runs on sign-out so a
 * signed-out account's data does not outlive its session in memory.
 */
class StoreCache {
    private val entries = ConcurrentHashMap<String, MutableStateFlow<Any?>>()

    @Suppress("UNCHECKED_CAST")
    fun <T> flowOf(key: String): MutableStateFlow<T?> =
        entries.getOrPut(key) { MutableStateFlow(null) } as MutableStateFlow<T?>

    fun <T : Any> put(key: String, value: T) {
        flowOf<T>(key).value = value
    }

    fun clear() = entries.clear()
}

/**
 * Every cache key in one place so the shell warmer and the screens can never
 * drift apart. A key must include EVERY parameter that changes the response;
 * the zero-argument-beyond-companyId forms below are exactly what the warmer
 * prefetches at shell mount.
 */
object CacheKeys {
    fun forYou(companyId: String) = "forYou/$companyId"
    /** #342: spam marks that do not look like spam. */
    fun spamReview(companyId: String) = "spamReview/$companyId"
    fun recentCalls(companyId: String) = "recentCalls/$companyId"
    fun unreadNotifications(companyId: String) = "unreadNotifications/$companyId"
    fun inbox(companyId: String, filterKey: String = "default") = "inbox/$companyId/$filterKey"
    fun inboxMembers(companyId: String) = "inboxMembers/$companyId"
    fun inboxTags(companyId: String) = "inboxTags/$companyId"
    fun tasks(companyId: String, filterKey: String = "default") = "tasks/$companyId/$filterKey"
    fun contacts(companyId: String, query: String = "") = "contacts/$companyId/q=$query"
    fun contact(companyId: String, contactId: String) = "contact/$companyId/$contactId"
    fun contactCalls(companyId: String, contactId: String) = "contactCalls/$companyId/$contactId"
    /** #324: the merged conversations + calls + jobs history for one customer. */
    fun contactTimeline(companyId: String, contactId: String) = "contactTimeline/$companyId/$contactId"
    fun calls(companyId: String, filterKey: String = "default") = "calls/$companyId/$filterKey"
    fun voicemail(companyId: String) = "voicemail/$companyId"
    fun thread(companyId: String, conversationId: String) = "thread/$companyId/$conversationId"
    fun gallery(companyId: String, conversationId: String) = "gallery/$companyId/$conversationId"
    fun notifications(companyId: String) = "notifications/$companyId"
    fun task(companyId: String, taskId: String) = "task/$companyId/$taskId"
    fun settingsHome(companyId: String) = "settingsHome/$companyId"
    fun usage(companyId: String) = "usage/$companyId"
    /**
     * #239 response time, keyed by window. Keyed rather than shared so switching
     * 7/30/90 days cannot show the previous window's number under the new
     * label — a stale median beside a fresh window is a number the crew would
     * reasonably believe.
     */
    fun responseTime(companyId: String, days: Int) = "responseTime/$companyId/$days"
    /** #354: the pipeline report, keyed like its neighbour. */
    fun pipeline(companyId: String, days: Int) = "pipeline/$companyId/$days"
    fun team(companyId: String) = "team/$companyId"
    fun numbers(companyId: String) = "numbers/$companyId"
    fun billing(companyId: String) = "billing/$companyId"
    fun workspace(companyId: String) = "workspace/$companyId"
    fun calling(companyId: String) = "calling/$companyId"
    fun aiSettings(companyId: String) = "aiSettings/$companyId"

    /**
     * #236 signed-in devices. Keyed on the company only so the crew half can
     * share the entry; the self half is company-exempt server-side but the
     * two are fetched and painted together.
     */
    fun devices(companyId: String) = "devices/$companyId"

    /**
     * #314 two-factor state. Keyed on the USER, not the company: a factor
     * belongs to the person and follows them into every workspace.
     */
    fun mfa(userId: String) = "mfa/$userId"
}
