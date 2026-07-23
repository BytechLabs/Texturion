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
    fun recentCalls(companyId: String) = "recentCalls/$companyId"
    fun unreadNotifications(companyId: String) = "unreadNotifications/$companyId"
    fun inbox(companyId: String, filterKey: String = "default") = "inbox/$companyId/$filterKey"
    fun inboxMembers(companyId: String) = "inboxMembers/$companyId"
    fun inboxTags(companyId: String) = "inboxTags/$companyId"
    fun tasks(companyId: String, filterKey: String = "default") = "tasks/$companyId/$filterKey"
    fun contacts(companyId: String, query: String = "") = "contacts/$companyId/q=$query"
    fun contact(companyId: String, contactId: String) = "contact/$companyId/$contactId"
    fun contactCalls(companyId: String, contactId: String) = "contactCalls/$companyId/$contactId"
    fun calls(companyId: String, filterKey: String = "default") = "calls/$companyId/$filterKey"
    fun voicemail(companyId: String) = "voicemail/$companyId"
    fun thread(companyId: String, conversationId: String) = "thread/$companyId/$conversationId"
    fun gallery(companyId: String, conversationId: String) = "gallery/$companyId/$conversationId"
    fun notifications(companyId: String) = "notifications/$companyId"
    fun task(companyId: String, taskId: String) = "task/$companyId/$taskId"
    fun settingsHome(companyId: String) = "settingsHome/$companyId"
    fun usage(companyId: String) = "usage/$companyId"
    fun team(companyId: String) = "team/$companyId"
    fun numbers(companyId: String) = "numbers/$companyId"
    fun billing(companyId: String) = "billing/$companyId"
    fun workspace(companyId: String) = "workspace/$companyId"
    fun calling(companyId: String) = "calling/$companyId"
}
