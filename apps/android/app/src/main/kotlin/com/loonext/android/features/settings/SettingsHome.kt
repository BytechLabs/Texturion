package com.loonext.android.features.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.rememberShimmerBrush
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

    // #176 cache-first: the company view paints instantly from StoreCache on
    // every visit after the first in-process fetch; refreshKey bumps
    // (realtime, retry) are silent revalidation.
    val companyState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.settingsHome(companyId),
        refreshKey = refreshKey,
    ) { repo.company(companyId) }
    // The hub's "texts this period" meter shares the Usage section's key; the
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
                        onOpen = { section = it },
                        onCopyNumber = { number ->
                            copyToClipboard(context, number)
                            settingsScope.showMessage("Number copied.")
                        },
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
    onOpen: (SettingsSection) -> Unit,
    onCopyNumber: (String) -> Unit,
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
        usage?.let { UsageMeterCard(it) }
        PaperCard(Modifier.fillMaxWidth()) {
            SettingsSection.entries.forEachIndexed { index, section ->
                if (index > 0) RowDivider()
                SettingsIndexRow(section, onOpen)
            }
        }
    }
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

/** "Texts this period" — big Bricolage count over a lime meter. */
@Composable
private fun UsageMeterCard(usage: Usage) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 15.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "TEXTS THIS PERIOD",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.12.em,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
            Row(
                Modifier.padding(top = 8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                AnimatedContent(
                    targetState = usage.used_segments,
                    transitionSpec = {
                        (slideInVertically { it / 3 } + fadeIn()) togetherWith
                            (slideOutVertically { -it / 3 } + fadeOut())
                    },
                    label = "hubUsedSegments",
                ) { used ->
                    Text(
                        "$used",
                        style = MaterialTheme.typography.headlineLarge.copy(
                            fontSize = 38.sp,
                            letterSpacing = (-0.02).em,
                        ),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Text(
                    "of ${usage.included_segments} included",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp, bottom = 6.dp),
                )
            }
            val fraction = if (usage.included_segments > 0) {
                (usage.used_segments.toFloat() / usage.included_segments).coerceIn(0f, 1f)
            } else {
                0f
            }
            Box(
                Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainer),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(8.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.tertiary),
                )
            }
        }
    }
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
