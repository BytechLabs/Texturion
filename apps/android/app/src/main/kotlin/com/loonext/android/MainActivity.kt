package com.loonext.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.loonext.android.core.model.Me
import com.loonext.android.features.auth.AuthCallbacks
import com.loonext.android.features.auth.AuthFlow
import com.loonext.android.features.auth.AuthViewModel
import com.loonext.android.features.auth.OAUTH_REDIRECT_SCHEME
import com.loonext.android.features.calls.CallsOverlay
import com.loonext.android.features.calls.CallsScreen
import com.loonext.android.features.compose.NewConversationScreen
import com.loonext.android.features.inbox.InboundMessageToastHost
import com.loonext.android.features.inbox.InboundMessageToastHost
import com.loonext.android.features.notifications.NotificationsScreen
import com.loonext.android.features.settings.SettingsHome
import com.loonext.android.features.shell.AccountSheet
import com.loonext.android.features.shell.MainShell
import com.loonext.android.features.shell.RootState
import com.loonext.android.features.shell.RootViewModel
import com.loonext.android.features.shell.ShellContent
import com.loonext.android.features.shell.ShellCounts
import com.loonext.android.features.shell.ShellTab
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.push.PushHooks
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.theme.LoonextTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** A navigation request parsed from a notification tap / app-link intent. */
sealed interface DeepLink {
    data class Thread(val conversationId: String) : DeepLink
    data object Calls : DeepLink
}

/** Notification-tap URLs: https://app.loonext.com/inbox/{id} or /calls?call=… */
private fun parseDeepLink(uri: Uri?): DeepLink? {
    val segments = uri?.pathSegments ?: return null
    return when {
        segments.size >= 2 && (segments[0] == "inbox" || segments[0] == "conversations") ->
            DeepLink.Thread(segments[1])

        segments.firstOrNull() == "calls" -> DeepLink.Calls
        else -> null
    }
}

class MainActivity : ComponentActivity() {
    /** Latest unconsumed deep link; the Ready shell consumes and clears it. */
    private val deepLinks = MutableStateFlow<DeepLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        parseDeepLink(intent?.data)?.let { deepLinks.value = it }
        // OAuth redirect (#166) — buffered until AuthFlow mounts on cold start.
        intent?.data?.takeIf { it.scheme == OAUTH_REDIRECT_SCHEME }
            ?.let(AuthCallbacks::deliver)
        val graph = (application as LoonextApp).graph
        setContent {
            val themePref by graph.prefs.theme
                .collectAsStateWithLifecycle(initialValue = "system")
            val darkTheme = when (themePref) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            LoonextTheme(darkTheme = darkTheme) {
                Root(graph, deepLinks)
                // #168A: no adb on the founder's device — if the last run
                // crashed, offer the saved report once via the share sheet.
                CrashReportPrompt(graph.diagnostics)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        parseDeepLink(intent.data)?.let { deepLinks.value = it }
        intent.data?.takeIf { it.scheme == OAUTH_REDIRECT_SCHEME }
            ?.let(AuthCallbacks::deliver)
    }
}

/**
 * #168 part A: the post-crash share prompt. When crash-reports/latest.txt
 * holds a crash the user hasn't seen, a small dismissible dialog offers an
 * ACTION_SEND chooser with the report text. Either choice marks the report
 * surfaced — it never nags twice for the same crash.
 */
@Composable
private fun CrashReportPrompt(diagnostics: com.loonext.android.core.diag.CrashDiagnostics) {
    val context = LocalContext.current
    var report by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        report = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { diagnostics.store.unsurfacedReport() }.getOrNull()
        }
    }
    val text = report ?: return
    val dismiss = {
        diagnostics.store.markSurfaced()
        report = null
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = dismiss,
        title = { Text("The app closed unexpectedly") },
        text = {
            Text(
                "A crash report was saved on this device. " +
                    "Sharing it helps us find and fix the problem.",
            )
        },
        confirmButton = {
            TextButton(onClick = {
                dismiss()
                val send = Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, "Loonext Android crash report")
                    .putExtra(Intent.EXTRA_TEXT, text)
                runCatching {
                    context.startActivity(Intent.createChooser(send, "Share crash report"))
                }
            }) { Text("Share crash report") }
        },
        dismissButton = { TextButton(onClick = dismiss) { Text("Dismiss") } },
    )
}

/** ViewModel factory over the hand-rolled graph. */
private class GraphVmFactory(private val graph: AppGraph) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when (modelClass) {
        RootViewModel::class.java -> RootViewModel(graph) as T
        AuthViewModel::class.java -> AuthViewModel(graph.authManager) as T
        else -> throw IllegalArgumentException("Unknown ViewModel: $modelClass")
    }
}

@Composable
private fun Root(graph: AppGraph, deepLinks: MutableStateFlow<DeepLink?>) {
    val factory = remember(graph) { GraphVmFactory(graph) }
    val root: RootViewModel = viewModel(factory = factory)
    val state by root.state.collectAsStateWithLifecycle()

    when (val current = state) {
        RootState.Loading -> CenteredLoading()
        RootState.SignedOut -> {
            val auth: AuthViewModel = viewModel(factory = factory)
            AuthFlow(auth)
        }

        is RootState.NeedsWorkspace -> ExternalStep(
            headline = "Let's set up your workspace",
            body = "Workspace creation and checkout live on the web for now. " +
                "Create yours at app.loonext.com, then come back and pull to refresh.",
            cta = "Open app.loonext.com",
            url = "https://app.loonext.com/onboarding",
            onRefresh = root::retry,
            onSignOut = root::signOut,
        )

        is RootState.NeedsCheckout -> ExternalStep(
            headline = "Finish setting up",
            body = "Your workspace hasn't completed checkout yet. Finish on the web " +
                "and your number, texting, and calling light up here.",
            cta = "Finish checkout",
            url = "https://app.loonext.com/onboarding/plan",
            onRefresh = root::retry,
            onSignOut = root::signOut,
        )

        is RootState.Failed -> CenteredError(current.message, onRetry = root::retry)

        is RootState.Ready -> ReadyShell(graph, current.me, current.companyId, root, deepLinks)
    }
}

/** Full-screen surfaces layered over the tab shell (state-based, no NavHost). */
private sealed interface Overlay {
    data class Thread(val conversationId: String) : Overlay
    data class Compose(val prefillContactId: String?) : Overlay
    data object Calls : Overlay
    data object Notifications : Overlay
    data object Settings : Overlay
}

@Composable
private fun ReadyShell(
    graph: AppGraph,
    me: Me,
    companyId: String,
    root: RootViewModel,
    deepLinks: MutableStateFlow<DeepLink?>,
) {
    val context = LocalContext.current
    var sheetOpen by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf(ShellTab.ForYou) }
    var overlay by remember { mutableStateOf<Overlay?>(null) }
    var counts by remember { mutableStateOf(ShellCounts()) }
    var countsKey by remember { mutableIntStateOf(0) }
    var hydratedMe by remember(companyId) { mutableStateOf(me) }

    // The thread the user is LOOKING at right now (tab-internal or overlay) —
    // suppresses the global inbound toast for that conversation (#165).
    var tabViewedConversation by remember { mutableStateOf<String?>(null) }
    val viewedConversation = (overlay as? Overlay.Thread)?.conversationId
        ?: tabViewedConversation

    // Session-scoped device wiring: push registration (no-op without Firebase
    // config) + softphone ring-registration + the call-push wake hook.
    LaunchedEffect(companyId) {
        runCatching { graph.pushRegistrar.register(companyId) }
        val softphone = SoftphoneManager.get(context.applicationContext, graph.api)
        PushHooks.callWakeHandler = com.loonext.android.push.CallWakeHandler { content ->
            content.callSessionId?.let { sessionId ->
                graph.appScope.launch {
                    runCatching {
                        softphone.onIncomingCallPush(
                            sessionId,
                            // #168B: the push body carries the raw caller
                            // E.164 when known — the stale-ring probe's
                            // caller correlation.
                            com.loonext.android.telephony.StaleRingPolicy
                                .callerHintFromPushBody(content.body),
                        )
                    }
                }
            }
        }
        runCatching {
            softphone.start(companyId, callerIdName = hydratedMe.display_name)
        }
    }

    // Notification taps / app links.
    LaunchedEffect(companyId) {
        deepLinks.collect { link ->
            when (link) {
                is DeepLink.Thread -> overlay = Overlay.Thread(link.conversationId)
                DeepLink.Calls -> overlay = Overlay.Calls
                null -> Unit
            }
            if (link != null) deepLinks.value = null
        }
    }

    // Hydrate the company view (numbers etc.) + live nav counts. Badges cap at
    // 9+, so one 100-row page gives an exact-up-to-cap count.
    LaunchedEffect(companyId, countsKey) {
        runCatching { graph.meRepo.me(companyId) }.onSuccess { hydratedMe = it }
        val forYou = runCatching { graph.forYouRepo.forYou(companyId) }.getOrNull()
        val unread = runCatching {
            graph.inboxRepo.conversations(companyId, unread = true, limit = 100).data.size
        }.getOrDefault(0)
        val openTasks = runCatching {
            graph.tasksRepo.tasks(companyId, limit = 100).data.size
        }.getOrDefault(0)
        val unreadNotifications = runCatching {
            graph.notificationsRepo.unreadCount(companyId).count
        }.getOrDefault(0)
        counts = ShellCounts(
            forYou = forYou?.let {
                it.waiting_on_you.size + it.my_tasks.size + it.unread.size
            } ?: 0,
            unreadConversations = unread,
            openTasks = openTasks,
            unreadNotifications = unreadNotifications,
        )
    }
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { countsKey++ }
    }

    Box(Modifier.fillMaxSize()) {
        MainShell(
            me = hydratedMe,
            counts = counts,
            tab = tab,
            onTabChange = { tab = it },
            onCompose = { overlay = Overlay.Compose(null) },
            onOpenAccountSheet = { sheetOpen = true },
        ) { activeTab, modifier ->
            ShellContent(
                activeTab, graph, hydratedMe, companyId, modifier,
                onOpenThread = { overlay = Overlay.Thread(it) },
                onComposeNew = { overlay = Overlay.Compose(it) },
                onOpenCalls = { overlay = Overlay.Calls },
                onViewedConversationChanged = { tabViewedConversation = it },
            )
        }

        // The persistent call chip (renders nothing while idle). Mounting it is
        // what makes this member ring-eligible while the app is open (#155).
        CallsOverlay(
            graph = graph,
            companyId = companyId,
            me = hydratedMe,
            openConversation = { overlay = Overlay.Thread(it) },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 96.dp),
        )

        // Global inbound toast for conversations the user is NOT viewing (#165).
        InboundMessageToastHost(
            graph = graph,
            companyId = companyId,
            viewedConversationId = { viewedConversation },
            onView = { overlay = Overlay.Thread(it) },
            modifier = Modifier.align(Alignment.BottomCenter),
        )

        // Inbound texts landing outside the viewed thread surface as a
        // one-line snackbar with a View action (#165).
        InboundMessageToastHost(
            graph = graph,
            companyId = companyId,
            viewedConversationId = { (overlay as? Overlay.Thread)?.conversationId },
            onView = { overlay = Overlay.Thread(it) },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 96.dp),
        )

        overlay?.let { active ->
            BackHandler { overlay = null }
            Surface(Modifier.fillMaxSize()) {
                when (active) {
                    is Overlay.Thread -> ThreadScreen(
                        graph = graph,
                        companyId = companyId,
                        me = hydratedMe,
                        conversationId = active.conversationId,
                        onBack = { overlay = null },
                    )

                    is Overlay.Compose -> NewConversationScreen(
                        graph = graph,
                        companyId = companyId,
                        me = hydratedMe,
                        prefillContactId = active.prefillContactId,
                        onCreated = { overlay = Overlay.Thread(it) },
                        onBack = { overlay = null },
                    )

                    Overlay.Calls -> OverlayScaffold("Calls", onBack = { overlay = null }) {
                        CallsScreen(
                            graph = graph,
                            companyId = companyId,
                            me = hydratedMe,
                            modifier = it,
                            openConversation = { conversationId ->
                                overlay = Overlay.Thread(conversationId)
                            },
                        )
                    }

                    Overlay.Notifications -> OverlayScaffold(
                        "Notifications",
                        onBack = { overlay = null },
                    ) {
                        NotificationsScreen(
                            graph = graph,
                            companyId = companyId,
                            modifier = it,
                            onOpenConversation = { conversationId ->
                                overlay = Overlay.Thread(conversationId)
                            },
                        )
                    }

                    Overlay.Settings -> OverlayScaffold(
                        "Settings",
                        onBack = { overlay = null },
                    ) {
                        SettingsHome(
                            graph = graph,
                            companyId = companyId,
                            me = hydratedMe,
                            modifier = it,
                            onSignOut = root::signOut,
                        )
                    }
                }
            }
        }
    }

    if (sheetOpen) {
        AccountSheet(
            graph = graph,
            me = hydratedMe,
            companyId = companyId,
            unreadNotifications = counts.unreadNotifications,
            onOpenCalls = { overlay = Overlay.Calls },
            onOpenNotifications = { overlay = Overlay.Notifications },
            onOpenSettings = { overlay = Overlay.Settings },
            onSwitchWorkspace = root::switchWorkspace,
            onSignOut = root::signOut,
            onDismiss = { sheetOpen = false },
        )
    }
}

/** Back-arrow header around overlay surfaces that don't own navigation. */
@Composable
private fun OverlayScaffold(
    title: String,
    onBack: () -> Unit,
    content: @Composable (Modifier) -> Unit,
) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(title, style = MaterialTheme.typography.titleMedium)
        }
        content(Modifier.fillMaxSize())
    }
}

/** A signed-in interstitial that hands off to the web app in the browser. */
@Composable
private fun ExternalStep(
    headline: String,
    body: String,
    cta: String,
    url: String,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(headline, style = MaterialTheme.typography.headlineSmall)
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
        )
        Button(onClick = {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
        }) { Text(cta) }
        TextButton(onClick = onRefresh) { Text("I've done this — refresh") }
        TextButton(onClick = onSignOut) { Text("Sign out") }
    }
}
