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
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
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
import com.loonext.android.features.notifications.NotificationsScreen
import com.loonext.android.features.settings.SettingsHome
import com.loonext.android.features.shell.AccountSheet
import com.loonext.android.features.shell.MainShell
import com.loonext.android.features.shell.RootState
import com.loonext.android.features.shell.RootViewModel
import com.loonext.android.features.shell.ShellContent
import com.loonext.android.features.shell.ShellCounts
import com.loonext.android.features.shell.ShellTab
import com.loonext.android.features.tasks.TaskDetailScreen
import com.loonext.android.features.tasks.TaskMutations
import com.loonext.android.features.contacts.ContactDetailScreen
import com.loonext.android.features.contacts.ContactMutations
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.theme.LoonextTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A navigation request parsed from a notification tap / app-link intent. */
sealed interface DeepLink {
    data class Thread(val conversationId: String) : DeepLink

    /**
     * The calls surface. [sessionId] rides the `?call=<session>` query
     * param (calls-v3 §10.2/§10.3): a notification tap that carries a session
     * runs the SAME wake sequence a `kind:'call'` push would — register,
     * read `/state`, ring-me — so the tray-fallback / cold-process tap lands
     * in ring-me instead of an empty calls list (the pre-v3 build DROPPED the
     * param, §17.7; that was scenario 2's dead end).
     */
    data class Calls(val sessionId: String? = null) : DeepLink
}

/** Notification-tap URLs: https://app.loonext.com/inbox/{id} or /calls?call=… */
private fun parseDeepLink(uri: Uri?): DeepLink? {
    val segments = uri?.pathSegments ?: return null
    return when {
        segments.size >= 2 && (segments[0] == "inbox" || segments[0] == "conversations") ->
            DeepLink.Thread(segments[1])

        segments.firstOrNull() == "calls" ->
            DeepLink.Calls(uri.getQueryParameter("call")?.takeIf { it.isNotBlank() })

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

/**
 * Full-screen ROUTES layered over the tab shell as a STACK (state-based, no
 * NavHost). The architectural rule the founder mandated: the pill nav exists
 * ONLY on the four tab roots — ANYTHING pushed (thread, task, contact,
 * compose, notifications, settings) renders here, above the shell, so a
 * pushed surface with a visible nav bar is not constructible. The stack makes
 * task → conversation → back → task work with one BackHandler.
 */
private sealed interface Overlay {
    data class Thread(
        val conversationId: String,
        /** Search-result jump target: scroll to + flash this message. */
        val highlightMessageId: String? = null,
    ) : Overlay
    data class Task(val taskId: String) : Overlay
    data class Contact(val contactId: String) : Overlay
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
    val routeStack = remember { androidx.compose.runtime.mutableStateListOf<Overlay>() }
    fun push(route: Overlay) = routeStack.add(route)
    fun pop() { routeStack.removeLastOrNull() }
    var counts by remember { mutableStateOf(ShellCounts()) }
    var countsKey by remember { mutableIntStateOf(0) }
    var hydratedMe by remember(companyId) { mutableStateOf(me) }

    // The thread the user is LOOKING at right now (tab-internal or overlay) —
    // suppresses the global inbound toast for that conversation (#165).
    var tabViewedConversation by remember { mutableStateOf<String?>(null) }
    val viewedConversation = (routeStack.lastOrNull() as? Overlay.Thread)?.conversationId
        ?: tabViewedConversation

    // The process-wide softphone. get() also INSTALLS the call-wake +
    // call-end push handlers (calls-v3 §10.2: SoftphoneManager's init is the
    // ONE installer — MainActivity's old overwrite, which referenced the
    // deleted StaleRing probe, is gone). The cold-process wake path lives in
    // LoonextMessagingService for FCM-woken processes with no UI.
    val softphone = remember(context) {
        SoftphoneManager.get(context.applicationContext, graph.api)
    }

    // Session-scoped device wiring: push registration (no-op without Firebase
    // config) + softphone ring-registration.
    LaunchedEffect(companyId, hydratedMe.display_name) {
        runCatching { graph.pushRegistrar.register(companyId) }
        runCatching {
            softphone.start(companyId, callerIdName = hydratedMe.display_name)
        }
    }

    // Notification taps / app links.
    LaunchedEffect(companyId) {
        deepLinks.collect { link ->
            when (link) {
                is DeepLink.Thread -> push(Overlay.Thread(link.conversationId))
                is DeepLink.Calls -> {
                    push(Overlay.Calls)
                    // §10.2/§10.3: a tap that carries the session runs the
                    // wake sequence (register → /state → ring-me), same as a
                    // `kind:'call'` push — the tray-fallback / cold-start join.
                    link.sessionId?.let { session ->
                        graph.appScope.launch {
                            runCatching { softphone.onIncomingCallPush(session) }
                        }
                    }
                }

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
        graph.realtime.events.collect { event ->
            countsKey++
            // §9.1/§10.1: the `call.updated` broadcast now carries {state,
            // answered_by_user_id} — forward a ringing-exit state to the
            // softphone so a presenting device stops presenting (silence only;
            // the server sends the BYE). ID-only payload, no PII.
            if (event.event == "call.updated") {
                val session = (event.payload["call_session_id"] as? JsonPrimitive)
                    ?.contentOrNull
                val callState = (event.payload["state"] as? JsonPrimitive)?.contentOrNull
                if (session != null) softphone.onCallSessionUpdate(session, callState)
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        MainShell(
            me = hydratedMe,
            counts = counts,
            tab = tab,
            onTabChange = { tab = it },
            onCompose = { push(Overlay.Compose(null)) },
            onOpenAccountSheet = { sheetOpen = true },
            floatingAction = if (tab == ShellTab.Inbox) {
                {
                    // Spec 20's ink pencil FAB, hosted in the shell slot so it can
                    // never be underdrawn by the pill/gradient (#173).
                    Surface(
                        onClick = { push(Overlay.Compose(null)) },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                        shadowElevation = 10.dp,
                        modifier = Modifier.size(54.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Outlined.Edit,
                                contentDescription = "New conversation",
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            } else {
                null
            },
        ) { activeTab, modifier ->
            ShellContent(
                activeTab, graph, hydratedMe, companyId, modifier,
                onOpenThread = { conversationId, highlightMessageId ->
                    push(Overlay.Thread(conversationId, highlightMessageId))
                },
                onOpenTask = { push(Overlay.Task(it)) },
                onOpenContact = { push(Overlay.Contact(it)) },
                onOpenNotifications = { push(Overlay.Notifications) },
                onComposeNew = { push(Overlay.Compose(it)) },
                onOpenCalls = { push(Overlay.Calls) },
                onViewedConversationChanged = { tabViewedConversation = it },
            )
        }

        // The persistent call chip (renders nothing while idle). Mounting it is
        // what makes this member ring-eligible while the app is open (#155).
        CallsOverlay(
            graph = graph,
            companyId = companyId,
            me = hydratedMe,
            openConversation = { push(Overlay.Thread(it)) },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 96.dp),
        )

        // Global inbound toast for conversations the user is NOT viewing
        // (#165). ONE mount (two parallel sessions had each added one —
        // double snackbar + double fetch): the viewedConversation predicate
        // also suppresses threads opened INSIDE the tabs, and the 96.dp
        // bottom padding clears the tab bar alongside the call chip.
        InboundMessageToastHost(
            graph = graph,
            companyId = companyId,
            viewedConversationId = { viewedConversation },
            onView = { push(Overlay.Thread(it)) },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 96.dp),
        )

        routeStack.lastOrNull()?.let { active ->
            BackHandler { pop() }
            // Canvas + status inset once for every routed surface (#172). Only
            // the TOP of the stack renders; back pops one route at a time.
            // imePadding here is the ONE keyboard policy for pushed routes
            // (#187): with enableEdgeToEdge the manifest's adjustResize does
            // nothing by itself, so any input on any route (task notes, thread
            // composer, compose) stays above the keyboard because the HOST
            // pads — a screen cannot forget. Inset consumption makes any
            // leftover imePadding inside a routed screen a no-op, so locals
            // cannot double-pad.
            Surface(
                Modifier.fillMaxSize().statusBarsPadding().imePadding(),
                color = MaterialTheme.colorScheme.background,
            ) {
                when (active) {
                    is Overlay.Thread -> ThreadScreen(
                        graph = graph,
                        companyId = companyId,
                        me = hydratedMe,
                        conversationId = active.conversationId,
                        highlightMessageId = active.highlightMessageId,
                        onBack = { pop() },
                        onOpenConversation = { push(Overlay.Thread(it)) },
                    )

                    is Overlay.Task -> TaskDetailScreen(
                        graph = graph,
                        mutations = remember(companyId) { TaskMutations(graph.api) },
                        companyId = companyId,
                        me = hydratedMe,
                        taskId = active.taskId,
                        onBack = { pop() },
                        onOpenConversation = { conversationId, _ ->
                            push(Overlay.Thread(conversationId))
                        },
                    )

                    is Overlay.Contact -> ContactDetailScreen(
                        graph = graph,
                        mutations = remember(companyId) {
                            ContactMutations(graph.api, BuildConfig.API_URL)
                        },
                        companyId = companyId,
                        callerIdName = hydratedMe.display_name,
                        contactId = active.contactId,
                        onBack = { pop() },
                        onOpenConversation = { push(Overlay.Thread(it)) },
                        onComposeNew = { push(Overlay.Compose(it)) },
                    )

                    is Overlay.Compose -> NewConversationScreen(
                        graph = graph,
                        companyId = companyId,
                        me = hydratedMe,
                        prefillContactId = active.prefillContactId,
                        onCreated = {
                            pop()
                            push(Overlay.Thread(it))
                        },
                        onBack = { pop() },
                    )

                    Overlay.Calls -> OverlayScaffold("Calls", onBack = { pop() }) {
                        CallsScreen(
                            graph = graph,
                            companyId = companyId,
                            me = hydratedMe,
                            modifier = it,
                            openConversation = { conversationId ->
                                push(Overlay.Thread(conversationId))
                            },
                        )
                    }

                    Overlay.Notifications -> OverlayScaffold(
                        "Notifications",
                        onBack = { pop() },
                    ) {
                        NotificationsScreen(
                            graph = graph,
                            companyId = companyId,
                            modifier = it,
                            onOpenConversation = { conversationId ->
                                push(Overlay.Thread(conversationId))
                            },
                        )
                    }

                    Overlay.Settings -> OverlayScaffold(
                        "Settings",
                        onBack = { pop() },
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
            onOpenContacts = { tab = ShellTab.Contacts },
            onOpenNotifications = { push(Overlay.Notifications) },
            onOpenSettings = { push(Overlay.Settings) },
            onSwitchWorkspace = root::switchWorkspace,
            onSignOut = root::signOut,
            onDismiss = { sheetOpen = false },
        )
    }
}

/**
 * Back header around overlay surfaces that don't own navigation — spec-06
 * grammar: 44dp paper-circle back w/ outlined arrow, centered muted 13sp
 * label, on the canvas background.
 */
@Composable
private fun OverlayScaffold(
    title: String,
    onBack: () -> Unit,
    content: @Composable (Modifier) -> Unit,
) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp),
            ) {
                Surface(
                    onClick = onBack,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 1.dp,
                    modifier = Modifier.size(44.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
                Text(
                    title,
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            content(Modifier.fillMaxSize())
        }
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
