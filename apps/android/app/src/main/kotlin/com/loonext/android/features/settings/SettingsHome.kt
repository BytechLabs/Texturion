package com.loonext.android.features.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/** The stacked settings index (#157) — mirrors the web's mobile section list. */
enum class SettingsSection(val title: String, val blurb: String) {
    Workspace("Workspace", "Name, business identification, timezone"),
    Hours("Business hours & away reply", "When you're open, and what after-hours texters hear"),
    Calling("Calling", "Missed-call text-back, voicemail, screening, caller ID"),
    Team("Team", "Who can see and answer your customers' texts"),
    Numbers("Numbers", "Your numbers, ports, text-enablement, registration"),
    Usage("Usage", "Messages, minutes, and your overage cap"),
    Billing("Billing", "Plan, payment, and invoices"),
    Notifications("Notifications", "Email and push for new conversations"),
    Profile("Profile & account", "Your name, theme, email, and password"),
}

/** Everything a section needs, threaded once instead of eight parameters. */
class SettingsScope(
    val graph: AppGraph,
    val repo: SettingsRepository,
    val companyId: String,
    val me: Me,
    val role: String?,
    val showMessage: (String) -> Unit,
)

/**
 * Settings entry (#157): a stacked index list navigating (state-based, no nav
 * graph) into the nine sections. The company view loads once here and
 * refreshes on `number.updated` / `registration.updated` realtime events;
 * sections patch it back via [onCompanyUpdated]-style merges.
 */
@Composable
fun SettingsHome(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onSignOut: () -> Unit,
) {
    val repo = remember(graph) { SettingsRepository(graph.api) }
    val role = me.memberships.firstOrNull { it.company_id == companyId }?.role
    var section by rememberSaveable(companyId) { mutableStateOf<SettingsSection?>(null) }
    var companyState by remember(companyId) {
        mutableStateOf<LoadState<CompanyView>>(LoadState.Loading)
    }
    var refreshKey by remember(companyId) { mutableStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val settingsScope = remember(graph, companyId, me, role) {
        SettingsScope(
            graph = graph,
            repo = repo,
            companyId = companyId,
            me = me,
            role = role,
            showMessage = { message -> scope.launch { snackbar.showSnackbar(message) } },
        )
    }

    LaunchedEffect(companyId, refreshKey) {
        if (refreshKey == 0) companyState = LoadState.Loading
        companyState = try {
            LoadState.Ready(repo.company(companyId))
        } catch (cause: Exception) {
            if (companyState is LoadState.Ready) {
                settingsScope.showMessage(cause.userMessage())
                companyState
            } else {
                LoadState.Failed(cause.userMessage())
            }
        }
    }
    // Provisioning completion / 10DLC approval appear live (SPEC §8: payloads
    // are ID-only, so refetch — never patch from the event).
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "number.updated" || event.event == "registration.updated") {
                refreshKey++
            }
        }
    }

    BackHandler(enabled = section != null) { section = null }

    Box(modifier.fillMaxSize()) {
        when (val current = companyState) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                val company = current.value
                val onCompanyUpdated: (CompanyView) -> Unit = { patched ->
                    // PATCH /v1/company returns scalar columns only — keep the
                    // embedded numbers/registration/modules from the last GET.
                    companyState = LoadState.Ready(
                        patched.copy(
                            numbers = company.numbers,
                            enabled_modules = company.enabled_modules,
                            registration = company.registration,
                        ),
                    )
                }
                when (val active = section) {
                    null -> SettingsIndex(
                        company = company,
                        onOpen = { section = it },
                    )

                    else -> SectionScreen(title = active.title, onBack = { section = null }) {
                        when (active) {
                            SettingsSection.Workspace -> WorkspaceSection(
                                settingsScope, company, onCompanyUpdated,
                            )

                            SettingsSection.Hours -> HoursSection(
                                settingsScope, company, onCompanyUpdated,
                            )

                            SettingsSection.Calling -> CallingSection(
                                settingsScope, company, onCompanyUpdated,
                            )

                            SettingsSection.Team -> TeamSection(settingsScope, company)

                            SettingsSection.Numbers -> NumbersSection(
                                settingsScope, company, onRefreshCompany = { refreshKey++ },
                            )

                            SettingsSection.Usage -> UsageSection(
                                settingsScope, company, onCompanyUpdated,
                            )

                            SettingsSection.Billing -> BillingSection(
                                settingsScope, company, onRefreshCompany = { refreshKey++ },
                            )

                            SettingsSection.Notifications -> NotificationsSection(settingsScope)

                            SettingsSection.Profile -> ProfileSection(
                                settingsScope, onSignOut = onSignOut,
                            )
                        }
                    }
                }
            }
        }
        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

@Composable
private fun SettingsIndex(company: CompanyView, onOpen: (SettingsSection) -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
            Text("Settings", style = MaterialTheme.typography.headlineSmall)
            Text(
                company.name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        SettingsSection.entries.forEach { section ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(section) }
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(section.title, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        section.blurb,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(8.dp))
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun SectionScreen(
    title: String,
    onBack: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to settings",
                )
            }
            Text(title, style = MaterialTheme.typography.titleLarge)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(vertical = 10.dp),
        ) {
            content()
        }
    }
}
