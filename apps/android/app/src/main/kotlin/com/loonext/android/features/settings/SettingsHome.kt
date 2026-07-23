package com.loonext.android.features.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.DataUsage
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.Usage
import com.loonext.android.core.model.UsageStatus
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.loonextWordmark
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.rememberShimmerBrush
import com.loonext.android.ui.theme.BrandColor
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.launch

/** The stacked settings index (#157) — mirrors the web's mobile section list. */
enum class SettingsSection(val title: String, val blurb: String) {
    Workspace("Workspace", "Name, business identification, timezone"),
    Hours("Business hours & away reply", "When you're open, and what after-hours texters hear"),
    Calling("Calling", "Missed-call text-back, voicemail, screening, caller ID"),
    Team("Team", "Who can see and answer your customers' texts"),
    Numbers("Numbers", "Your numbers, ports, text-enablement, registration"),
    Usage("Usage", "Fair use, your spending cap, and the numbers"),
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
 * Settings entry (#157): the workspace hub (screen 28) navigating
 * (state-based, no nav graph) into the nine sections. The company view loads
 * once here and refreshes on `number.updated` / `registration.updated`
 * realtime events; sections patch it back via [onCompanyUpdated]-style merges.
 */
@Composable
fun SettingsHome(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onSignOut: () -> Unit,
    onOpenDiagnostics: () -> Unit = {},
) {
    val repo = remember(graph) { SettingsRepository(graph.api) }
    val role = me.memberships.firstOrNull { it.company_id == companyId }?.role
    var section by rememberSaveable(companyId) { mutableStateOf<SettingsSection?>(null) }
    var refreshKey by remember(companyId) { mutableStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
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

    // #198 easter egg: seven quick taps on the version footer (2s between
    // taps) flips the persisted devMode pref. Silent while counting — no
    // haptics, no ripple, nothing for stray taps; only the 7th speaks.
    val devMode by graph.prefs.devMode.collectAsState(initial = false)
    var versionTaps by remember { mutableIntStateOf(0) }
    var lastVersionTapMs by remember { mutableLongStateOf(0L) }
    val onVersionTap: () -> Unit = {
        val nowMs = System.currentTimeMillis()
        versionTaps = if (nowMs - lastVersionTapMs <= 2_000L) versionTaps + 1 else 1
        lastVersionTapMs = nowMs
        if (versionTaps >= 7) {
            versionTaps = 0
            val next = !devMode
            scope.launch {
                graph.prefs.setDevMode(next)
                snackbar.showSnackbar(if (next) "Diagnostics unlocked" else "Diagnostics hidden")
            }
        }
    }

    // #176 cache-first: the company view paints instantly from StoreCache on
    // every visit after the first in-process fetch; refreshKey bumps
    // (realtime, retry) are silent revalidation.
    val companyState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.settingsHome(companyId),
        refreshKey = refreshKey,
    ) { repo.company(companyId) }
    // The hub's fair-use whisper (#178) shares the Usage section's key; the
    // card stays hidden until the first value ever resolves, then keeps the
    // last good value across background misses.
    val usageState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.usage(companyId),
        refreshKey = refreshKey,
    ) { repo.usage(companyId) }
    val usage = (usageState as? LoadState.Ready)?.value
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
            is LoadState.Loading -> SettingsHubSkeleton()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                val company = current.value
                val onCompanyUpdated: (CompanyView) -> Unit = { patched ->
                    // PATCH /v1/company returns scalar columns only — keep the
                    // embedded numbers/registration/modules from the last GET.
                    // Written straight into the cache so every visit sees it.
                    graph.storeCache.put(
                        CacheKeys.settingsHome(companyId),
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
                        me = me,
                        role = role,
                        usage = usage,
                        devMode = devMode,
                        onOpen = { section = it },
                        onCopyNumber = { number ->
                            copyToClipboard(context, number)
                            settingsScope.showMessage("Number copied.")
                        },
                        onOpenDiagnostics = onOpenDiagnostics,
                        onVersionTap = onVersionTap,
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
private fun SettingsIndex(
    company: CompanyView,
    me: Me,
    role: String?,
    usage: Usage?,
    devMode: Boolean,
    onOpen: (SettingsSection) -> Unit,
    onCopyNumber: (String) -> Unit,
    onOpenDiagnostics: () -> Unit,
    onVersionTap: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        ScreenTitle("Settings")
        IdentityCard(company, me, role, onCopyNumber)
        usage?.let { UsageStatusCard(it, onOpen = { onOpen(SettingsSection.Usage) }) }
        PaperCard(Modifier.fillMaxWidth()) {
            SettingsSection.entries.forEachIndexed { index, section ->
                if (index > 0) RowDivider()
                SettingsIndexRow(section, onOpen)
            }
        }
        // #198: the unlocked Diagnostics row — quiet, last, its own card so
        // the everyday section list never changes shape.
        if (devMode) {
            PaperCard(Modifier.fillMaxWidth()) {
                DiagnosticsIndexRow(onOpenDiagnostics)
            }
        }
        VersionFooter(onVersionTap)
    }
}

/** The dev-mode Diagnostics entry (#198) — same row grammar, muted voice. */
@Composable
private fun DiagnosticsIndexRow(onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onOpen() }
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.BugReport,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "Diagnostics",
                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
            )
            Text(
                "Call flow, crash reports, device",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.outline,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Spacer(Modifier.width(8.dp))
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(18.dp),
        )
    }
}

/**
 * The quiet version line at the hub's foot — also the #198 easter-egg target
 * (seven quick taps). Deliberately no ripple and no haptic: a stray tap must
 * look and feel like nothing at all.
 */
@Composable
private fun VersionFooter(onTap: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Text(
        loonextWordmark(suffix = " ${BuildConfig.VERSION_NAME}"),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
        color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onTap,
            ),
    )
}

/** First-fetch stand-in for the hub: identity block + index rows, no avatars. */
@Composable
private fun SettingsHubSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        ScreenTitle("Settings")
        Box(
            Modifier
                .fillMaxWidth()
                .height(78.dp)
                .background(rememberShimmerBrush(), MaterialTheme.shapes.large),
        )
        PaperCard(Modifier.fillMaxWidth()) {
            SkeletonList(rows = 7, avatar = false)
        }
    }
}

/**
 * First-fetch stand-in for a settings section: shimmering lines inside the
 * section's own hairline card grammar (settings skeletons carry no avatars).
 */
@Composable
internal fun SettingsSectionSkeleton(cards: Int = 2) {
    repeat(cards) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = RoundedCornerShape(12.dp),
                )
                .padding(16.dp),
        ) {
            SkeletonBlock(132.dp, 14.dp)
            Spacer(Modifier.height(14.dp))
            SkeletonBlock(224.dp, 11.dp)
            Spacer(Modifier.height(8.dp))
            SkeletonBlock(176.dp, 11.dp)
        }
    }
}

/** The ink identity tile: avatar, who you are, and the workspace number. */
@Composable
private fun IdentityCard(
    company: CompanyView,
    me: Me,
    role: String?,
    onCopyNumber: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(46.dp)
                    .background(
                        MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.14f),
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initialsOf(me.display_name.ifBlank { company.name }),
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                )
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    me.display_name.ifBlank { company.name },
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOfNotNull(
                        role?.replaceFirstChar { it.uppercase() },
                        company.name,
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.55f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            val number = company.numbers
                .firstOrNull { it.status == NumberStatus.ACTIVE && it.number_e164 != null }
                ?.number_e164
            if (number != null) {
                Spacer(Modifier.width(8.dp))
                Surface(
                    onClick = {
                        haptics.tap()
                        onCopyNumber(number)
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.1f),
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            formatPhone(number),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                        )
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.Outlined.ContentCopy,
                            contentDescription = "Copy number",
                            modifier = Modifier.size(12.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The hub's usage whisper (#178): one calm line driven by the server's
 * `status`, never a meter or an "X of Y". 'quiet' is the overwhelming
 * default; 'pacing' and 'capped' surface the early warning here too. Tapping
 * opens the Usage section, where the specifics and the owner details live.
 */
@Composable
private fun UsageStatusCard(usage: Usage, onOpen: () -> Unit) {
    // Pre-checkout there is nothing truthful to whisper about yet.
    if (usage.included_segments <= 0L) return
    val haptics = rememberHaptics()
    val interaction = remember { MutableInteractionSource() }
    val caption = when (usage.status) {
        UsageStatus.CAPPED -> "SPENDING CAP"
        UsageStatus.PACING -> "PACING AHEAD"
        else -> "FAIR USE"
    }
    val captionColor = when (usage.status) {
        UsageStatus.CAPPED -> MaterialTheme.colorScheme.error
        UsageStatus.PACING ->
            if (isSystemInDarkTheme()) BrandColor.DarkAmber else BrandColor.Amber

        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        onClick = {
            haptics.tap()
            onOpen()
        },
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        interactionSource = interaction,
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interaction),
    ) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 15.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    caption,
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.12.em,
                    ),
                    color = captionColor,
                    modifier = Modifier.weight(1f),
                )
                resetsIn(usage.period_end)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
            // The line swaps with a quiet fade when the status changes.
            AnimatedContent(
                targetState = usage.status,
                transitionSpec = {
                    fadeIn(tween(durationMillis = 180)) togetherWith
                        fadeOut(tween(durationMillis = 120))
                },
                label = "hubUsageStatus",
            ) { status ->
                Text(
                    hubUsageLine(status, usage),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

/** The one calm sentence per status (#178); the section holds the rest. */
private fun hubUsageLine(status: String, usage: Usage): String = when (status) {
    UsageStatus.CAPPED ->
        if (capUseRatio(usage) >= 1.0) {
            "Spending cap reached. Sending and calling are paused until you raise it."
        } else {
            "${capUsePercent(usage)}% of your spending cap used. Sending and " +
                "calling pause at the cap."
        }

    UsageStatus.PACING -> {
        val projected = usage.overage_projection.projected_overage_cents
        "${pacingSubject(usage)} are pacing past your plan." +
            if (projected > 0) " About ${formatCents(projected)} extra at this pace." else ""
    }

    else -> "Well within fair use this month."
}

/** "resets in 18 days" from the usage period end; null when unknowable. */
private fun resetsIn(periodEnd: String?): String? {
    val end = periodEnd?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val days = Duration.between(Instant.now(), end).toDays()
    return when {
        days < 0 -> null
        days == 0L -> "resets today"
        days == 1L -> "resets tomorrow"
        else -> "resets in $days days"
    }
}

@Composable
private fun SettingsIndexRow(section: SettingsSection, onOpen: (SettingsSection) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onOpen(section) }
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                iconFor(section),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                section.title,
                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
            )
            Text(
                section.blurb,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.outline,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Spacer(Modifier.width(8.dp))
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(18.dp),
        )
    }
}

private fun iconFor(section: SettingsSection): ImageVector = when (section) {
    SettingsSection.Workspace -> Icons.Outlined.Storefront
    SettingsSection.Hours -> Icons.Outlined.Schedule
    SettingsSection.Calling -> Icons.Outlined.Call
    SettingsSection.Team -> Icons.Outlined.Group
    SettingsSection.Numbers -> Icons.Outlined.Tag
    SettingsSection.Usage -> Icons.Outlined.DataUsage
    SettingsSection.Billing -> Icons.Outlined.CreditCard
    SettingsSection.Notifications -> Icons.Outlined.Notifications
    SettingsSection.Profile -> Icons.Outlined.Person
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
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val backInteraction = remember { MutableInteractionSource() }
            Surface(
                onClick = onBack,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 1.dp,
                interactionSource = backInteraction,
                modifier = Modifier
                    .size(44.dp)
                    .pressScale(backInteraction),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "Back to settings",
                        modifier = Modifier.size(17.dp),
                    )
                }
            }
            Spacer(Modifier.width(14.dp))
            Text(
                title,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
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

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Phone number", text))
}
