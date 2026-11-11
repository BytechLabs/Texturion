package com.loonext.android.features.foryou

import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.RefreshBox
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import com.loonext.android.core.dashboard.DashboardTiles
import com.loonext.android.core.dashboard.DashboardLayout
import com.loonext.android.core.dashboard.DashboardLayouts
import com.loonext.android.core.dashboard.DashboardPanels
import com.loonext.android.core.dashboard.LayoutEntry
import com.loonext.android.core.i18n.AppStrings
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
import androidx.compose.foundation.layout.heightIn
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
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.snooze.DeferralKind
import com.loonext.android.core.snooze.SnoozeTiming
import com.loonext.android.core.snooze.followUpPresets
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.features.quotes.Quote
import com.loonext.android.features.quotes.QuotesRepository
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
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.Timestamp
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
import java.time.Instant
import com.loonext.android.ui.common.asButton
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import com.loonext.android.ui.common.spokenTimeOf

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
    /** #689: opens a task that has no conversation to open instead. */
    onOpenTask: ((taskId: String) -> Unit)? = null,
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

    /*
     * #287 — money asked for and not yet answered.
     *
     * Filtered SERVER-side: "outstanding" folds in an expiry derived on read,
     * so a client filtering the full list would re-implement that rule — and
     * the list is capped, so it would start silently dropping quotes on a busy
     * workspace.
     */
    val outstandingQuotes = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.outstandingQuotes(companyId),
        refreshKey = refreshKey,
    ) { QuotesRepository(graph.api).outstanding(companyId).data }

    /*
     * #287 — which rows have been chased in this session.
     *
     * The queue returns QUOTES and a deferral lives on the CONVERSATION, so
     * there is no field on a quote to read this back from. A second fetch per
     * row to answer a question that only matters for the seconds after a tap
     * would be a worse trade than forgetting it on the next cold start.
     */
    var chasedQuotes by remember(companyId) { mutableStateOf(emptySet<String>()) }
    // Chasing writes a note on a thread, which read_only cannot do. The queue
    // itself stays — the list is the report, and an observer who can see every
    // thread should be able to see the money in them.
    val canChase = MemberRole.has(
        me.memberships.firstOrNull { it.company_id == companyId }?.role,
        Capability.CONVERSATIONS_NOTE,
    )

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
    val membership = me.memberships.firstOrNull { it.company_id == companyId }
    val serverHidden = membership?.dashboard_hidden.orEmpty()
    var hidden by remember(companyId, serverHidden) { mutableStateOf(serverHidden) }
    // #736: the member's own arrangement, null for the default. Optimistic for
    // the same reason as the hidden set.
    val serverLayout = DashboardLayouts.normalise(membership?.dashboard_layout)
    var layout by remember(companyId, serverLayout) { mutableStateOf(serverLayout) }
    var editing by rememberSaveable { mutableStateOf(false) }
    var layoutFailed by remember { mutableStateOf(false) }
    var announcement by remember { mutableStateOf("") }

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
    fun saveHidden(next: List<String>) {
        val before = hidden
        val clean = DashboardPanels.normalise(next).map { it.id }
        if (clean == before) return
        hidden = clean
        coroutines.launch {
            runCatching { graph.meRepo.setDashboardHidden(companyId, clean) }
                .onFailure {
                    hidden = before
                    layoutFailed = true
                }
        }
    }

    // #736: every change saves at once. A failure puts the screen back exactly as
    // it was, so the phone never shows an arrangement the Worker has not got.
    fun saveLayout(next: DashboardLayout?, message: String) {
        val before = layout
        layout = next
        layoutFailed = false
        announcement = message
        coroutines.launch {
            runCatching { graph.meRepo.setDashboardLayout(companyId, next) }
                .onFailure {
                    layout = before
                    layoutFailed = true
                }
        }
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
          Box(Modifier.fillMaxSize()) {
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
                // #287: money asked for and not yet answered.
                outstandingQuotes =
                    (outstandingQuotes as? LoadState.Ready)?.value.orEmpty(),
                chasedQuotes = if (canChase) chasedQuotes else null,
                onChaseQuote = { quote, note ->
                    /*
                     * #293's ladder, not a fourth clock. Its own comment says
                     * "this afternoon" is a meaningless time to chase a quote,
                     * which is why that ladder exists — and the soonest rung on
                     * it is three days out.
                     *
                     * ONE TAP, no picker. The thread's own menu re-times it for
                     * the member who wants Friday.
                     */
                    val soonest = followUpPresets().firstOrNull()
                    if (soonest != null) {
                        chasedQuotes = chasedQuotes + quote.id
                        coroutines.launch {
                            val ok = runCatching {
                                MessagingRepository(graph.api).snooze(
                                    companyId = companyId,
                                    conversationId = quote.conversation_id,
                                    untilIso = Instant.ofEpochMilli(soonest.at)
                                        .toString(),
                                    note = note,
                                    kind = DeferralKind.FOLLOW_UP,
                                )
                            }.isSuccess
                            // Put the button back on failure. A row saying
                            // "Chasing" with nothing scheduled is worse than one
                            // that never claimed to.
                            if (!ok) chasedQuotes = chasedQuotes - quote.id
                        }
                    }
                },
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
                onOpenTask = { onOpenTask?.invoke(it) },
                onOpenCalls = onOpenCalls,
                onOpenNotifications = { onOpenNotifications?.invoke() },
                onOpenContacts = onOpenContacts,
                onOpenSettings = onOpenSettings,
                onOpenUnanswered = onOpenUnanswered,
                // #540/#736: what this member has put away, how the page is
                // arranged, and the door to change it.
                hidden = hidden,
                layout = layout,
                editing = editing,
                layoutFailed = layoutFailed,
                onToggleEditing = { editing = !editing },
                onSaveLayout = ::saveLayout,
                onSaveHidden = ::saveHidden,
                onAnnounce = { announcement = it },
                modifier = Modifier.fillMaxSize(),
            )
            LayoutAnnouncement(announcement)
          }
        }
    }
}

@Composable
private fun ForYouList(
    forYou: ForYou,
    spamReview: List<SpamReviewItem>,
    onAnswerSpamReview: (conversationId: String, notSpam: Boolean) -> Unit,
    recentCalls: LoadState<List<Call>>,
    /** #287: already server-filtered to unanswered — see QuotesRepository. */
    outstandingQuotes: List<Quote>,
    /** #287: chased this session. NULL when this member cannot write a note. */
    chasedQuotes: Set<String>?,
    /** #287: the quote, and the note to file against its thread. */
    onChaseQuote: (Quote, String) -> Unit,
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
    onOpenTask: (String) -> Unit,
    onOpenCalls: (() -> Unit)?,
    onOpenNotifications: () -> Unit,
    /** #310/#503: the waiting-room card's doors. Required — see ForYouTab. */
    onOpenContacts: () -> Unit,
    onOpenSettings: (SettingsSection) -> Unit,
    /** #508: the response-time card's unanswered row. Required — see ForYouTab. */
    onOpenUnanswered: () -> Unit,
    /** #540: the panels this member has put away. Empty for almost everybody. */
    hidden: List<String>,
    /** #736: the stored arrangement, null for the default. */
    layout: DashboardLayout?,
    /** #736: the member is arranging the page. */
    editing: Boolean,
    layoutFailed: Boolean,
    onToggleEditing: () -> Unit,
    /** #736: saves at once; the string is what a screen reader hears. */
    onSaveLayout: (DashboardLayout?, String) -> Unit,
    onSaveHidden: (List<String>) -> Unit,
    /** #736: a spoken confirmation with nothing to save. */
    onAnnounce: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = LocalAppLocale.current
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
        // Width is the SHELL's business, not this tab's: `Shell.kt` applies
        // `contentMaxWidth()` to every tab's content, capping at 640dp and
        // centring on tablets and foldables (#180). A second cap here was
        // briefly added and removed — see the note in DashboardScreenshotTest
        // about why a screenshot made it look necessary.
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
                    // #736: quiet, and beside the bell that was already here.
                    // While arranging, the same place says "Done".
                    if (editing) {
                        TextButton(
                            onClick = onToggleEditing,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(t("inbox.forYouDoneEditing")) }
                    } else {
                        CircleIconButton(
                            icon = Icons.Outlined.Tune,
                            contentDescription = t("inbox.forYouEditLayout"),
                            onClick = onToggleEditing,
                        )
                    }
                    CircleIconButton(
                        icon = Icons.Outlined.Notifications,
                        contentDescription = t("inbox.forYouNotificationsAria"),
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

        item(key = "title") {
            Column(Modifier.padding(top = 15.dp)) {
                ScreenTitle(t("inbox.forYouTitle"))
                Text(
                    when {
                        total == 0 -> t("inbox.forYouAllCaughtUp")
                        total == 1 -> t("inbox.forYouWorkOne")
                        else -> t("inbox.forYouWorkMany", "count" to total.toString())
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
                    t("inbox.forYouSectionSpamReview"),
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

        // #540: the urgency order the SHARED rule gives. It no longer orders
        // sections directly; it is what the DEFAULT layout follows, so a member
        // who never arranges the page keeps leading with whatever has gone wrong.
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

        // #736: the stored layout, else the default; then what the #540 hidden set
        // takes off. The page is exactly these panels, in this order.
        val effective = layout ?: DashboardLayouts.default(queueOrder)
        val shown = effective.panels.filterNot { DashboardLayouts.isHidden(hidden, it.id) }
        val onPage = shown.map { it.id }.toSet()

        // What each queue holds, for the line that says so when its panel is off the page.
        val queueCounts = mapOf(
            "follow_ups" to if (forYou.follow_ups.isNotEmpty()) followUpTotal else 0,
            "unassigned" to triageCount,
            "waiting" to if (forYou.waiting_on_you.isNotEmpty()) waitingTotal else 0,
            "tasks" to if (forYou.my_tasks.isNotEmpty()) tasksTotal else 0,
            "unread" to if (forYou.unread.isNotEmpty()) unreadTotal else 0,
        )

        fun say(key: String, vararg vars: Pair<String, String>): String =
            AppStrings.translate(locale, key, vars.toMap())

        fun nameOf(id: String): String = DashboardLayouts.label(id, locale)

        fun moveBy(id: String, delta: Int) {
            val next = DashboardLayouts.move(effective, id, delta)
            if (next === effective) return
            onSaveLayout(
                next,
                say(
                    "inbox.forYouPanelMoved",
                    "panel" to nameOf(id),
                    "position" to (next.panels.indexOfFirst { it.id == id } + 1).toString(),
                    "count" to next.panels.size.toString(),
                ),
            )
        }

        fun cycleSize(id: String) {
            val current = effective.panels.firstOrNull { it.id == id } ?: return
            val size = DashboardLayouts.nextSize(current.size)
            onSaveLayout(
                DashboardLayouts.resize(effective, id, size),
                say(
                    "inbox.forYouPanelResized",
                    "panel" to nameOf(id),
                    "size" to DashboardLayouts.sizeLabel(size, locale),
                ),
            )
        }

        fun takeOff(id: String) {
            onSaveLayout(
                DashboardLayouts.remove(effective, id),
                say("inbox.forYouPanelRemoved", "panel" to nameOf(id)),
            )
            // The #540 set stays in step, so a client that only reads it agrees.
            if (DashboardLayouts.isHideable(id) && !hidden.contains(id)) {
                onSaveHidden(hidden + id)
            }
        }

        fun putBack(id: String) {
            val message = say("inbox.forYouPanelAdded", "panel" to nameOf(id))
            if (effective.panels.none { it.id == id }) {
                onSaveLayout(DashboardLayouts.add(effective, id), message)
            } else {
                onAnnounce(message)
            }
            if (DashboardLayouts.isHidden(hidden, id)) onSaveHidden(hidden.filter { it != id })
        }

        // Before the panels, so work the member took off the page is still said
        // out loud above everything else.
        DashboardLayouts.QUEUE_IDS
            .filter { it !in onPage && (queueCounts[it] ?: 0) > 0 }
            .forEach { id ->
                item(key = "off-page-$id") {
                    OffPageLine(
                        panel = nameOf(id),
                        count = queueCounts[id] ?: 0,
                        onShow = { putBack(id) },
                    )
                }
            }

        if (editing) {
            item(key = "layout-toolbar") {
                LayoutToolbar(
                    addable = DashboardLayouts.PANEL_IDS.filter { it !in onPage },
                    onAdd = ::putBack,
                    onReset = {
                        onSaveLayout(null, "")
                        if (hidden.isNotEmpty()) onSaveHidden(emptyList())
                    },
                    failed = layoutFailed,
                )
            }
        }

        /*
         * One item per panel, in the member's order. An empty panel takes no space
         * unless the page is being arranged, when it shows a stub so it can still
         * be moved or taken off.
         */
        fun panelItem(entry: LayoutEntry, hasContent: Boolean, body: @Composable () -> Unit) {
            if (!hasContent && !editing) return
            item(key = entry.id) {
                Column(Modifier.animateItem()) {
                    if (editing) {
                        PanelEditBar(
                            id = entry.id,
                            size = entry.size,
                            onMove = { moveBy(entry.id, it) },
                            onResize = { cycleSize(entry.id) },
                            onRemove = { takeOff(entry.id) },
                            modifier = Modifier.padding(top = 14.dp),
                        )
                    }
                    if (hasContent) body() else PanelEmptyStub()
                }
            }
        }

        /*
         * #287: oldest first, the opposite of every other list here and
         * deliberately: a quote sent this morning needs nothing, and one sent nine
         * days ago is the one going cold.
         */
        val waitingQuotes = outstandingQuotes
            .sortedBy { it.sent_at ?: "" }
            .take(OUTSTANDING_QUOTES_LIMIT)

        shown.forEach { entry ->
            when (entry.id) {
                // NOT hideable: reminders the member set for themselves.
                "follow_ups" -> panelItem(entry, forYou.follow_ups.isNotEmpty()) {
                    QueueSection(t("inbox.forYouSectionChaseThese"), count = followUpTotal) {
                        forYou.follow_ups.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name
                                    ?: formatPhone(row.contact?.phone_e164),
                                // The REASON, not the last-message time: it is what
                                // the member wrote down, and the only thing that
                                // makes the card actionable three days later.
                                why = row.note?.takeIf { it.isNotBlank() }
                                    ?: t(
                                        "inbox.forYouWhyNoReply",
                                        "when" to relativeTime(row.last_message_at),
                                    ),
                                unread = row.unread,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }

                "unassigned" -> {
                    val triage = forYou.triage
                    panelItem(
                        entry,
                        triage != null && (triage.conversations.isNotEmpty() || triage.tasks.isNotEmpty()),
                    ) {
                        if (triage != null) {
                            // #416/D53: the whole crew's queue, and the word for it
                            // everywhere else in the product is "unassigned".
                            QueueSection(t("inbox.forYouSectionUnassigned"), count = triageCount) {
                                triage.conversations.forEachIndexed { index, row ->
                                    if (index > 0) RowDivider()
                                    PersonRow(
                                        name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                        why = relativeTime(row.last_message_at),
                                        whyAt = row.last_message_at,
                                        unread = row.unread,
                                        chipLabel = if (row.unread) t("inbox.forYouNewLead") else null,
                                        onClick = { onOpenConversation(row.conversation_id) },
                                    )
                                }
                                triage.tasks.forEachIndexed { index, row ->
                                    if (index > 0 || triage.conversations.isNotEmpty()) RowDivider()
                                    TaskQueueRow(
                                        title = row.title,
                                        overdue = row.overdue,
                                        dueAt = row.due_at,
                                        // #718: a task row opens the task.
                                        onClick = { onOpenTask(row.task_id) },
                                    )
                                }
                            }
                        }
                    }
                }

                "waiting" -> panelItem(entry, forYou.waiting_on_you.isNotEmpty()) {
                    QueueSection(t("inbox.forYouSectionWaiting"), count = waitingTotal) {
                        forYou.waiting_on_you.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                why = relativeTime(row.last_message_at),
                                whyAt = row.last_message_at,
                                unread = row.unread,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }

                "tasks" -> panelItem(entry, forYou.my_tasks.isNotEmpty()) {
                    QueueSection(t("inbox.forYouSectionTasks"), count = tasksTotal) {
                        forYou.my_tasks.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            TaskQueueRow(
                                title = row.title,
                                overdue = row.overdue,
                                dueAt = row.due_at,
                                // #718: a task row opens the task.
                                onClick = { onOpenTask(row.task_id) },
                            )
                        }
                    }
                }

                "unread" -> panelItem(entry, forYou.unread.isNotEmpty()) {
                    QueueSection(t("inbox.forYouSectionUnread"), count = unreadTotal) {
                        forYou.unread.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                why = relativeTime(row.last_message_at),
                                whyAt = row.last_message_at,
                                unread = true,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }

                "outstanding_quotes" -> panelItem(entry, waitingQuotes.isNotEmpty()) {
                    QueueSection(t("quotes.outstandingTitle"), count = waitingQuotes.size) {
                        waitingQuotes.forEachIndexed { index, quote ->
                            if (index > 0) RowDivider()
                            // Built HERE rather than in the click lambda, because
                            // `t` is @Composable and a lambda is not.
                            //
                            // The note is what makes the reminder actionable three
                            // days later: "Chase this" is a chore, and "Chase the
                            // $450 quote - replace the water heater" is a job.
                            val chaseNote = t(
                                "quotes.chaseNote",
                                "amount" to formatMoney(quote.amount_cents, quote.money),
                                "description" to quote.description,
                            ).take(SnoozeTiming.NOTE_MAX)
                            OutstandingQuoteRow(
                                quote = quote,
                                onOpen = { onOpenConversation(quote.conversation_id) },
                                chased = chasedQuotes?.contains(quote.id),
                                onChase = { onChaseQuote(quote, chaseNote) },
                            )
                        }
                    }
                }

                // Recent calls (#165/D43) - the mobile doorway into the Calls
                // surface. Nothing while there are no calls; an honest error line
                // when the log couldn't load.
                "recent_calls" -> panelItem(
                    entry,
                    recentCalls is LoadState.Failed ||
                        (recentCalls is LoadState.Ready && recentCalls.value.isNotEmpty()),
                ) {
                    when (recentCalls) {
                        is LoadState.Loading -> Unit
                        is LoadState.Failed -> Column(Modifier.padding(top = 14.dp)) {
                            RecentCallsHeader(onOpenCalls)
                            Text(
                                t("inbox.forYouCallsLoadFailed"),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 6.dp, top = 2.dp),
                            )
                        }

                        is LoadState.Ready -> Column(Modifier.padding(top = 14.dp)) {
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

                // #239 - the claim we sell, measured.
                "response_time" -> panelItem(entry, true) {
                    ResponseTimeCard(
                        report = responseTime,
                        days = responseDays,
                        onWindow = onResponseWindow,
                        onOpenUnanswered = onOpenUnanswered,
                    )
                }

                // #354: absent entirely until there is something true to say.
                "pipeline" -> panelItem(entry, true) { PipelineCard(report = pipeline) }

                // #313: how fast you answered and whether it landed are one
                // thought; the member now decides whether they sit together.
                "satisfaction" -> panelItem(entry, true) {
                    SatisfactionCard(
                        report = satisfaction,
                        days = responseDays,
                        onWindow = onResponseWindow,
                        onOpenPoor = onOpenUnanswered,
                    )
                }

                // #301: the slower question - next month's spending.
                "lead_sources" -> panelItem(entry, true) {
                    LeadSourcesCard(
                        report = leadSources,
                        onSetUpSources = { onOpenSettings(SettingsSection.Numbers) },
                    )
                }
            }
        }

        // #288: after the work and the measures, so the ask lands as earned rather
        // than as an interruption. NOT one of the panels: it already has its own
        // "Not now", and a prompt with two ways to put it away is a prompt where
        // one of them stops being honoured.
        item(key = "referral-ask") {
            ReferralAskCard(
                moment = referralMoment,
                referrals = referralLink,
                opened = referralOpened,
                onOpen = onOpenReferral,
                onDismiss = onDismissReferral,
            )
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

/** #287: a morning's worth. The rest is the thread list's job. */
private const val OUTSTANDING_QUOTES_LIMIT = 6

/**
 * One unanswered quote: what it is worth, what it is for, and how long it has
 * been waiting.
 *
 * The AGE, not the deadline. "Sent 9 days ago" is the fact that decides whether
 * to chase; the deadline is only the reason the row will vanish on its own.
 */
@Composable
private fun OutstandingQuoteRow(
    quote: Quote,
    onOpen: () -> Unit,
    /** True once chased; NULL when this member cannot chase at all. */
    chased: Boolean?,
    onChase: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            formatMoney(quote.amount_cents, quote.money),
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
            fontWeight = FontWeight.Medium,
        )
        Text(
            quote.description,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        quote.sent_at?.let { sent ->
            Timestamp(
                sent,
                textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when (chased) {
            null -> RowArrow()
            true -> Text(
                t("quotes.chasing"),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            false -> TextButton(
                onClick = onChase,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                modifier = Modifier.heightIn(min = 32.dp),
            ) {
                Text(
                    t("quotes.chase"),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    fontWeight = FontWeight.Medium,
                )
            }
        }
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
            t("inbox.forYouRecentCalls"),
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
                t("inbox.forYouViewAllCalls"),
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
    /** The moment [why] abbreviates, so a reader hears a time and not "22h". */
    whyAt: String? = null,
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
                    name?.takeIf { it.isNotBlank() } ?: t("inbox.forYouUnknownCaller"),
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
                modifier = Modifier
                    .padding(top = 2.dp)
                    .then(if (whyAt != null) Modifier.spokenTimeOf(whyAt) else Modifier),
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
                    overdue -> t("inbox.forYouWhyOverdueTask")
                    // formatDue, NOT relativeTime: relativeTime measures time
                    // ELAPSED, so every future due date came out as "Due now".
                    dueAt != null -> t("inbox.forYouWhyDue", "when" to formatDue(dueAt))
                    else -> t("inbox.forYouWhyOpenTask")
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
        Timestamp(
            call.started_at,
            textStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
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
                t("inbox.forYouCaughtUpHeading"),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                t("inbox.forYouCaughtUpBody"),
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

/**
 * The name Compose's animation tooling shows for the dot's transition.
 *
 * A CONSTANT rather than a literal at the call site, because `label = "…"` is the
 * shape a reader-facing string takes everywhere else in this file and #228's
 * ledger cannot tell the two apart. Nobody using the app ever sees this one — it
 * is for the Animation Preview inspector — so naming it here says so once
 * instead of leaving a translator to guess.
 */
private const val ATTENTION_DOT_TRANSITION = "attentionDot"

/** 44dp paper circle icon button; optional coral dot (unread notifications). */
@Composable
private fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    showDot: Boolean = false,
) {
    // The coral dot was only a picture; a reader heard "Notifications" either way.
    val unreadLabel = t("contactsTasks.notifStateUnread")
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
        modifier = Modifier
            .size(44.dp)
            .pressScale(pressSource)
            .asButton()
            .semantics { if (showDot) stateDescription = unreadLabel },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(17.dp))
            // Animated so the coral dot pops in and out instead of blinking.
            AnimatedContent(
                targetState = showDot,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp),
                label = ATTENTION_DOT_TRANSITION,
            ) { dot ->
                if (dot) AttentionDot(size = 8.dp)
            }
        }
    }
}

/**
 * Tinted identity circle (secondaryContainer + SemiBold initials).
 *
 * Kept as a named local so the three call sites read the same as before, but the badge
 * itself is now the shared component — a wrapper that takes `fontSize` as a parameter
 * hid this from the #569 sweep, because the literal lived at the call site and the box
 * size lived here, so neither file showed a fixed box beside a literal glyph.
 */
@Composable
private fun AvatarCircle(name: String?, size: Dp, fontSize: TextUnit) {
    InitialsAvatar(name, size, glyph = fontSize)
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
            spamReviewReason(item, LocalAppLocale.current),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
            color = if (item.we_texted_them) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onAnswer(true) }) { Text(t("inbox.forYouNotSpam")) }
            TextButton(onClick = { onAnswer(false) }) { Text(t("inbox.forYouStillSpam")) }
        }
    }
}
