package com.loonext.android.features.calls

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhoneCallback
import androidx.compose.material.icons.outlined.PhoneForwarded
import androidx.compose.material.icons.outlined.PhoneMissed
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.features.contacts.ContactMutations
import com.loonext.android.features.contacts.CreateContactSheet
import com.loonext.android.features.contacts.device.ContentResolverDeviceContacts
import com.loonext.android.features.contacts.device.DialerCandidate
import com.loonext.android.features.contacts.device.MatchSource
import com.loonext.android.features.contacts.device.correlateDialedNumber
import com.loonext.android.features.contacts.device.deviceDialerCandidates
import com.loonext.android.BuildConfig
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneStatus
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.SwipeAction
import com.loonext.android.ui.common.SwipeActionRow
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class CallsFilter(val label: String, val outcome: String?, val filterKey: String) {
    All("All", null, "default"),
    Missed("Missed", CallOutcome.MISSED, "missed"),
    Voicemail("Voicemail", CallOutcome.VOICEMAIL, "voicemail"),
}

/**
 * The cached call-log aggregate (#176): the ACCUMULATED pages plus the cursor
 * to fetch more, so returning to the screen (or to a previously-used filter)
 * restores everything the user had loaded. Internal so the shell warmer can
 * replay the default fetch.
 */
internal data class CallsLog(
    val calls: List<Call>,
    val nextCursor: String?,
)

/**
 * First-page fetch that MERGES with already-cached deeper pages: the fresh
 * first page wins, then the older accumulated tail is kept (deduped by id),
 * so a silent revalidate never collapses what the user scrolled to.
 */
internal suspend fun fetchCallsLog(
    cache: StoreCache,
    repo: CallsRepository,
    companyId: String,
    outcome: String?,
    cacheKey: String,
): CallsLog {
    val page = repo.calls(companyId, outcome = outcome)
    val cached = cache.flowOf<CallsLog>(cacheKey).value
    if (cached == null || cached.calls.size <= page.data.size) {
        return CallsLog(page.data, page.next_cursor)
    }
    val fresh = page.data.map { it.id }.toSet()
    return CallsLog(
        page.data + cached.calls.filter { it.id !in fresh },
        cached.nextCursor,
    )
}

/**
 * /calls — softphone status line, the #210 Ongoing card (who holds which
 * line right now, pinned above the rail), All|Missed|Voicemail log
 * (cursor-paged, grouped by day), outcome rows, voicemail playback, realtime
 * call.updated refresh, and the dialer (spec 25). Registering the softphone
 * here (and in [CallsOverlay]) is what makes this member ring-eligible.
 */
@Composable
fun CallsScreen(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    openConversation: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val manager = remember(graph) { SoftphoneManager.get(context, graph.api) }
    val repo = remember(graph) { CallsRepository(graph.api) }
    val softphone by manager.state.collectAsStateWithLifecycle()

    LaunchedEffect(companyId, me.display_name) {
        manager.start(companyId, me.display_name)
    }

    val haptics = rememberHaptics()
    var filter by rememberSaveable { mutableStateOf(CallsFilter.All) }
    var loadingMore by remember { mutableStateOf(false) }
    var refreshKey by remember { mutableStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var dialerOpen by rememberSaveable { mutableStateOf(false) }
    var dialerPrefill by rememberSaveable { mutableStateOf("") }
    var addContactPrefill by rememberSaveable { mutableStateOf<String?>(null) }
    val contactsRepo = remember(graph) { com.loonext.android.core.data.ContactsRepository(graph.api) }
    val scope = rememberCoroutineScope()

    // #183 parts 1-2: the device address book, read behind an interface so the
    // correlation is testable. Loaded ONCE into an in-memory candidate snapshot
    // when contacts access is granted; the dialer correlates against it on every
    // keystroke with no repeat ContentResolver reads. Absent permission → empty,
    // and the dialer degrades to app-only correlation.
    val deviceContacts = remember(context) { ContentResolverDeviceContacts(context) }
    var contactsGranted by remember { mutableStateOf(deviceContacts.hasPermission()) }
    var deviceCandidates by remember { mutableStateOf<List<DialerCandidate>>(emptyList()) }
    LaunchedEffect(contactsGranted) {
        if (contactsGranted) {
            deviceCandidates = deviceDialerCandidates(
                runCatching { deviceContacts.loadContacts() }.getOrDefault(emptyList()),
            )
            // #183 part 3: (re)establish the Connected-Apps account + rows
            // whenever contacts access is live — covers a re-sign-in where the
            // permission persisted but the account was torn down at sign-out.
            // Idempotent: ensure() no-ops when the account already exists.
            graph.enableContactsIntegration()
        }
    }
    // #183 part 3: a "Call with Loonext" tap in the system Contacts app routes
    // here via the pendingDial bus — open the dialer prefilled with that number.
    LaunchedEffect(Unit) {
        graph.pendingDial.collect { number ->
            if (number != null) {
                dialerPrefill = number
                dialerOpen = true
                graph.pendingDial.value = null
            }
        }
    }

    // #176 cache-first: each filter is its own key, so a revisit (or a return
    // to a previously-used filter) paints instantly from StoreCache while the
    // first page revalidates silently; only a never-fetched filter may show
    // the loading state.
    val cacheKey = CacheKeys.calls(companyId, filter.filterKey)
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        try {
            fetchCallsLog(graph.storeCache, repo, companyId, filter.outcome, cacheKey)
        } finally {
            refreshing = false
        }
    }
    // Realtime: the calls table's DB trigger broadcasts call.updated (ID-only)
    // on every session change — refetch the first page; ditto on re-join.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "call.updated") refreshKey++
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // #215: heal a call.updated frame missed while backgrounded/blurred by
    // revalidating on return to the foreground.
    ResyncOnResume(companyId) { refreshKey++ }

    // #210: ongoing (outcome-null) rows always derive from the All-filter
    // payload — an outcome= filter can never return them — so the pinned card
    // stays truthful whatever filter pill is active.
    val defaultCallsKey = CacheKeys.calls(companyId)
    val defaultLog by remember(companyId) {
        graph.storeCache.flowOf<CallsLog>(defaultCallsKey)
    }.collectAsStateWithLifecycle()
    val ongoing = remember(defaultLog) { ongoingCalls(defaultLog?.calls ?: emptyList()) }

    // While a narrower filter is active, realtime/reconnect/pull bumps of
    // refreshKey only revalidate that filter's key above — replay the All
    // fetch too so the card clears the moment a call resolves.
    LaunchedEffect(companyId, refreshKey, filter) {
        if (filter != CallsFilter.All) {
            runCatching {
                graph.storeCache.put(
                    defaultCallsKey,
                    fetchCallsLog(graph.storeCache, repo, companyId, null, defaultCallsKey),
                )
            }
        }
    }

    // Roster for "who answered" (#210): the same member list the inbox tab
    // already caches under inboxMembers — filled here from the existing
    // GET /v1/members read only if an ongoing call needs a name first.
    val membersFlow = remember(companyId) {
        graph.storeCache.flowOf<List<Member>>(CacheKeys.inboxMembers(companyId))
    }
    val members by membersFlow.collectAsStateWithLifecycle()
    LaunchedEffect(companyId, ongoing.isNotEmpty()) {
        if (ongoing.isNotEmpty() && membersFlow.value == null) {
            runCatching { membersFlow.value = repo.members(companyId).data }
        }
    }

    // #196: the missed-call text-back hint at the foot of the log must reflect
    // the REAL setting, never claim it fires when it is off. Prefer the live
    // settings-cache value (Settings writes it on every toggle, same process)
    // and fall back to the hydrated me.company; both are cache reads, no fetch.
    // Unknown (neither present yet) hides the hint - the honest default.
    val settingsCompany by remember(companyId) {
        graph.storeCache.flowOf<CompanyView>(CacheKeys.settingsHome(companyId))
    }.collectAsStateWithLifecycle()
    val textBackOn = (settingsCompany ?: me.company)?.mctb_enabled == true

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            run {
                // The tab's single title row (#203: Calls is ONE surface, the
                // pager tab - no pushed route variant exists anymore).
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 18.dp, end = 18.dp, top = 14.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    ScreenTitle("Calls")
                    Spacer(Modifier.width(9.dp))
                    SoftphoneStatusLine(
                        status = softphone.status,
                        // #195 F7: a ring is on screen but the socket is down —
                        // the line must say so instead of pretending all is well.
                        ringPresented = softphone.calls.any {
                            it.phase == CallPhase.RINGING && !it.silenced
                        },
                        onRetry = manager::retryNow,
                        modifier = Modifier.padding(bottom = 7.dp),
                    )
                }
            }

            // #210: who is holding which line RIGHT NOW — pinned above the
            // filter rail whenever the company has in-flight call rows;
            // absent entirely when it has none.
            if (ongoing.isNotEmpty()) {
                OngoingCallsCard(
                    calls = ongoing,
                    members = members ?: emptyList(),
                    numbers = me.company?.numbers ?: emptyList(),
                    openConversation = openConversation,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 18.dp, end = 18.dp, top = 12.dp),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                CallsFilter.entries.forEach { item ->
                    FilterPill(
                        label = item.label,
                        selected = filter == item,
                        onClick = {
                            haptics.tap()
                            filter = item
                        },
                    )
                }
            }

            val pullState = rememberPullToRefreshState()
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    refreshing = true
                    refreshKey++
                },
                state = pullState,
                indicator = {
                    PullToRefreshDefaults.LoadingIndicator(
                        state = pullState,
                        isRefreshing = refreshing,
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
            when (val current = state) {
                is LoadState.Loading -> CallLogSkeleton()
                is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
                is LoadState.Ready -> {
                    // #210: in-flight rows live in the pinned Ongoing card,
                    // not the log; each drops back in here the moment its
                    // outcome is stamped.
                    val resolved =
                        remember(current.value.calls) { resolvedCalls(current.value.calls) }
                    if (resolved.isEmpty()) {
                        Box(
                            Modifier
                                .fillMaxSize()
                                .verticalScroll(rememberScrollState()),
                            contentAlignment = Alignment.Center,
                        ) {
                            // With an ongoing call pinned above, "No calls
                            // yet" would contradict the screen — stay quiet.
                            if (ongoing.isEmpty()) {
                                Text(
                                    when (filter) {
                                        CallsFilter.Missed -> "No missed calls."
                                        CallsFilter.Voicemail -> "No voicemails."
                                        CallsFilter.All ->
                                            "No calls yet. When customers call your number, they land here."
                                    },
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 32.dp),
                                )
                            }
                        }
                    } else {
                        val groups =
                            remember(resolved) { groupByDay(resolved) }
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(
                                start = 18.dp,
                                end = 18.dp,
                                top = 6.dp,
                                bottom = 24.dp,
                            ),
                        ) {
                            groups.forEach { (label, calls) ->
                                item(key = "hdr-$label") {
                                    SectionHeader(
                                        label,
                                        Modifier
                                            .animateItem()
                                            .padding(top = 10.dp),
                                        count = calls.size,
                                    )
                                }
                                item(key = "card-$label") {
                                    PaperCard(
                                        Modifier
                                            .fillMaxWidth()
                                            .animateItem(),
                                    ) {
                                        calls.forEachIndexed { index, call ->
                                            key(call.id) {
                                                CallRow(
                                                    call = call,
                                                    repo = repo,
                                                    companyId = companyId,
                                                    onOpen = call.conversation_id?.let { id ->
                                                        { openConversation(id) }
                                                    },
                                                    onDialBack = call.caller_e164
                                                        ?.takeIf { it.isNotBlank() }
                                                        ?.let { number ->
                                                            {
                                                                dialerPrefill =
                                                                    number.filter { it.isDigit() }
                                                                dialerOpen = true
                                                            }
                                                        },
                                                )
                                                if (index < calls.lastIndex) RowDivider()
                                            }
                                        }
                                    }
                                }
                            }
                            if (current.value.nextCursor != null) {
                                item(key = "load-more") {
                                    Box(
                                        Modifier
                                            .animateItem()
                                            .fillMaxWidth()
                                            .padding(vertical = 8.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        if (loadingMore) {
                                            LoadingIndicator()
                                        } else {
                                            TextButton(onClick = {
                                                val cursor = current.value.nextCursor
                                                    ?: return@TextButton
                                                loadingMore = true
                                                val key = cacheKey
                                                val outcome = filter.outcome
                                                scope.launch {
                                                    try {
                                                        val page = repo.calls(
                                                            companyId,
                                                            outcome = outcome,
                                                            cursor = cursor,
                                                        )
                                                        // Append onto whatever the cache
                                                        // holds NOW (a silent revalidate
                                                        // may have landed since the tap).
                                                        val base = graph.storeCache
                                                            .flowOf<CallsLog>(key).value
                                                            ?: current.value
                                                        val seen =
                                                            base.calls.map { it.id }.toSet()
                                                        graph.storeCache.put(
                                                            key,
                                                            CallsLog(
                                                                base.calls + page.data.filter {
                                                                    it.id !in seen
                                                                },
                                                                page.next_cursor,
                                                            ),
                                                        )
                                                    } catch (_: Exception) {
                                                        // Keep what's loaded; button stays.
                                                    } finally {
                                                        loadingMore = false
                                                    }
                                                }
                                            }) { Text("Load more") }
                                        }
                                    }
                                }
                            }
                            // #196: only shown when the missed-call text-back is
                            // actually enabled - the hint must never claim an
                            // automatic reply that a disabled setting will not send.
                            if (textBackOn) {
                                item(key = "auto-text-hint") {
                                    Box(
                                        Modifier
                                            .animateItem()
                                            .fillMaxWidth()
                                            .padding(top = 14.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Surface(
                                            shape = CircleShape,
                                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                        ) {
                                            Text(
                                                "Missed calls text the customer back automatically",
                                                fontSize = 11.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.padding(
                                                    horizontal = 14.dp,
                                                    vertical = 7.dp,
                                                ),
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
        }

        // The dialpad FAB — 54dp ink circle above the pill nav (spec 25).
        val fabInteraction = remember { MutableInteractionSource() }
        Surface(
            onClick = {
                haptics.tap()
                dialerPrefill = ""
                dialerOpen = true
            },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            interactionSource = fabInteraction,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 18.dp, bottom = 10.dp)
                .size(54.dp)
                .pressScale(fabInteraction)
                .shadow(14.dp, CircleShape, spotColor = BrandColor.Ink.copy(alpha = 0.3f)),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.Dialpad,
                    contentDescription = "Dial a number",
                    modifier = Modifier.size(19.dp),
                )
            }
        }
    }

    if (dialerOpen) {
        DialerSheet(
            manager = manager,
            numbers = (me.company?.numbers ?: emptyList()).filter {
                it.status == NumberStatus.ACTIVE && it.number_e164 != null
            },
            onDismiss = { dialerOpen = false },
            initialDigits = dialerPrefill,
            lookupContact = { typed ->
                // #183 part 2: correlate typed digits with the crew's saved
                // contacts AND the device address book, in ONE pure matcher.
                // App candidates go first so they win ties (server q matches
                // name+phone); device candidates supplement from the in-memory
                // snapshot. The matcher re-verifies the digits actually match.
                val app = runCatching {
                    contactsRepo.contacts(companyId, q = typed, limit = 5).data.map { c ->
                        DialerCandidate(
                            name = c.name,
                            number = c.phone_e164,
                            source = MatchSource.APP,
                        )
                    }
                }.getOrDefault(emptyList())
                correlateDialedNumber(typed, app + deviceCandidates)?.name
            },
            deviceContactsGranted = contactsGranted,
            // Flipping this triggers the LaunchedEffect above, which loads
            // device candidates AND stands up the Connected-Apps rows (part 3).
            onDeviceContactsGranted = { contactsGranted = true },
            onAddContact = { e164 ->
                dialerOpen = false
                addContactPrefill = e164
            },
        )
    }

    addContactPrefill?.let { prefill ->
        CreateContactSheet(
            mutations = remember(graph) { ContactMutations(graph.api, BuildConfig.API_URL) },
            companyId = companyId,
            onCreated = { addContactPrefill = null },
            onDismiss = { addContactPrefill = null },
            prefillPhone = prefill,
        )
    }
}

/** "Ready to ring" beside the title — one calm line, tap retries when down. */
@Composable
private fun SoftphoneStatusLine(
    status: SoftphoneStatus,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    ringPresented: Boolean = false,
) {
    val haptics = rememberHaptics()
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    val (label, dot, text) = when {
        // #195 F7: a ring is presented but the socket is NOT ready — honest
        // over reassuring (an answer right now may stall or fail).
        ringPresented && status != SoftphoneStatus.READY -> Triple(
            "Reconnecting your line…",
            MaterialTheme.colorScheme.outline,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )

        status == SoftphoneStatus.READY -> Triple(
            "Ready to ring",
            BrandColor.LimeBright,
            MaterialTheme.colorScheme.secondary,
        )

        status == SoftphoneStatus.CONNECTING -> Triple(
            "Connecting…",
            MaterialTheme.colorScheme.outline,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )

        else -> Triple(
            "Offline · retry",
            coral,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    LineStatusRow(
        text = label,
        dot = dot,
        textColor = text,
        modifier = modifier.clickable(
            enabled = status == SoftphoneStatus.DISCONNECTED,
            onClick = {
                haptics.tap()
                onRetry()
            },
        ),
    )
}

/**
 * #210: the Ongoing card — the founder's "who is on my line?" answer. Rows
 * stack when several calls run at once (each business line can hold one);
 * the whole section is absent when nothing is in flight.
 */
@Composable
private fun OngoingCallsCard(
    calls: List<Call>,
    members: List<Member>,
    numbers: List<PhoneNumberSummary>,
    openConversation: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        SectionHeader("Ongoing", count = calls.size.takeIf { it > 1 })
        PaperCard(Modifier.fillMaxWidth()) {
            calls.forEachIndexed { index, call ->
                key(call.id) {
                    OngoingCallRow(
                        call = call,
                        members = members,
                        numbers = numbers,
                        openConversation = openConversation,
                    )
                    if (index < calls.lastIndex) RowDivider()
                }
            }
        }
    }
}

/**
 * One live line: caller identity, the member holding it (or "Ringing…"
 * before anyone does), the business number when the company owns more than
 * one, and — for answered calls — the live talk timer. Tapping opens the
 * caller's conversation when one exists.
 */
@Composable
private fun OngoingCallRow(
    call: Call,
    members: List<Member>,
    numbers: List<PhoneNumberSummary>,
    openConversation: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    val name = callerDisplayName(call)
    val phase = ongoingPhase(call)
    val status = ongoingStatusLabel(phase, memberDisplayName(call.answered_by_user_id, members))
    val numberLabel = ongoingNumberLabel(call.phone_number_id, numbers)
    val conversationId = call.conversation_id
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                if (conversationId != null) {
                    Modifier.clickable {
                        haptics.tap()
                        openConversation(conversationId)
                    }
                } else {
                    Modifier
                },
            )
            .padding(start = 15.dp, end = 15.dp, top = 11.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        InitialsAvatar(name, size = 38.dp)
        Column(Modifier.weight(1f)) {
            Text(
                name,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                Modifier.padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // The card's one tinted element — the same coral the log
                // reserves for its live/urgent accents.
                Text(
                    status,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = coral,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                numberLabel?.let { label ->
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceContainer,
                    ) {
                        Text(
                            label,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
        if (ongoingShowsTimer(phase)) {
            OngoingTicker(anchorIso = ongoingAnchorIso(call), color = coral)
        } else {
            AttentionDot()
        }
    }
}

/**
 * The one thing that moves every second — isolated so the tick recomposes
 * exactly this Text, never the card or the list behind it (#210).
 */
@Composable
private fun OngoingTicker(anchorIso: String, color: Color, modifier: Modifier = Modifier) {
    val anchorMs = remember(anchorIso) {
        runCatching { Instant.parse(anchorIso).toEpochMilli() }.getOrNull()
    } ?: return
    var elapsedMs by remember(anchorIso) {
        mutableStateOf((System.currentTimeMillis() - anchorMs).coerceAtLeast(0L))
    }
    LaunchedEffect(anchorMs) {
        while (true) {
            elapsedMs = (System.currentTimeMillis() - anchorMs).coerceAtLeast(0L)
            delay(1_000)
        }
    }
    Text(
        formatTimer(elapsedMs),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = color,
        modifier = modifier,
    )
}

/** Segmented pill: avatar-tint fill selected, quiet paper otherwise (spec 25). */
@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        contentColor = if (selected) {
            MaterialTheme.colorScheme.onSecondaryContainer
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun CallRow(
    call: Call,
    repo: CallsRepository,
    companyId: String,
    onOpen: (() -> Unit)?,
    onDialBack: (() -> Unit)?,
) {
    val name = callerDisplayName(call)
    val haptics = rememberHaptics()
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier,
            ),
    ) {
        // #185 swipe shortcuts, on the row surface only (the voicemail player
        // below stays outside so its scrubber keeps its own horizontal drags).
        // Right = call back through the same dialer-prefill path as the circle
        // (absent when there is no callable number; the dialer's existing
        // offline handling still applies). Left = text back, the same
        // conversation the row tap already opens. Both remain reachable by
        // tap, so the swipe is a shortcut, never the only door.
        SwipeActionRow(
            modifier = Modifier.fillMaxWidth(),
            startAction = onDialBack?.let { dial ->
                SwipeAction(
                    icon = Icons.Outlined.Call,
                    label = "Call back",
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    container = MaterialTheme.colorScheme.secondaryContainer,
                    onCommit = {
                        haptics.confirm()
                        dial()
                    },
                )
            },
            endAction = onOpen?.let { open ->
                SwipeAction(
                    icon = Icons.AutoMirrored.Outlined.Message,
                    label = "Text back",
                    tint = MaterialTheme.colorScheme.onTertiaryContainer,
                    container = MaterialTheme.colorScheme.tertiaryContainer,
                    onCommit = {
                        haptics.tap()
                        open()
                    },
                )
            },
        ) {
            Row(
                Modifier.padding(start = 15.dp, end = 15.dp, top = 11.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                InitialsAvatar(name, size = 38.dp)
                Column(Modifier.weight(1f)) {
                    Text(
                        name,
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        Modifier.padding(top = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            directionIcon(call),
                            contentDescription = null,
                            tint = if (isActionableMiss(call)) {
                                coral
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            modifier = Modifier.size(12.dp),
                        )
                        Text(
                            callOutcomeLabel(call),
                            fontSize = 11.5.sp,
                            // Coral for the actionable inbound miss — the row's one
                            // tinted element; everything else stays quiet.
                            fontWeight = if (isActionableMiss(call)) {
                                FontWeight.SemiBold
                            } else {
                                FontWeight.Normal
                            },
                            color = if (isActionableMiss(call)) {
                                coral
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        screeningLabel(call.screening_result)?.let { label ->
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.surfaceContainer,
                            ) {
                                Text(
                                    label,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(
                                        horizontal = 8.dp,
                                        vertical = 2.dp,
                                    ),
                                )
                            }
                        }
                    }
                }
                Text(
                    relativeTime(call.started_at),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.outline,
                )
                if (onDialBack != null) {
                    val dialBackInteraction = remember { MutableInteractionSource() }
                    Surface(
                        onClick = {
                            haptics.tap()
                            onDialBack()
                        },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        interactionSource = dialBackInteraction,
                        modifier = Modifier
                            .size(34.dp)
                            .pressScale(dialBackInteraction),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Outlined.Call,
                                contentDescription = "Call back",
                                modifier = Modifier.size(15.dp),
                            )
                        }
                    }
                }
            }
        }
        if (call.outcome == CallOutcome.VOICEMAIL && (call.voicemail_seconds ?: 0) > 0) {
            VoicemailPlayerRow(
                repo = repo,
                companyId = companyId,
                sessionId = call.call_session_id,
                seconds = call.voicemail_seconds ?: 0,
            )
        }
    }
}

private fun directionIcon(call: Call): ImageVector = when {
    call.direction == "outbound" -> Icons.Outlined.PhoneForwarded
    call.outcome == CallOutcome.MISSED -> Icons.Outlined.PhoneMissed
    else -> Icons.Outlined.PhoneCallback
}

/** Newest-first log → ordered day buckets ("Today", "Yesterday", "Jul 8"). */
private fun groupByDay(calls: List<Call>): List<Pair<String, List<Call>>> {
    val today = LocalDate.now()
    val groups = LinkedHashMap<String, MutableList<Call>>()
    calls.forEach { call ->
        groups.getOrPut(dayLabel(call.started_at, today)) { mutableListOf() }.add(call)
    }
    return groups.map { (label, list) -> label to list }
}

private fun dayLabel(iso: String, today: LocalDate): String {
    val date = runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    }.getOrNull() ?: return "Earlier"
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.year == today.year -> date.format(DateTimeFormatter.ofPattern("MMM d"))
        else -> date.format(DateTimeFormatter.ofPattern("MMM d yyyy"))
    }
}

/**
 * Inline voicemail playback pill (spec 25): ink play disc, scrubber, tabular
 * length. Mints the 1h signed URL on demand (never cached), streams via
 * android.media.MediaPlayer with seek + live progress.
 */
@Composable
private fun VoicemailPlayerRow(
    repo: CallsRepository,
    companyId: String,
    sessionId: String,
    seconds: Int,
) {
    var player by remember(sessionId) { mutableStateOf<MediaPlayer?>(null) }
    var preparing by remember(sessionId) { mutableStateOf(false) }
    var playing by remember(sessionId) { mutableStateOf(false) }
    var positionMs by remember(sessionId) { mutableStateOf(0) }
    var durationMs by remember(sessionId) { mutableStateOf(seconds * 1000) }
    var error by remember(sessionId) { mutableStateOf<String?>(null) }
    var scrubbing by remember(sessionId) { mutableStateOf(false) }
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()

    DisposableEffect(sessionId) {
        onDispose {
            runCatching { player?.release() }
            player = null
        }
    }
    LaunchedEffect(playing, scrubbing) {
        while (playing && !scrubbing) {
            positionMs = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0)
            delay(200)
        }
    }

    fun beginPlayback() {
        error = null
        preparing = true
        scope.launch {
            val url = try {
                repo.voicemail(companyId, sessionId).url
            } catch (cause: Exception) {
                error = cause.userMessage()
                preparing = false
                return@launch
            }
            runCatching { player?.release() }
            val next = MediaPlayer()
            player = next
            try {
                next.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                next.setDataSource(url)
                next.setOnPreparedListener {
                    durationMs = if (it.duration > 0) it.duration else seconds * 1000
                    it.start()
                    preparing = false
                    playing = true
                }
                next.setOnCompletionListener {
                    playing = false
                    positionMs = durationMs
                }
                next.setOnErrorListener { _, _, _ ->
                    error = "Couldn't play this voicemail."
                    playing = false
                    preparing = false
                    true
                }
                next.prepareAsync()
            } catch (_: Exception) {
                error = "Couldn't play this voicemail."
                preparing = false
            }
        }
    }

    Column(Modifier.padding(start = 64.dp, end = 15.dp, bottom = 12.dp)) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                val playInteraction = remember(sessionId) { MutableInteractionSource() }
                Surface(
                    onClick = {
                        val current = player
                        when {
                            preparing -> Unit
                            playing -> {
                                haptics.tap()
                                runCatching { current?.pause() }
                                playing = false
                            }

                            current != null -> {
                                haptics.tap()
                                // Replaying a finished clip restarts from the top.
                                if (positionMs >= durationMs) {
                                    runCatching { current.seekTo(0) }
                                    positionMs = 0
                                }
                                runCatching { current.start() }
                                playing = true
                            }

                            else -> {
                                haptics.tap()
                                beginPlayback()
                            }
                        }
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    interactionSource = playInteraction,
                    modifier = Modifier
                        .size(28.dp)
                        .pressScale(playInteraction),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (preparing) {
                            LoadingIndicator(Modifier.size(14.dp))
                        } else {
                            AnimatedContent(
                                targetState = playing,
                                label = "vmPlayPause",
                            ) { isPlaying ->
                                Icon(
                                    if (isPlaying) {
                                        Icons.Outlined.Pause
                                    } else {
                                        Icons.Outlined.PlayArrow
                                    },
                                    contentDescription = if (isPlaying) {
                                        "Pause voicemail"
                                    } else {
                                        "Play voicemail"
                                    },
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }
                    }
                }
                // The bar waves while audio is audible; paused/idle keeps the
                // scrubber so seek stays one gesture away (#194).
                Box(
                    Modifier
                        .weight(1f)
                        .height(44.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (playing && !scrubbing) {
                        LinearWavyProgressIndicator(
                            progress = {
                                (
                                    positionMs.toFloat() /
                                        durationMs.toFloat().coerceAtLeast(1f)
                                    ).coerceIn(0f, 1f)
                            },
                            color = MaterialTheme.colorScheme.primary,
                            trackColor =
                            MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Slider(
                            value = positionMs.toFloat()
                                .coerceIn(0f, durationMs.toFloat().coerceAtLeast(1f)),
                            onValueChange = {
                                scrubbing = true
                                positionMs = it.toInt()
                            },
                            onValueChangeFinished = {
                                scrubbing = false
                                haptics.tick()
                                runCatching { player?.seekTo(positionMs) }
                            },
                            valueRange = 0f..durationMs.toFloat().coerceAtLeast(1f),
                            enabled = player != null,
                            colors = SliderDefaults.colors(
                                thumbColor = MaterialTheme.colorScheme.primary,
                                activeTrackColor = MaterialTheme.colorScheme.primary,
                                inactiveTrackColor =
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                                disabledThumbColor = MaterialTheme.colorScheme.outline,
                                disabledActiveTrackColor = MaterialTheme.colorScheme.outline,
                                disabledInactiveTrackColor =
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                Text(
                    "${formatTimer(positionMs.toLong())} / ${formatVoicemailLength(seconds)}",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        error?.let {
            Text(
                it,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/**
 * First-fetch stand-in in the log's own grammar (#194): two shimmering
 * day groups — header caption + carded avatar rows. Failed states and
 * cached repaints never see this.
 */
@Composable
private fun CallLogSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
    ) {
        SkeletonBlock(
            width = 72.dp,
            height = 10.dp,
            modifier = Modifier.padding(top = 16.dp, bottom = 7.dp, start = 6.dp),
        )
        PaperCard(Modifier.fillMaxWidth()) {
            SkeletonList(rows = 3)
        }
        SkeletonBlock(
            width = 72.dp,
            height = 10.dp,
            modifier = Modifier.padding(top = 18.dp, bottom = 7.dp, start = 6.dp),
        )
        PaperCard(Modifier.fillMaxWidth()) {
            SkeletonList(rows = 4)
        }
    }
}
