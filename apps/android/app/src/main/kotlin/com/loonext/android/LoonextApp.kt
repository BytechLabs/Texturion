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
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.realtime.RealtimeClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Hand-rolled object graph — the app is one process with one composition
 * root; a DI framework would be ceremony without payoff at this size.
 */
class AppGraph(private val app: Application) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

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

    val meRepo = MeRepository(api)
    val forYouRepo = ForYouRepository(api)
    val inboxRepo = InboxRepository(api)
    val tasksRepo = TasksRepository(api)
    val contactsRepo = ContactsRepository(api)
    val notificationsRepo = NotificationsRepository(api)
    val searchRepo = SearchRepository(api)

    init {
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
        graph = AppGraph(this)
        com.loonext.android.push.ensureChannels(this)
    }
}
