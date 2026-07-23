package com.loonext.android.features.shell

import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.fetchCallsLog
import com.loonext.android.features.contacts.ContactsSnapshot
import com.loonext.android.features.inbox.fetchInboxDefault
import com.loonext.android.features.settings.SettingsRepository
import com.loonext.android.features.tasks.TaskMutations
import com.loonext.android.features.tasks.TasksTabKind
import com.loonext.android.features.tasks.fetchTaskListSnapshot
import com.loonext.android.features.tasks.taskListArms
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * #176: primes every tab's DEFAULT query at shell mount so even the first
 * tap on a tab paints instantly. Each fetch replays exactly what that
 * screen's cache-first path stores for its default key (the screens own the
 * key + value contracts; this file must follow them, never the reverse).
 * Cold-cache only, every miss is silent, and the screen's own revalidation
 * still runs on first compose, so a warmer bug can at worst waste a request.
 */
suspend fun warmStoreCache(graph: AppGraph, companyId: String) = coroutineScope {
    val cache = graph.storeCache
    fun warm(key: String, fetch: suspend () -> Any) {
        if (cache.flowOf<Any>(key).value != null) return
        launch {
            runCatching { cache.put(key, fetch()) }
        }
    }
    warm(CacheKeys.forYou(companyId)) { graph.forYouRepo.forYou(companyId) }
    warm(CacheKeys.recentCalls(companyId)) {
        CallsRepository(graph.api).calls(companyId, limit = 3).data
    }
    warm(CacheKeys.unreadNotifications(companyId)) {
        graph.notificationsRepo.unreadCount(companyId).count
    }
    warm(CacheKeys.inbox(companyId)) { fetchInboxDefault(graph.api, companyId) }
    warm(CacheKeys.contacts(companyId)) {
        graph.contactsRepo.contacts(companyId, limit = 50)
            .let { ContactsSnapshot(it.data, it.next_cursor) }
    }
    warm(CacheKeys.tasks(companyId)) {
        fetchTaskListSnapshot(
            TaskMutations(graph.api),
            companyId,
            taskListArms(TasksTabKind.Open, null, false, null, null),
            0,
        )
    }
    warm(CacheKeys.notifications(companyId)) { graph.notificationsRepo.feed(companyId) }
    warm(CacheKeys.calls(companyId)) {
        fetchCallsLog(
            cache, CallsRepository(graph.api), companyId, null, CacheKeys.calls(companyId),
        )
    }
    warm(CacheKeys.settingsHome(companyId)) { SettingsRepository(graph.api).company(companyId) }
    warm(CacheKeys.usage(companyId)) { SettingsRepository(graph.api).usage(companyId) }
}
