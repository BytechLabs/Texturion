package com.loonext.android

import android.app.Application
import com.loonext.android.core.auth.AppPrefs
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.core.auth.SessionStore
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.data.ContactsRepository
import com.loonext.android.core.data.ForYouRepository
import com.loonext.android.core.data.InboxRepository
import com.loonext.android.core.data.MeRepository
import com.loonext.android.core.data.NotificationsRepository
import com.loonext.android.core.data.SearchRepository
import com.loonext.android.core.data.TasksRepository
import com.loonext.android.core.diag.CrashDiagnostics
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.realtime.RealtimeClient
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Hand-rolled object graph — the app is one process with one composition
 * root; a DI framework would be ceremony without payoff at this size.
 */
class AppGraph(private val app: Application) {
    /** Crash capture + call-in-flight marker (#168A/D) — see [LoonextApp]. */
    val diagnostics: CrashDiagnostics = CrashDiagnostics.get(app)

    /**
     * #168A: without a CoroutineExceptionHandler, ONE uncaught exception in
     * any child coroutine reaches the default handler and Android kills the
     * process (SupervisorJob only isolates siblings — it does not swallow).
     * The handler records the stack for the next-launch share sheet and the
     * app lives on.
     */
    val appScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default +
            CoroutineExceptionHandler { _, error ->
                diagnostics.recordNonFatal("app", error)
            },
    )

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        // Sends are SYNCHRONOUS through Telnyx server-side; allow the carrier
        // round trip before declaring failure.
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS) // realtime websocket keep-alive
        .build()

    val sessionStore = SessionStore(app)
    val prefs = AppPrefs(app)
    val supabaseAuth = SupabaseAuth(
        client = http,
        supabaseUrl = BuildConfig.SUPABASE_URL,
        publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
    )
    val api = ApiClient(
        http = http,
        baseUrl = BuildConfig.API_URL,
        sessionStore = sessionStore,
        supabaseAuth = supabaseAuth,
    )
    val authManager = AuthManager(supabaseAuth, sessionStore, prefs)
    val realtime = RealtimeClient(
        http = http,
        supabaseUrl = BuildConfig.SUPABASE_URL,
        publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
        scope = appScope,
    )

    /** Device push registration (#156) — no-ops until Firebase is configured. */
    val pushRegistrar by lazy { com.loonext.android.push.PushRegistrar(app, api) }

    /**
     * #176: process-lifetime render cache. Screens read through
     * rememberCacheFirst so navigation always paints instantly from here;
     * cleared in [AuthManager.signOut] via the hook below.
     */
    val storeCache = com.loonext.android.core.data.StoreCache()

    /**
     * #201: process-lifetime mark-read guards for the notifications badge.
     * They must outlive NotificationsScreen's composition (the tap that marks
     * a row read also navigates away), so they live here beside the cache
     * whose CacheKeys.unreadNotifications writes they gate.
     */
    val notificationsReadState =
        com.loonext.android.features.notifications.NotificationsReadState()

    val meRepo = MeRepository(api)
    val forYouRepo = ForYouRepository(api)
    val inboxRepo = InboxRepository(api)
    val tasksRepo = TasksRepository(api)
    val contactsRepo = ContactsRepository(api)
    val notificationsRepo = NotificationsRepository(api)
    val searchRepo = SearchRepository(api)

    /**
     * #183 part 3: the "Call with Loonext" deep-link bus. A tap on that row in
     * the system Contacts app lands in MainActivity, which resolves the number
     * and publishes it here; CallsScreen consumes it to open the dialer
     * prefilled. (The "Text with Loonext" twin routes through a Compose overlay,
     * not this bus.)
     */
    val pendingDial = MutableStateFlow<String?>(null)

    /**
     * #183 part 3: create the device-side Connected-Apps account (idempotent)
     * and kick a sync so the "Call/Text with Loonext" rows get written. Called
     * once the user grants contacts access at the dialer. Silent if the platform
     * refuses the account or contacts write permission is absent (the sync then
     * no-ops until it is granted).
     */
    fun enableContactsIntegration() {
        runCatching {
            val accounts = android.accounts.AccountManager.get(app)
            if (com.loonext.android.features.contacts.sync.LoonextContactsAccount.ensure(accounts)) {
                com.loonext.android.features.contacts.sync.LoonextContactsAccount.requestSync()
            }
        }
    }

    init {
        authManager.onSignedOut = {
            storeCache.clear()
            notificationsReadState.clear()
            // #183 part 3: tear down the Connected-Apps account so the
            // "Call/Text with Loonext" rows leave with the session.
            runCatching {
                com.loonext.android.features.contacts.sync.LoonextContactsAccount
                    .remove(android.accounts.AccountManager.get(app))
            }
        }
        // #176 warmer: the moment a company is active, prime every tab's
        // default query so even the first tap after launch paints instantly.
        appScope.launch {
            prefs.activeCompanyId
                .distinctUntilChanged()
                .collect { companyId ->
                    if (companyId != null) {
                        // #195 F8: a process started by an FCM call wake must not
                        // race ten prefetches against the token mint / ring-me —
                        // the telephony client is isolated too, but on a cold cell
                        // socket the radio itself is the contended resource.
                        val sinceWake = System.currentTimeMillis() -
                            com.loonext.android.push.PushHooks.lastCallWakeAtMs
                        if (sinceWake in 0..8_000) {
                            com.loonext.android.core.diag.CallFlowLog.log(
                                "warm",
                                "call-wake start - cache warm deferred 8s",
                            )
                            kotlinx.coroutines.delay(8_000)
                        }
                        runCatching {
                            com.loonext.android.features.shell.warmStoreCache(
                                this@AppGraph, companyId,
                            )
                        }
                    }
                }
        }
        // Realtime channels authorize with the Supabase JWT — keep it fresh.
        appScope.launch {
            api.tokenRefreshed.collect { token -> realtime.setAuth(token) }
        }
    }
}

class LoonextApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        // FIRST (#168 part A): chain the default uncaught-exception handler so
        // every crash — main thread, SDK worker, timer thread — appends its
        // stack to filesDir/crash-reports/latest.txt (last 20 kept, #197)
        // BEFORE the platform handler runs (crash dialog/ANR semantics stay
        // intact). The founder's device has no adb; this file + MainActivity's
        // share prompt + the Diagnostics screen are the forensics channel.
        CrashDiagnostics.install(this, BuildConfig.VERSION_NAME)
        // #198: the call-flow evidence channel — file sink wired before any
        // telephony code (including an FCM-woken cold process) can log.
        com.loonext.android.core.diag.CallFlowLog.install(java.io.File(filesDir, "diag"))
        graph = AppGraph(this)
        com.loonext.android.push.ensureChannels(this)
    }
}
