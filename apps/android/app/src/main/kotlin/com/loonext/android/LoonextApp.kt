package com.loonext.android

import android.app.Application
import com.loonext.android.core.auth.AppPrefs
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.core.auth.SessionEnded
import com.loonext.android.core.auth.SessionStore
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.data.AiRepository
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
import com.loonext.android.core.update.UpdateRepository
import com.loonext.android.features.settings.SettingsRepository
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import com.loonext.android.telephony.SoftphoneManager

/**
 * Hand-rolled object graph — the app is one process with one composition
 * root; a DI framework would be ceremony without payoff at this size.
 */
class AppGraph(
    private val app: Application,
    /**
     * #593 — the two base URLs, injectable, defaulting to the build's own.
     *
     * Production passes nothing and gets `BuildConfig`, so no shipped behaviour depends
     * on this. It exists because the handover funnel decides where six typed digits are
     * CHECKED — our API for a code we emailed, Supabase for either authenticator demand
     * — and until now that property was pinned only by a lint reading the source text.
     * A lint cannot assert the thing that matters, which is that no request our own
     * server receives ever contains those digits. Asserting that needs the funnel
     * pointed at two servers a test can read, and this is the smallest seam that allows
     * it.
     *
     * Getting the destination wrong is a hard lockout: an owner reads a correct code off
     * their authenticator and is told it did not work, every time.
     */
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val apiUrl: String = BuildConfig.API_URL,
) {
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
        supabaseUrl = supabaseUrl,
        publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
    )
    val api = ApiClient(
        http = http,
        baseUrl = apiUrl,
        sessionStore = sessionStore,
        supabaseAuth = supabaseAuth,
    )
    /**
     * #339: the public update policy. Its own client-free repository on
     * purpose — see UpdateRepository for why it must not ride ApiClient.
     */
    val updates = UpdateRepository(http = http, baseUrl = apiUrl)
    val authManager = AuthManager(supabaseAuth, sessionStore, prefs)
    /**
     * #289: is a call live on this device right now?
     *
     * Read through [SoftphoneManager.peek] rather than a held reference because
     * the softphone is built lazily by whatever screen needs it first, and the
     * realtime lifecycle must not be the thing that forces it into existence —
     * a phone that has never made a call should not spin up a softphone to find
     * out that it has no call.
     *
     * No softphone means no call, which is the honest answer and the safe one:
     * the socket drops, and an incoming call still arrives by push.
     */
    fun callActive(): Boolean =
        SoftphoneManager.peek()?.state?.value?.activeId != null

    val realtime = RealtimeClient(
        http = http,
        supabaseUrl = supabaseUrl,
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
    // #496: the boot path asks whether this session has satisfied two-factor,
    // so the repository that answers cannot live only inside the settings tree.
    val settingsRepo = SettingsRepository(api)
    val forYouRepo = ForYouRepository(api)
    val inboxRepo = InboxRepository(api)
    val tasksRepo = TasksRepository(api)
    val contactsRepo = ContactsRepository(api)
    val notificationsRepo = NotificationsRepository(api)
    val searchRepo = SearchRepository(api)

    /**
     * #214 AI task enrichment + the per-company opt-in. Singleton so its
     * per-(company, message) enrichment session cache is process-lifetime — a
     * make-task sheet reopened for the same message reuses the suggestion
     * instead of spending another AI call.
     */
    val aiRepo = AiRepository(api)

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
        // #330: registered on SessionEnded rather than on the Sign out button, so a
        // session the SERVER ended clears the same things. An owner signing a
        // departed tech's phone out (#236) used to drop only the token, leaving every
        // cached conversation and unread count on a phone the company cannot ask
        // back — which is the case that matters once somebody has actually left.
        SessionEnded.onEnded {
            storeCache.clear()
            notificationsReadState.clear()
            // #183 part 3: tear down the Connected-Apps account so the
            // "Call/Text with Loonext" rows leave with the session.
            runCatching {
                com.loonext.android.features.contacts.sync.LoonextContactsAccount
                    .remove(android.accounts.AccountManager.get(app))
            }
            // And the outbox — what somebody was in the middle of saying to a
            // customer, and the photos they attached. It survived every exit until
            // now: an unsent message to a homeowner sitting on a phone the company
            // does not own, which could also flush under a session that is gone.
            appScope.launch {
                runCatching {
                    com.loonext.android.features.thread.Outbox(app).clear()
                }
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
