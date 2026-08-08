package com.loonext.android.features.foryou

import com.loonext.android.ui.common.RefreshBox
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import com.loonext.android.core.dashboard.DashboardTiles
import com.loonext.android.core.dashboard.DashboardPanels
import com.loonext.android.core.snooze.parseInstantMillis
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.ui.common.rememberCacheFirst
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.LeadSourceReport
import com.loonext.android.core.model.PipelineReportResponse
import com.loonext.android.core.model.ResponseTimeReport
import com.loonext.android.core.model.SatisfactionReport
import com.loonext.android.core.model.ReferralMoment
import com.loonext.android.core.model.ReferralsView
import com.loonext.android.features.tasks.formatDue
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.callOutcomeLabel
import com.loonext.android.features.calls.callerDisplayName
import com.loonext.android.features.calls.isActionableMiss
import com.loonext.android.features.settings.SettingsSection
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import androidx.compose.runtime.rememberCoroutineScope
import com.loonext.android.core.model.SpamReviewItem
import com.loonext.android.core.model.forYouHeadlineWork
import com.loonext.android.core.model.spamReviewReason
import kotlinx.coroutines.launch
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import kotlinx.coroutines.delay

/**
 * /for-you — the default landing: Unassigned (every member since #416),
 * Waiting on you,
 * My tasks, Unread, and Recent calls (D43: the mobile entry point into the
 * Calls surface). Realtime events refetch the queue; every row deep-links
 * into [ThreadScreen] in place (task rows open their conversation — task
 * detail itself is the Tasks tab's surface, #154).
 *
 * Paper & Olive pass (screens 19/29 + the screen-18 activation grammar):
 * identity avatar top-left, a 44dp paper-circle bell (coral dot when unread —
 * opens the notifications route above the shell), Bricolage "For you" heading with a
 * one-line summary, then each queue section as a radius-22 paper card of rows.
 *
 * [onOpenCalls] is the shell's navigation to the full Calls surface — the
 * "View all" affordance hides until the integrator wires it.
 * [onViewedConversationChanged] reports which thread this tab has open (null
 * when back on the queue) so the shell's inbound toast can suppress itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForYouTab(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onOpenCalls: (() -> Unit)? = null,
    onOpenThread: ((conversationId: String) -> Unit)? = null,
    onOpenNotifications: (() -> Unit)? = null,
    /**
     * #310/#503: the waiting-room card's doors.
     *
     * REQUIRED, and typed. Both were nullable-with-a-default and the settings
     * one was a bare String, which is how `Shell.kt` came to call this without
     * passing either: three buttons on the first surface a new workspace sees
     * invoked a null callback and did nothing at all. A default of null on a
     * navigation callback turns "nobody wired this" into a silent dead tap
     * instead of a compile error, so there is no default now.
     */
    onOpenContacts: () -> Unit,
    onOpenSettings: (SettingsSection) -> Unit,
    /**
     * #508: the response-time card's "N leads nobody answered" row, into the
     * inbox filtered to exactly those. Required for the same reason as the two
     * above — this row shipped inert on both phones while web linked it.
     */
    onOpenUnanswered: () -> Unit,
) {
    // Threads and notifications are ROUTES above the shell now (founder
    // mandate: nothing pushed shows the pill nav) — this tab is only ever the
    // For You list itself.
    // #176 cache-first: renders instantly from StoreCache on every visit after
    // the first in-process fetch; refreshKey bumps are always silent revalidation.
    var refreshKey by remember { mutableStateOf(0) }
    // #342: the review strip's two answers are one-shot mutations; the strip
    // refetches itself afterwards rather than patching a cache by hand.
    val coroutines = rememberCoroutineScope()
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.forYou(companyId),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.forYou(companyId) }

    // #239: the response-time report. Its own cache-first read rather than a
    // section of /v1/for-you, because it answers a different question (how are
    // we doing) from the queue (what needs doing) and it is windowed — folding
    // it in would make the whole queue refetch every time somebody switched
    // 7/30/90 days.
    var responseDays by remember { mutableStateOf(30) }
    val responseTime = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.responseTime(companyId, responseDays),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.responseTime(companyId, responseDays) }

    // #313: how customers rate the work. Shares the response-time window —
    // "how fast did we answer" and "did it land" are one question asked over
    // one period, and two independent window pickers on one screen is how a
    // crew ends up comparing a fortnight against a quarter without noticing.
    val satisfaction = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.satisfaction(companyId, responseDays),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.satisfaction(companyId, responseDays) }

    // #354: quoted, won, still out. Its own cache-first read for the same
    // reason as the response time above, and fixed at 30 days — the pipeline
    // question is "how did this month's quotes do", not a window somebody
    // tunes.
    val pipeline = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.pipeline(companyId, 30),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.pipeline(companyId) }

    // #288: has this crew earned the referral ask? Only for somebody who could
    // collect the reward — the whole referrals router is behind billing.manage,
    // so asking on a tech's phone would be a 403 on every trip through the home
    // screen for a card they were never going to be shown.
    val canCollectReferral = MemberRole.has(
        me.memberships.firstOrNull { it.company_id == companyId }?.role,
        Capability.BILLING_MANAGE,
    )
    val referralMoment = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.referralMoment(companyId),
        refreshKey = refreshKey,
        enabled = canCollectReferral,
    ) { graph.forYouRepo.referralMoment(companyId) }
    // The link is a SECOND read, and only once the owner has said yes to being
    // asked. Most trips through this screen never need it.
    var referralOpened by remember(companyId) { mutableStateOf(false) }
    var referralDismissed by remember(companyId) { mutableStateOf(false) }
    val referralLink = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.referrals(companyId),
        refreshKey = refreshKey,
        enabled = referralOpened,
    ) { graph.forYouRepo.referrals(companyId) }

    // #301: where this month's customers came from. Its own cache-first read
    // on the same 30-day window as the pipeline, and last of the four cards
    // because it answers a slower question — the three above it are about this
    // week's work, this one is about next month's spending.
    val leadSources = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.leadSources(companyId, 30),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.leadSources(companyId) }

    // #342: spam marks that do not look like spam. Empty on nearly every day,
    // and deliberately NOT a badge or a push — a signal you find, not one that
    // finds you.
    val spamReview = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.spamReview(companyId),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.spamReview(companyId).data }

    // Recent calls (#165): the 3 newest sessions, refetched on the same
    // realtime ticks as the queue (call.updated is in the filter below).
    val callsRepo = remember(graph) { CallsRepository(graph.api) }
    val recentCalls = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.recentCalls(companyId),
        refreshKey = refreshKey,
    ) { callsRepo.calls(companyId, limit = 3).data }
    // Coral dot on the bell — refreshed on the same ticks (the feed derives
    // from message/task/call activity). A miss keeps the last known count.
    // #201: the refetch goes through the shared mark guards, so a tick that
    // lands during an in-flight mark POST can't write the pre-mark server
    // count back into the key every badge surface reads.
    val unreadState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.unreadNotifications(companyId),
        refreshKey = refreshKey,
    ) {
        val readState = graph.notificationsReadState.forCompany(companyId)
        val fetched = graph.notificationsRepo.unreadCount(companyId).count
        // Cache read AFTER the fetch: a mark can start mid-request, and its
        // optimistic write is the value that must win.
        readState.reconcileFetched(
            cached = graph.storeCache
                .flowOf<Int>(CacheKeys.unreadNotifications(companyId)).value,
            fetched = fetched,
        )
    }
    val unreadNotifications = (unreadState as? LoadState.Ready)?.value ?: 0
    // Any conversation/task/call movement can change the queue — refetch quietly.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event.startsWith("message.") ||
                event.event.startsWith("conversation.") ||
                event.event.startsWith("task.") ||
                event.event.startsWith("call.")
            ) {
                refreshKey++
            }
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // #215: heal a frame missed while backgrounded/blurred by revalidating on
    // return to the foreground.
    ResyncOnResume(companyId) { refreshKey++ }

    // #540: which panels this member has put away, from the membership already in
    // hand. Held locally as well as read from [me] because the toggle is
    // OPTIMISTIC — the sheet's switch has to move on the tap, not a round trip
    // later, and `me` is owned by the shell and will not refresh until the next
    // app load. Seeded per membership so a genuine refresh reseeds it.
    val serverHidden = me.memberships
        .firstOrNull { it.company_id == companyId }
        ?.dashboard_hidden
        .orEmpty()
    var hidden by remember(companyId, serverHidden) { mutableStateOf(serverHidden) }
    var customiseOpen by remember { mutableStateOf(false) }
    var customiseFailed by remember { mutableStateOf(false) }

    // Pull-to-refresh rides the same silent refreshKey revalidation the
    // realtime ticks use (cache-first: rows never blank underneath); the
    // crest spins just long enough to acknowledge the gesture.
    var pullRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(pullRefreshing) {
        if (pullRefreshing) {
            delay(650)
            pullRefreshing = false
        }
    }
    val haptics = rememberHaptics()

    // #540: the whole set goes up, matching the route — the body describes the
    // screen they want rather than a delta against a state two devices may
    // disagree about. On failure the row goes back to exactly what it was, so a
    // dropped connection never leaves the phone showing a preference the server
    // has not got.
    fun toggle(panel: DashboardPanels.Panel, visible: Boolean) {
        val before = hidden
        val next = DashboardPanels.normalise(
            if (visible) before.filterNot { it == panel.id } else before + panel.id,
        ).map { it.id }
        hidden = next
        customiseFailed = false
        coroutines.launch {
            runCatching { graph.meRepo.setDashboardHidden(companyId, next) }
                .onFailure {
                    hidden = before
                    customiseFailed = true
                }
        }
    }

    if (customiseOpen) {
        CustomiseSheet(
            hidden = hidden,
            onToggle = ::toggle,
            onDismiss = {
                customiseOpen = false
                customiseFailed = false
            },
            failed = customiseFailed,
        )
    }

    when (val current = state) {
        // First fetch only (#176 keeps every revisit cached): shimmer in the
        // queue-card grammar, not a spinner.
        is LoadState.Loading -> ForYouSkeleton(modifier)
        is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ }, modifier)
        is LoadState.Ready -> RefreshBox(
            isRefreshing = pullRefreshing,
            onRefresh = {
                haptics.tick()
                pullRefreshing = true
                refreshKey++
            },
            modifier = modifier,
        ) {
            ForYouList(
                forYou = current.value,
                // #342: spam marks that do not look like spam.
                spamReview = (spamReview as? LoadState.Ready)?.value.orEmpty(),
                onAnswerSpamReview = { conversationId, notSpam ->
                    coroutines.launch {
                        runCatching {
                            graph.forYouRepo.answerSpamReview(
                                companyId, conversationId, notSpam,
                            )
                        }
                        refreshKey += 1
                    }
                },
                recentCalls = recentCalls,
                // #239: the response-time report and its window.
                responseTime = (responseTime as? LoadState.Ready)?.value,
                responseDays = responseDays,
                onResponseWindow = { responseDays = it },
                // #313: null while it loads, same as its neighbour.
                satisfaction = (satisfaction as? LoadState.Ready)?.value,
                // #354: null while it loads, and the card says nothing.
                pipeline = (pipeline as? LoadState.Ready)?.value,
                leadSources = (leadSources as? LoadState.Ready)?.value,
                // #288: null while it loads or when this member could never
                // collect the reward, and the card renders nothing.
                referralMoment = if (referralDismissed) {
                    null
                } else {
                    (referralMoment as? LoadState.Ready)?.value
                },
                referralLink = (referralLink as? LoadState.Ready)?.value,
                referralOpened = referralOpened,
                onOpenReferral = { referralOpened = true },
                onDismissReferral = {
                    // Optimistic: the card goes on the tap, not a round trip
                    // later. A refusal that feels slower than acceptance is a
                    // refusal somebody stops making.
                    referralDismissed = true
                    coroutines.launch {
                        runCatching { graph.forYouRepo.dismissReferralAsk(companyId) }
                    }
                },
                unreadNotifications = unreadNotifications,
                me = me,
                onOpenConversation = { onOpenThread?.invoke(it) },
                onOpenCalls = onOpenCalls,
                onOpenNotifications = { onOpenNotifications?.invoke() },
                onOpenContacts = onOpenContacts,
                onOpenSettings = onOpenSettings,
                onOpenUnanswered = onOpenUnanswered,
                // #540: what this member has put away, and the door to change it.
                hidden = hidden,
                onCustomise = { customiseOpen = true },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun ForYouList(
    forYou: ForYou,
    spamReview: List<SpamReviewItem>,
    onAnswerSpamReview: (conversationId: String, notSpam: Boolean) -> Unit,
    recentCalls: LoadState<List<Call>>,
    /** #239: null while it loads — the card says so rather than showing a zero. */
    responseTime: ResponseTimeReport?,
    responseDays: Int,
    onResponseWindow: (Int) -> Unit,
    /** #313: null while it loads — the card says so rather than showing a zero. */
    satisfaction: SatisfactionReport?,
    /** #354: null while it loads — the card renders nothing rather than zeroes. */
    pipeline: PipelineReportResponse?,
    /** #301: null while it loads, and the card says nothing either. */
    leadSources: LeadSourceReport?,
    referralMoment: ReferralMoment?,
    referralLink: ReferralsView?,
    referralOpened: Boolean,
    onOpenReferral: () -> Unit,
    onDismissReferral: () -> Unit,
    unreadNotifications: Int,
    me: Me,
    onOpenConversation: (String) -> Unit,
    onOpenCalls: (() -> Unit)?,
    onOpenNotifications: () -> Unit,
    /** #310/#503: the waiting-room card's doors. Required — see ForYouTab. */
    onOpenContacts: () -> Unit,
    onOpenSettings: (SettingsSection) -> Unit,
    /** #508: the response-time card's unanswered row. Required — see ForYouTab. */
    onOpenUnanswered: () -> Unit,
    /** #540: the panels this member has put away. Empty for almost everybody. */
    hidden: List<String>,
    /** #540: opens the Customise sheet. */
    onCustomise: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // #306: what each section HOLDS, not how many rows came back. Counting the
    // rows meant a member 60 conversations behind read "20 things need you",
    // and the queue looked finished after twenty items — the product reassuring
    // the crew at exactly the moment it should alarm them. Falling back to the
    // row count keeps a build running ahead of the Worker on today's behaviour.
    val t = forYou.totals
    val waitingTotal = t?.waiting_on_you ?: forYou.waiting_on_you.size
    val tasksTotal = t?.my_tasks ?: forYou.my_tasks.size
    val unreadTotal = t?.unread ?: forYou.unread.size
    val triageConvTotal = t?.triage_conversations ?: forYou.triage?.conversations?.size ?: 0
    val triageTaskTotal = t?.triage_tasks ?: forYou.triage?.tasks?.size ?: 0
    val triageCount = triageConvTotal + triageTaskTotal
    val followUpTotal = t?.follow_ups ?: forYou.follow_ups.size
    val total = forYouHeadlineWork(forYou)

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 24.dp),
    ) {
        item(key = "header") {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AvatarCircle(me.display_name.ifBlank { null }, size = 40.dp, fontSize = 13.sp)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // #540: quiet, and beside the bell that was already here.
                    // THE DOT MATTERS MORE THAN IT LOOKS LIKE IT DOES — somebody
                    // who put two panels away in April has no other way to find
                    // out why their screen is shorter than a colleague's, and
                    // "the app is missing the pipeline card" is a support
                    // conversation nobody can win.
                    CircleIconButton(
                        icon = Icons.Outlined.Tune,
                        contentDescription = if (hidden.isEmpty()) {
                            "Customise this screen"
                        } else {
                            val n = DashboardPanels.normalise(hidden).size
                            "Customise this screen — $n " +
                                (if (n == 1) "panel" else "panels") + " put away"
                        },
                        onClick = onCustomise,
                        showDot = hidden.isNotEmpty(),
                    )
                    CircleIconButton(
                        icon = Icons.Outlined.Notifications,
                        contentDescription = "Notifications",
                        onClick = onOpenNotifications,
                        showDot = unreadNotifications > 0,
                    )
                }
            }
        }

        // #310: only while the carriers have it. Above the queue because during
        // the wait the queue is empty by definition — texting is what fills it,
        // and that is exactly what has not started yet.
        item(key = "while-you-wait") {
            WhileYouWait(
                company = me.company,
                onOpenContacts = onOpenContacts,
                onOpenTeam = { onOpenSettings(SettingsSection.Team) },
                onOpenHours = { onOpenSettings(SettingsSection.Hours) },
                modifier = Modifier.padding(top = 14.dp),
            )
        }

        // #239 — the claim we sell, measured. Above the queue because the arc
        // is the reason a contractor stays, and it is a result to read rather
        // than a task to do.
        // #540: each measure can be put away from Customise. Gated on the ITEM
        // rather than inside the card, so a hidden panel holds no list slot and
        // leaves no gap where a card used to be.
        if (DashboardPanels.isVisible(hidden, DashboardPanels.Panel.RESPONSE_TIME)) {
            item(key = "response-time") {
                ResponseTimeCard(
                    report = responseTime,
                    days = responseDays,
                    onWindow = onResponseWindow,
                    onOpenUnanswered = onOpenUnanswered,
                )
            }
        }

        // #354: beside its neighbour, and absent entirely until there is
        // something true to say.
        if (DashboardPanels.isVisible(hidden, DashboardPanels.Panel.PIPELINE)) {
            item(key = "pipeline") { PipelineCard(report = pipeline) }
        }

        // #301: last of the four, because it answers a slower question than the
        // three above it — next month's spending rather than this week's work.
        // #540: its own item now rather than sharing the pipeline's, because the
        // two are separately hideable and a shared slot cannot hide one of them.
        if (DashboardPanels.isVisible(hidden, DashboardPanels.Panel.LEAD_SOURCES)) {
            item(key = "lead-sources") { LeadSourcesCard(report = leadSources) }
        }

        // #313: directly under the speed number on purpose. How fast you
        // answered and whether it landed are one thought, and separating them
        // onto two screens is how a business optimises the first while the
        // second quietly slides.
        if (DashboardPanels.isVisible(hidden, DashboardPanels.Panel.SATISFACTION)) {
            item(key = "satisfaction") {
                SatisfactionCard(
                    report = satisfaction,
                    days = responseDays,
                    onWindow = onResponseWindow,
                    onOpenPoor = onOpenUnanswered,
                )
            }
        }

        // #288: after the numbers, never before them. The ask is earned by the
        // measures above it, and reading those first is what makes it land as
        // earned rather than as an interruption. NOT one of the hideable panels:
        // it already has its own "Not now", and a prompt with two ways to put it
        // away is a prompt where one of them stops being honoured.
        item(key = "referral-ask") {
            ReferralAskCard(
                moment = referralMoment,
                referrals = referralLink,
                opened = referralOpened,
                onOpen = onOpenReferral,
                onDismiss = onDismissReferral,
            )
        }

        item(key = "title") {
            Column(Modifier.padding(top = 15.dp)) {
                ScreenTitle("For you")
                Text(
                    when {
                        total == 0 -> "You're all caught up"
                        total == 1 -> "1 thing needs you · otherwise you're caught up"
                        else -> "$total things need you · otherwise you're caught up"
                    },
                    modifier = Modifier.padding(top = 5.dp),
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // #342: before the caught-up well, because "you're all caught up" is
        // not true if somebody has been texting a thread nobody can see.
        if (spamReview.isNotEmpty()) {
            item(key = "spam-review") {
                QueueSection(
                    "Marked spam, still texting",
                    count = spamReview.size,
                    modifier = Modifier.animateItem(),
                ) {
                    spamReview.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        SpamReviewRow(
                            item = row,
                            onOpen = { onOpenConversation(row.conversation_id) },
                            onAnswer = { notSpam ->
                                onAnswerSpamReview(row.conversation_id, notSpam)
                            },
                        )
                    }
                }
            }
        }

        // The activation/empty variant (screen-18 grammar): a centered inset
        // well instead of the queue cards.
        if (total == 0) {
            item(key = "caught-up") { CaughtUpWell(Modifier.animateItem()) }
        }

        // #540: the four queues are emitted in the order the SHARED rule gives,
        // so the phone leads with the same thing the laptop does. Web spends its
        // horizontal room on a strip of four tiles; a 375dp screen cannot afford
        // two rows of chrome above the work, so here the same decision orders the
        // sections themselves — which is all the strip was ever an index of.
        val now = System.currentTimeMillis()
        // An unparseable stamp reads as "just now" rather than as ancient. The age
        // can therefore be younger than the truth and never older, which is the
        // safe direction for a number that decides what somebody looks at first.
        fun age(iso: String?): Long =
            iso?.let { parseInstantMillis(it) }?.let { (now - it).coerceAtLeast(0L) } ?: 0L
        val queueOrder = DashboardTiles.order(
            DashboardTiles.Input(
                unassignedAges = (forYou.triage?.conversations?.map { age(it.last_message_at) }
                    ?: emptyList()) +
                    // A triage task carries no timestamp on this payload, so it
                    // counts towards the number without claiming an age.
                    (forYou.triage?.tasks?.map { 0L } ?: emptyList()),
                waiting = forYou.waiting_on_you.map {
                    DashboardTiles.Row(age(it.last_message_at), it.has_overdue_task)
                },
                tasks = forYou.my_tasks.map {
                    DashboardTiles.Row(it.due_at?.let(::age), it.overdue)
                },
                unreadAges = forYou.unread.map { age(it.last_message_at) },
            ),
        ).map { it.tile }

        val unassignedSection: LazyListScope.() -> Unit = {
            forYou.triage
                ?.takeIf { it.conversations.isNotEmpty() || it.tasks.isNotEmpty() }
                ?.let { triage ->
                    item(key = "triage") {
                        QueueSection(
                            // #416/D53: "Triage" was dispatcher language for a
                            // section only owners could see. It is the whole
                            // crew's queue now, and the word for it everywhere
                            // else in the product is "unassigned".
                            "Unassigned",
                            count = triageCount,
                            // Sections glide as queues above them empty or fill.
                            modifier = Modifier.animateItem(),
                        ) {
                            triage.conversations.forEachIndexed { index, row ->
                                if (index > 0) RowDivider()
                                PersonRow(
                                    name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                    why = relativeTime(row.last_message_at),
                                    unread = row.unread,
                                    chipLabel = if (row.unread) "New lead" else null,
                                    onClick = { onOpenConversation(row.conversation_id) },
                                )
                            }
                            triage.tasks.forEachIndexed { index, row ->
                                if (index > 0 || triage.conversations.isNotEmpty()) RowDivider()
                                TaskQueueRow(
                                    title = row.title,
                                    overdue = row.overdue,
                                    dueAt = row.due_at,
                                    onClick = { onOpenConversation(row.conversation_id) },
                                )
                            }
                        }
                    }
                }
        }
        val waitingSection: LazyListScope.() -> Unit = {
            if (forYou.waiting_on_you.isNotEmpty()) {
                item(key = "waiting") {
                    QueueSection(
                        "Waiting on you",
                        count = waitingTotal,
                        modifier = Modifier.animateItem(),
                    ) {
                        forYou.waiting_on_you.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                why = relativeTime(row.last_message_at),
                                unread = row.unread,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }
            }
        }
        val tasksSection: LazyListScope.() -> Unit = {
            if (forYou.my_tasks.isNotEmpty()) {
                item(key = "tasks") {
                    QueueSection(
                        "My tasks",
                        count = tasksTotal,
                        modifier = Modifier.animateItem(),
                    ) {
                        forYou.my_tasks.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            TaskQueueRow(
                                title = row.title,
                                overdue = row.overdue,
                                dueAt = row.due_at,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }
            }
        }
        val unreadSection: LazyListScope.() -> Unit = {
            if (forYou.unread.isNotEmpty()) {
                item(key = "unread") {
                    QueueSection(
                        "Unread",
                        count = unreadTotal,
                        modifier = Modifier.animateItem(),
                    ) {
                        forYou.unread.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                why = relativeTime(row.last_message_at),
                                unread = true,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }
            }
        }

        // NOT in the reorderable set: reminders a member set for themselves keep
        // the top of the queue, because they are there because somebody asked to
        // be reminded — which outranks whatever merely happens to be urgent today.
        // #293: ABOVE "Waiting on you". A quote nobody answered is the most
        // valuable thing in the business to be reminded about, and unlike
        // every section below it, this one only appears because the member
        // asked for it — so it has earned the top of the queue.
        if (forYou.follow_ups.isNotEmpty()) {
            item(key = "follow-ups") {
                QueueSection(
                    "Chase these",
                    count = followUpTotal,
                    modifier = Modifier.animateItem(),
                ) {
                    forYou.follow_ups.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        PersonRow(
                            name = row.contact?.name
                                ?: formatPhone(row.contact?.phone_e164),
                            // The REASON, not the last-message time: it is what
                            // the member wrote down, and the only thing that
                            // makes the card actionable three days later.
                            // "Chase the quote" is a job; "Chase this" is a
                            // chore.
                            why = row.note?.takeIf { it.isNotBlank() }
                                ?: "No reply since ${relativeTime(row.last_message_at)}",
                            unread = row.unread,
                            onClick = { onOpenConversation(row.conversation_id) },
                        )
                    }
                }
            }
        }

        queueOrder.forEach { tile ->
            when (tile) {
                DashboardTiles.Tile.UNASSIGNED -> unassignedSection()
                DashboardTiles.Tile.WAITING -> waitingSection()
                DashboardTiles.Tile.TASKS -> tasksSection()
                DashboardTiles.Tile.UNREAD -> unreadSection()
            }
        }

        // Recent calls (#165/D43) — the mobile doorway into the Calls
        // surface. Hidden entirely while there are no calls; an honest error
        // line when the log couldn't load.
        // #540: and hideable, unlike everything above it in the queue. Calls
        // already happened — this is history a member reads, not work they owe
        // anybody, so it is the one section here that can come off.
        if (DashboardPanels.isVisible(hidden, DashboardPanels.Panel.RECENT_CALLS)) {
            when (recentCalls) {
                is LoadState.Loading -> Unit
                is LoadState.Failed -> item(key = "calls-error") {
                    Column(Modifier.animateItem().padding(top = 14.dp)) {
                        RecentCallsHeader(onOpenCalls)
                        Text(
                            "Couldn't load recent calls.",
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 6.dp, top = 2.dp),
                        )
                    }
                }

                is LoadState.Ready -> if (recentCalls.value.isNotEmpty()) {
                    item(key = "calls") {
                        Column(Modifier.animateItem().padding(top = 14.dp)) {
                            RecentCallsHeader(onOpenCalls)
                            PaperCard(Modifier.fillMaxWidth()) {
                                recentCalls.value.forEachIndexed { index, call ->
                                    if (index > 0) RowDivider()
                                    RecentCallRow(
                                        call = call,
                                        onClick = call.conversation_id?.let { id ->
                                            { onOpenConversation(id) }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Tracked micro-header + a radius-22 paper card of rows. */
@Composable
private fun QueueSection(
    label: String,
    count: Int? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.padding(top = 14.dp)) {
        SectionHeader(label, count = count)
        PaperCard(Modifier.fillMaxWidth()) { content() }
    }
}

/** "RECENT CALLS" micro-header with the olive "View all" affordance. */
@Composable
private fun RecentCallsHeader(onOpenCalls: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "RECENT CALLS",
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.12.em,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
            modifier = Modifier.weight(1f),
        )
        if (onOpenCalls != null) {
            Text(
                "View all",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .clickable(onClick = onOpenCalls)
                    .padding(4.dp),
            )
        }
    }
}

/**
 * Queue row: 38dp tinted avatar, 13.5sp SemiBold name (+ lime chip or coral
 * unread dot), 11.5sp muted why-line, muted 15dp arrow.
 */
@Composable
private fun PersonRow(
    name: String?,
    why: String,
    unread: Boolean,
    chipLabel: String? = null,
    onClick: () -> Unit,
) {
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = pressSource,
                indication = LocalIndication.current,
                onClick = onClick,
            )
            .pressScale(pressSource, pressed = 0.98f)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        AvatarCircle(name, size = 38.dp, fontSize = 12.sp)
        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    name?.takeIf { it.isNotBlank() } ?: "Unknown",
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (chipLabel != null) {
                    DsChip(chipLabel)
                } else if (unread) {
                    AttentionDot(size = 7.dp)
                }
            }
            Text(
                why,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        RowArrow()
    }
}

/** Task row: 22dp outline ring, 13.5sp SemiBold title, due/overdue why-line. */
@Composable
private fun TaskQueueRow(title: String, overdue: Boolean, dueAt: String?, onClick: () -> Unit) {
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = pressSource,
                indication = LocalIndication.current,
                onClick = onClick,
            )
            .pressScale(pressSource, pressed = 0.98f)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .border(1.8.dp, MaterialTheme.colorScheme.outline, CircleShape),
        )
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                when {
                    overdue -> "Overdue task"
                    // formatDue, NOT relativeTime: relativeTime measures time
                    // ELAPSED, so every future due date came out as "Due now".
                    dueAt != null -> "Due ${formatDue(dueAt)}"
                    else -> "Open task"
                },
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.5.sp,
                    fontWeight = if (overdue) FontWeight.SemiBold else FontWeight.Normal,
                ),
                // Overdue = the coral attention mark, never an error red
                // (calm system).
                color = if (overdue) {
                    coralColor()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                },
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        RowArrow()
    }
}

/** Call row: 34dp avatar, outcome why-line (coral only for an actionable miss). */
@Composable
private fun RecentCallRow(call: Call, onClick: (() -> Unit)?) {
    val name = callerDisplayName(call)
    val actionable = isActionableMiss(call)
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .let { base ->
                if (onClick != null) {
                    base
                        .clickable(
                            interactionSource = pressSource,
                            indication = LocalIndication.current,
                            onClick = onClick,
                        )
                        .pressScale(pressSource, pressed = 0.98f)
                } else {
                    base
                }
            }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        AvatarCircle(name, size = 34.dp, fontSize = 11.sp)
        Column(Modifier.weight(1f)) {
            Text(
                name,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                callOutcomeLabel(call),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.5.sp,
                    fontWeight = if (actionable) FontWeight.SemiBold else FontWeight.Normal,
                ),
                color = if (actionable) {
                    coralColor()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Text(
            relativeTime(call.started_at),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
        )
    }
}

/** Screen-18 activation grammar, adapted: a centered radius-26 inset well. */
@Composable
private fun CaughtUpWell(modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth().padding(top = 15.dp),
    ) {
        Column(
            Modifier.padding(horizontal = 22.dp, vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "ALL CAUGHT UP",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Nothing needs you right now. New messages, tasks, and missed calls land here first.",
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

/**
 * First-fetch stand-in in the real For You grammar: identity/bell circles,
 * display title block, then two shimmering queue cards of avatar rows.
 * Failed and cached states never see this (#176).
 */
@Composable
private fun ForYouSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(start = 18.dp, end = 18.dp, top = 8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SkeletonBlock(40.dp, 40.dp, shape = CircleShape)
            SkeletonBlock(44.dp, 44.dp, shape = CircleShape)
        }
        Spacer(Modifier.height(15.dp))
        SkeletonBlock(168.dp, 30.dp)
        Spacer(Modifier.height(9.dp))
        SkeletonBlock(236.dp, 12.dp)
        Spacer(Modifier.height(21.dp))
        PaperCard(Modifier.fillMaxWidth()) { SkeletonList(rows = 3) }
        Spacer(Modifier.height(14.dp))
        PaperCard(Modifier.fillMaxWidth()) { SkeletonList(rows = 2) }
    }
}

/** 44dp paper circle icon button; optional coral dot (unread notifications). */
@Composable
private fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    showDot: Boolean = false,
) {
    val haptics = rememberHaptics()
    val pressSource = remember { MutableInteractionSource() }
    Surface(
        onClick = {
            haptics.tap()
            onClick()
        },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 1.dp,
        interactionSource = pressSource,
        modifier = Modifier.size(44.dp).pressScale(pressSource),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(17.dp))
            // Animated so the coral dot pops in and out instead of blinking.
            AnimatedContent(
                targetState = showDot,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp),
                label = "attentionDot",
            ) { dot ->
                if (dot) AttentionDot(size = 8.dp)
            }
        }
    }
}

/** Tinted identity circle (secondaryContainer + SemiBold initials). */
@Composable
private fun AvatarCircle(name: String?, size: Dp, fontSize: TextUnit) {
    Box(
        Modifier
            .size(size)
            .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = fontSize,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

/** The muted 15dp trailing arrow on tappable queue rows. */
@Composable
private fun RowArrow() {
    Icon(
        Icons.AutoMirrored.Outlined.ArrowForward,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.outline,
        modifier = Modifier.size(15.dp),
    )
}

/** Theme darkness derived from the applied scheme (user override safe). */
@Composable
private fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f

/** Coral attention mark for the active theme — attention, never error. */
@Composable
private fun coralColor(): Color =
    if (isDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral

/**
 * #342 — one spam mark that does not look like spam, and the two answers.
 *
 * The line says WHICH signal raised it: "4 messages since" reads as a counter,
 * "you texted them before marking this" reads as the mistake it probably is.
 * Both answers end the prompt — one lifts the mark, the other confirms it
 * without making the decision permanent again.
 */
@Composable
private fun SpamReviewRow(
    item: SpamReviewItem,
    onOpen: () -> Unit,
    onAnswer: (notSpam: Boolean) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 15.dp, vertical = 12.dp),
    ) {
        Text(
            item.contact?.name ?: formatPhone(item.contact?.phone_e164),
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp),
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            spamReviewReason(item),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
            color = if (item.we_texted_them) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onAnswer(true) }) { Text("Not spam") }
            TextButton(onClick = { onAnswer(false) }) { Text("Still spam") }
        }
    }
}
