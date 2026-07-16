package com.loonext.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.loonext.android.features.auth.AuthFlow
import com.loonext.android.features.auth.AuthViewModel
import com.loonext.android.features.shell.AccountSheet
import com.loonext.android.features.shell.MainShell
import com.loonext.android.features.shell.RootState
import com.loonext.android.features.shell.RootViewModel
import com.loonext.android.features.shell.ShellContent
import com.loonext.android.features.shell.ShellCounts
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.theme.LoonextTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
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
                Root(graph)
            }
        }
    }
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
private fun Root(graph: AppGraph) {
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

        is RootState.Ready -> ReadyShell(graph, current.me, current.companyId, root)
    }
}

@Composable
private fun ReadyShell(graph: AppGraph, me: Me, companyId: String, root: RootViewModel) {
    var sheetOpen by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf(com.loonext.android.features.shell.ShellTab.ForYou) }
    var counts by remember { mutableStateOf(ShellCounts()) }
    var countsKey by remember { mutableStateOf(0) }
    var hydratedMe by remember(companyId) { mutableStateOf(me) }

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

    MainShell(
        me = hydratedMe,
        counts = counts,
        tab = tab,
        onTabChange = { tab = it },
        // The compose screen ships with the messaging pass (#153); until it
        // lands the FAB lands on the inbox (no dead tap, no fake UI).
        onCompose = { tab = com.loonext.android.features.shell.ShellTab.Inbox },
        onOpenAccountSheet = { sheetOpen = true },
    ) { activeTab, modifier ->
        ShellContent(activeTab, graph, hydratedMe, companyId, modifier)
    }

    if (sheetOpen) {
        AccountSheet(
            graph = graph,
            me = hydratedMe,
            companyId = companyId,
            onSwitchWorkspace = root::switchWorkspace,
            onSignOut = root::signOut,
            onDismiss = { sheetOpen = false },
        )
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
