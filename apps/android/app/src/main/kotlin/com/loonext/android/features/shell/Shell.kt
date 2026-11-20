package com.loonext.android.features.shell

import com.loonext.android.ui.common.IconSize
import kotlinx.coroutines.CancellationException
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.add
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.selection.selectableGroup
import com.loonext.android.ui.common.asTab
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.features.calls.CallsScreen
import com.loonext.android.features.contacts.ContactsTab
import com.loonext.android.features.foryou.ForYouTab
import com.loonext.android.features.inbox.InboxDestination
import com.loonext.android.features.inbox.InboxTab
import com.loonext.android.features.settings.SettingsSection
import com.loonext.android.features.tasks.TasksTab
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.assertAboveIme
import com.loonext.android.ui.common.NavPillMaxWidth
import com.loonext.android.ui.common.contentMaxWidth
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.theme.BrandColor

/**
 * #228: each tab carries the KEY of its name rather than the name.
 *
 * It used to carry the English word, which was then written a second time at
 * every nav slot below — two copies of "Inbox" that a translation would have had
 * to find both of. The key is the one thing the enum can honestly own: what the
 * destination is called is a question only composition can answer, because only
 * composition knows who is reading.
 */
enum class ShellTab(val labelKey: String) {
    ForYou("shell.navForYou"),
    Inbox("shell.navInbox"),
    Calls("shell.navCalls"),
    Tasks("shell.navTasks"),
    Lou("shell.navLou"),

    /** Not a nav slot — reached from the You sheet (design IA). */
    Contacts("shell.navContacts"),
}

@Composable
fun MainShell(
    counts: ShellCounts,
    unreadNotifications: Int,
    tab: ShellTab,
    onTabChange: (ShellTab) -> Unit,
    onCompose: () -> Unit,
    onOpenAccountSheet: () -> Unit,
    floatingAction: (@Composable () -> Unit)? = null,
    topNotice: (@Composable () -> Unit)? = null,
    content: @Composable (ShellTab, Modifier) -> Unit,
) {
    // Surface, NOT Box+background: a Surface establishes LocalContentColor
    // (onBackground). With a bare background modifier the ambient content color
    // stayed the default BLACK app-wide, so every Text without an explicit
    // color rendered black in DARK theme too (founder: unreadable inbox names —
    // #174's root cause).
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            val haptics = rememberHaptics()
            var lastConversationsTab by rememberSaveable { mutableStateOf(ShellTab.Inbox) }
            val conversationsTab = if (tab == ShellTab.Inbox || tab == ShellTab.Calls) tab else lastConversationsTab
            LaunchedEffect(conversationsTab) { lastConversationsTab = conversationsTab }
            val highlightedTab = if (tab == ShellTab.Calls) ShellTab.Inbox else tab
            val pagerState = rememberPagerState(
                initialPage = shellPageForTab(tab) ?: 0,
            ) { SHELL_PAGE_TABS.size }

            // Pages whose own horizontal surface asked shell paging off while
            // active (LocalShellPagerBlocker — today only the Tasks map).
            // Keyed by page so a stale flag can never lock another tab.
            val pagerBlocks = remember { mutableStateMapOf<Int, Boolean>() }

            // The caller's tab state stays the ONE source of truth. Pill taps
            // and sheet jumps set it and this effect walks the pager there
            // (animateScrollToPage, so taps glide exactly like drags settle);
            // Contacts has no page, so the pager parks where it was.
            LaunchedEffect(tab) {
                val page = shellPageForTab(tab) ?: return@LaunchedEffect
                if (pagerState.currentPage != page ||
                    pagerState.currentPageOffsetFraction != 0f
                ) {
                    pagerState.animateScrollToPage(page)
                }
            }

            // Tab changes used to DISPOSE the outgoing tab, which dropped its
            // focus (and the keyboard with it). Pages stay composed under the
            // pager, so drop focus explicitly on every tab change to keep
            // that behavior; no-op when nothing is focused.
            val focusManager = LocalFocusManager.current
            LaunchedEffect(tab) { focusManager.clearFocus() }

            // The reverse path: a settle that CHANGES tab fires the exact
            // side effects a pill tap fires today (tap haptic + onTabChange —
            // selectTab below does nothing else), so swipe and tap can never
            // drift apart.
            val currentTab by rememberUpdatedState(tab)
            val currentOnTabChange by rememberUpdatedState(onTabChange)
            LaunchedEffect(pagerState) {
                snapshotFlow { pagerState.settledPage }.collect { page ->
                    val settled = shellTabForPage(page)
                    if (currentTab != ShellTab.Contacts && shellPageForTab(currentTab) != page) {
                        haptics.tap()
                        currentOnTabChange(if (settled == ShellTab.Inbox) lastConversationsTab else settled)
                    }
                }
            }

            // ONE inset policy for every tab (#172): status bar at the top;
            // at the bottom whichever is TALLER — nav-bar + pill clearance
            // (14dp inset + 66dp pill = 80dp) or the keyboard (#187) — so a
            // focused tab input rides above the ime without stacking the pill
            // clearance on top of it. The old fixed 96dp ignored the system
            // nav inset, leaving list tails under the pill on 3-button nav.
            // Screens must NOT add their own statusBarsPadding or imePadding
            // on top of this; inset consumption makes leftovers no-ops (and
            // ImeContractLintTest forbids them, #199). The PAGER carries the
            // insets now, so every page inherits them. assertAboveIme is the
            // #199 debug guard: this host keeps its union math instead of
            // imeHost's plain imePadding ON PURPOSE - max(pill, ime), never
            // pill + ime - but gets the same covered-field crash in debug.
            val contentInsets = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .windowInsetsPadding(
                    WindowInsets.navigationBars
                        .add(WindowInsets(bottom = 80.dp))
                        .union(WindowInsets.ime),
                )
                .assertAboveIme("shell-pager")

            HorizontalPager(
                state = pagerState,
                key = { it },
                // Neighbors stay composed so a drag reveals a PAINTED page:
                // every tab is cache-first (#176) and seeds synchronously from
                // StoreCache, so the revealed page renders rows in its first
                // frame after any prior visit (or the shell warmer's pass).
                // 1 — not all 3 — keeps the cold-start fetch fan-out at two
                // tabs (For you + Inbox) instead of four.
                beyondViewportPageCount = 1,
                // Two deliberate gesture cutouts: Contacts overlays the pager
                // without occluding pointer input (Compose hit-tests through
                // painted-but-inert siblings), and a page may block paging
                // while a child-first resolution is impossible (Tasks map).
                userScrollEnabled = tab != ShellTab.Contacts &&
                    pagerBlocks[pagerState.settledPage] != true,
                modifier = contentInsets.then(
                    // While Contacts covers the pager, keep the hidden pages
                    // out of the accessibility tree.
                    if (tab == ShellTab.Contacts) {
                        Modifier.clearAndSetSemantics {}
                    } else {
                        Modifier
                    },
                ),
            ) { page ->
                // Remembered so the provided value is STABLE: a fresh lambda
                // per recomposition would invalidate the static local's whole
                // subtree every frame.
                val blocker = remember(page) {
                    { blocked: Boolean -> pagerBlocks[page] = blocked }
                }
                CompositionLocalProvider(
                    LocalShellPagerBlocker provides blocker,
                    LocalShellPageActive provides (pagerState.settledPage == page),
                ) {
                    // #180: cap + centre the tab content on wide viewports
                    // (tablets, foldable inner displays) so lists and headers
                    // don't stretch edge-to-edge; a no-op on phones. The pill
                    // nav and fade gradient stay full-width (drawn above this).
                    Column(Modifier.fillMaxSize().contentMaxWidth()) {
                        topNotice?.invoke()
                        val pageTab = shellTabForPage(page)
                        content(if (pageTab == ShellTab.Inbox) conversationsTab else pageTab, Modifier.weight(1f))
                    }
                }
            }

            // Contacts (no nav slot) rides ABOVE the parked pager on its own
            // opaque canvas; leaving it returns to the pager exactly where it
            // parked, pages and their state intact.
            if (tab == ShellTab.Contacts) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background),
                ) {
                    Column(contentInsets.contentMaxWidth()) {
                        topNotice?.invoke()
                        content(ShellTab.Contacts, Modifier.weight(1f))
                    }
                }
            }

            // Fade the content out underneath the pill (canvas → transparent).
            // Decoration over SCROLLING content only — interactive elements ride
            // the [floatingAction] slot, which draws ABOVE this and the pill.
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(130.dp)
                    .background(
                        Brush.verticalGradient(
                            0f to MaterialTheme.colorScheme.background.copy(alpha = 0f),
                            0.72f to MaterialTheme.colorScheme.background,
                        ),
                    ),
            )

            val slotCenters = remember { mutableStateMapOf<ShellTab, Float>() }
            val selectTab: (ShellTab) -> Unit = { next ->
                if (next != tab) haptics.tap()
                onTabChange(next)
            }
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(start = 14.dp, end = 14.dp, bottom = 14.dp)
                    .fillMaxWidth()
                    // #556: capped and centred, because this was `fillMaxWidth()`
                    // and nothing else -- so on a tablet or an unfolded foldable
                    // the slots spread across the whole window while the column
                    // they navigate sat in the middle, and the moving pill under
                    // a tab pointed at nothing above it.
                    //
                    // The cap is the PILL's, not the content's. Both numbers were
                    // rendered at 840dp before choosing; see [NavPillMaxWidth] for
                    // what the picture showed and why the slots' relationship to
                    // each other wins over the bar's to the content's edges.
                    //
                    // D134 settles the rest of this issue's bottom-bar-vs-side-bar
                    // question: no rail, at any width, on either phone.
                    .contentMaxWidth(NavPillMaxWidth)
                    .height(66.dp)
                    .shadow(24.dp, CircleShape, spotColor = BrandColor.Ink.copy(alpha = 0.4f))
                    // #556: the capsule has to have an EDGE, in either theme.
                    //
                    // It was BrandColor.Ink (0x1A1A1A) in BOTH. On the paper
                    // canvas that is the design -- a dark control on a light
                    // ground. On the DARK canvas (0x151515) it is five parts in
                    // 255, and the app's most-used control stopped being a
                    // control and became five icons loose at the bottom of the
                    // screen. Rendered and measured: a luminance standoff of
                    // 0.851 in light against 0.024 in dark.
                    //
                    // The shadow does not rescue it -- a shadow whose spot
                    // colour is Ink casts nothing onto a near-black ground,
                    // which is the general reason dark themes express elevation
                    // as a LIGHTER SURFACE rather than as a drop shadow. So the
                    // capsule rises to the top of the dark elevation ladder and
                    // takes the hairline the palette already names for edges.
                    // Both are existing tokens; no new colour was invented for
                    // this.
                    .background(
                        if (isSystemInDarkTheme()) BrandColor.DarkRaised else BrandColor.Ink,
                        CircleShape,
                    )
                    .then(
                        if (isSystemInDarkTheme()) {
                            Modifier.border(1.dp, BrandColor.DarkOutline, CircleShape)
                        } else {
                            Modifier
                        },
                    )
                    .padding(horizontal = 8.dp),
            ) {
                // During a swipe the circle follows the pager. A tap moves it with a spring.
                slotCenters[highlightedTab]?.let { centerX ->
                    val dragged by pagerState.interactionSource.collectIsDraggedAsState()
                    var followPager by remember { mutableStateOf(false) }
                    LaunchedEffect(dragged, pagerState.isScrollInProgress) {
                        if (dragged) {
                            followPager = true
                        } else if (!pagerState.isScrollInProgress) {
                            followPager = false
                        }
                    }
                    val indicatorX = remember { Animatable(centerX) }
                    LaunchedEffect(followPager) {
                        if (followPager) {
                            snapshotFlow {
                                val blend = shellIndicatorBlend(
                                    pagerState.currentPage,
                                    pagerState.currentPageOffsetFraction,
                                    pagerState.pageCount,
                                )
                                val from = slotCenters[shellTabForPage(blend.fromPage)]
                                val to = slotCenters[shellTabForPage(blend.toPage)]
                                if (from == null || to == null) {
                                    null
                                } else {
                                    shellIndicatorCenter(from, to, blend.fraction)
                                }
                            }.collect { x -> if (x != null) indicatorX.snapTo(x) }
                        }
                    }
                    // On release the settle lands the circle ON the target
                    // slot, so this spring starts from rest and moves only
                    // when the target actually differs (taps, relayouts).
                    LaunchedEffect(centerX, followPager) {
                        if (!followPager) {
                            indicatorX.animateTo(
                                targetValue = centerX,
                                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                            )
                        }
                    }
                    Box(
                        Modifier
                            .align(Alignment.CenterStart)
                            .offset {
                                IntOffset((indicatorX.value - 23.dp.toPx()).roundToInt(), 0)
                            }
                            .size(46.dp)
                            .background(BrandColor.Paper, CircleShape),
                    )
                }
                Row(
                    Modifier.fillMaxSize().selectableGroup(),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    NavSlot(
                        Icons.Outlined.Bolt, t(ShellTab.ForYou.labelKey), tab == ShellTab.ForYou,
                        attention = counts.forYou > 0,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.ForYou] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.ForYou) }
                    NavSlot(
                        Icons.Outlined.Inbox, t("shell.navConversations"), highlightedTab == ShellTab.Inbox,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Inbox] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(conversationsTab) }
                    NavSlot(
                        Icons.Outlined.Checklist, t(ShellTab.Tasks.labelKey), tab == ShellTab.Tasks,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Tasks] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.Tasks) }
                    NavSlot(
                        Icons.Outlined.AutoAwesome, t(ShellTab.Lou.labelKey), tab == ShellTab.Lou,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Lou] = it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.Lou) }
                    NavSlot(
                        Icons.Outlined.MoreHoriz, t("shell.navMore"), tab == ShellTab.Contacts,
                        attention = unreadNotifications > 0,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Contacts] = it.positionInParent().x + it.size.width / 2f
                        },
                    ) {
                        haptics.tap()
                        onOpenAccountSheet()
                    }
                }
            }

            // The one place a floating action may live: ABOVE the gradient and
            // the pill (66dp pill + 14dp inset + 12dp gap), so it can never be
            // underdrawn (#173). Tabs provide it via the MainShell parameter.
            floatingAction?.let { action ->
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .navigationBarsPadding()
                        .padding(end = 18.dp, bottom = 92.dp),
                ) { action() }
            }
        }
    }
}

@Composable
private fun NavSlot(
    icon: ImageVector,
    contentDescription: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    attention: Boolean = false,
    onClick: () -> Unit,
) {
    // The paper circle itself lives in the parent Box and glides between
    // slots; the slot only cross-fades its icon between ink-on-paper and
    // dim paper, and gives slightly under the finger.
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(
        targetValue = if (selected) BrandColor.Ink else BrandColor.Paper.copy(alpha = 0.52f),
        label = "nav-slot-tint",
    )
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = Color.Transparent,
        contentColor = tint,
        interactionSource = interaction,
        modifier = modifier
            .size(46.dp)
            .pressScale(interaction)
            // Announce the active tab's selected state to accessibility
            // (this.selected = the SemanticsPropertyReceiver property).
            .asTab(selected),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(IconSize.Large))
            if (attention) AttentionDot(Modifier.align(Alignment.TopEnd).padding(4.dp), size = 8.dp)
        }
    }
}

/** Live nav counts feeding screen headers ("5 things need you"). The avatar's
 *  coral dot is NOT here: it reads the shared CacheKeys.unreadNotifications
 *  predicate the notifications screen maintains (#201), never a parallel
 *  count that read mutations can't reach. */
data class ShellCounts(
    val forYou: Int = 0,
    val unreadConversations: Int = 0,
    val openTasks: Int = 0,
) {
    fun updating(forYou: Int?, unread: Int?, openTasks: Int?): ShellCounts = copy(
        forYou = forYou ?: this.forYou,
        unreadConversations = unread ?: unreadConversations,
        openTasks = openTasks ?: this.openTasks,
    )
}

internal suspend fun <T> readShellData(read: suspend () -> T): T? = try {
    read()
} catch (cause: CancellationException) {
    throw cause
} catch (_: Exception) {
    null
}

/** Routes the active tab to its feature entry. */
@Composable
fun ShellContent(
    tab: ShellTab,
    graph: AppGraph,
    me: Me,
    companyId: String,
    modifier: Modifier = Modifier,
    onOpenThread: (conversationId: String, highlightMessageId: String?, findQuery: String?) -> Unit,
    onOpenTask: (taskId: String) -> Unit,
    onOpenContact: (contactId: String) -> Unit,
    onOpenNotifications: () -> Unit,
    onComposeNew: (prefillContactId: String?) -> Unit,
    /** #459: text a raw number from the dialer, with no contact to point at. */
    onComposeTo: (phone: String) -> Unit,
    /** #459: the dialer's way out to the contacts list. */
    onOpenContacts: () -> Unit,
    /** #503: the waiting-room card's route into a settings section. */
    onOpenSettings: (SettingsSection) -> Unit,
    onOpenCalls: () -> Unit,
    /** #734: a call row's Details action, by the call's carrier session id. */
    onOpenCall: (sessionId: String) -> Unit = {},
    /**
     * #508: the response-time card's unanswered row. Switches to the Inbox tab
     * landed on the matching filter, rather than pushing a route — one inbox,
     * arrived at differently.
     */
    onOpenUnanswered: () -> Unit,
    /** #508: the filter the inbox should land on, and the way to report it applied. */
    inboxDestination: InboxDestination?,
    onInboxDestinationConsumed: () -> Unit,
    onViewedConversationChanged: (conversationId: String?) -> Unit,
    selectedLine: PhoneNumberSummary? = null,
    onSelectLine: (String?) -> Unit = {},
    onSelectConversationsTab: (ShellTab) -> Unit = {},
) {
    when (tab) {
        ShellTab.Inbox, ShellTab.Calls -> Column(modifier) {
            ConversationsHeader(me.company?.numbers.orEmpty(), selectedLine, onSelectLine, tab, onSelectConversationsTab)
            if (tab == ShellTab.Inbox) {
                InboxTab(
                    graph, companyId, me,
                    destination = inboxDestination,
                    onDestinationConsumed = onInboxDestinationConsumed,
                    onOpenThread = onOpenThread,
                    onOpenTask = onOpenTask,
                    onComposeNew = onComposeNew,
                    modifier = Modifier.weight(1f),
                    phoneLineId = selectedLine?.id,
                    onSelectPhoneLine = onSelectLine,
                )
            } else {
                CallsScreen(
                    graph, companyId, me, Modifier.weight(1f),
                    openConversation = { onOpenThread(it, null, null) },
                    onComposeTo = onComposeTo,
                    onOpenContact = onOpenContact,
                    onOpenContacts = onOpenContacts,
                    onOpenCall = onOpenCall,
                    onOpenAiSettings = { onOpenSettings(SettingsSection.Ai) },
                    phoneLineId = selectedLine?.id,
                )
            }
        }
        ShellTab.ForYou -> ForYouTab(
            graph, companyId, me, modifier,
            onOpenCalls = onOpenCalls,
            onOpenThread = { onOpenThread(it, null, null) },
            onOpenTask = onOpenTask,
            onOpenNotifications = onOpenNotifications,
            onOpenUnanswered = onOpenUnanswered,
            // #503: the waiting-room card's three setup buttons. Contacts is a
            // TAB and the other two are settings sections, which is why this is
            // two callbacks rather than one.
            onOpenContacts = onOpenContacts,
            onOpenSettings = onOpenSettings,
        )

        ShellTab.Lou -> LouTab(graph, companyId, me, modifier, onOpenCall)

        ShellTab.Tasks -> TasksTab(
            graph, companyId, me, modifier,
            onOpenTask = onOpenTask,
        )

        ShellTab.Contacts -> ContactsTab(
            graph, companyId, modifier,
            me = me,
            onOpenContact = onOpenContact,
            onComposeNew = { contactId -> onComposeNew(contactId) },
            onComposeTo = onComposeTo,
        )
    }
}
