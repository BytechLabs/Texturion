package com.loonext.android.features.shell

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.features.calls.CallsScreen
import com.loonext.android.features.contacts.ContactsTab
import com.loonext.android.features.foryou.ForYouTab
import com.loonext.android.features.inbox.InboxTab
import com.loonext.android.features.tasks.TasksTab
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.theme.BrandColor

enum class ShellTab(val label: String) {
    ForYou("For you"),
    Inbox("Inbox"),
    Calls("Calls"),
    Tasks("Tasks"),

    /** Not a nav slot — reached from the You sheet (design IA). */
    Contacts("Contacts"),
}

/**
 * The mobile shell (Loonext Mobile.dc.html): content runs edge-to-edge and the
 * FLOATING DARK PILL nav sits over it — ink capsule, 14dp inset, four icon
 * slots (For you · Inbox · Calls · Tasks) + the avatar. The active slot is a
 * paper circle; a coral dot on the avatar means unread notifications. A canvas
 * gradient fades content out behind the pill. No labels, no numeral badges —
 * the design keeps the nav silent.
 */
@Composable
fun MainShell(
    me: Me,
    counts: ShellCounts,
    unreadNotifications: Int,
    tab: ShellTab,
    onTabChange: (ShellTab) -> Unit,
    onCompose: () -> Unit,
    onOpenAccountSheet: () -> Unit,
    floatingAction: (@Composable () -> Unit)? = null,
    content: @Composable (ShellTab, Modifier) -> Unit,
) {
    // Surface, NOT Box+background: a Surface establishes LocalContentColor
    // (onBackground). With a bare background modifier the ambient content color
    // stayed the default BLACK app-wide, so every Text without an explicit
    // color rendered black in DARK theme too (founder: unreadable inbox names —
    // #174's root cause).
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            // ONE inset policy for every tab (#172): status bar at the top;
            // at the bottom whichever is TALLER — nav-bar + pill clearance
            // (14dp inset + 66dp pill = 80dp) or the keyboard (#187) — so a
            // focused tab input rides above the ime without stacking the pill
            // clearance on top of it. The old fixed 96dp ignored the system
            // nav inset, leaving list tails under the pill on 3-button nav.
            // Screens must NOT add their own statusBarsPadding or imePadding
            // on top of this; inset consumption makes leftovers no-ops.
            content(
                tab,
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .windowInsetsPadding(
                        WindowInsets.navigationBars
                            .add(WindowInsets(bottom = 80.dp))
                            .union(WindowInsets.ime),
                    ),
            )

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

            val haptics = rememberHaptics()
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
                    .height(66.dp)
                    .shadow(24.dp, CircleShape, spotColor = BrandColor.Ink.copy(alpha = 0.4f))
                    .background(BrandColor.Ink, CircleShape)
                    .padding(horizontal = 8.dp),
            ) {
                // The active paper circle GLIDES between slots instead of
                // jumping (#194): every slot reports its center and the
                // indicator springs to the selected one. It hides entirely
                // when the active surface has no slot (Contacts rides the
                // You sheet, not the pill).
                slotCenters[tab]?.let { centerX ->
                    val indicatorX by animateFloatAsState(
                        targetValue = centerX,
                        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                        label = "navIndicatorX",
                    )
                    Box(
                        Modifier
                            .align(Alignment.CenterStart)
                            .offset { IntOffset((indicatorX - 23.dp.toPx()).roundToInt(), 0) }
                            .size(46.dp)
                            .background(BrandColor.Paper, CircleShape),
                    )
                }
                Row(
                    Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    NavSlot(
                        Icons.Outlined.Bolt, "For you", tab == ShellTab.ForYou,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.ForYou] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.ForYou) }
                    NavSlot(
                        Icons.Outlined.Inbox, "Inbox", tab == ShellTab.Inbox,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Inbox] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.Inbox) }
                    NavSlot(
                        Icons.Outlined.Call, "Calls", tab == ShellTab.Calls,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Calls] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.Calls) }
                    NavSlot(
                        Icons.Outlined.Checklist, "Tasks", tab == ShellTab.Tasks,
                        modifier = Modifier.onGloballyPositioned {
                            slotCenters[ShellTab.Tasks] =
                                it.positionInParent().x + it.size.width / 2f
                        },
                    ) { selectTab(ShellTab.Tasks) }
                    Box(Modifier.padding(horizontal = 6.dp)) {
                        val avatarInteraction = remember { MutableInteractionSource() }
                        Box(
                            Modifier
                                .size(34.dp)
                                .pressScale(avatarInteraction)
                                .clickable(
                                    interactionSource = avatarInteraction,
                                    indication = LocalIndication.current,
                                ) {
                                    haptics.tap()
                                    onOpenAccountSheet()
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            InitialsAvatar(me.display_name.ifBlank { null }, size = 34.dp)
                        }
                        if (unreadNotifications > 0) {
                            AttentionDot(
                                Modifier.align(Alignment.TopEnd),
                                size = 9.dp,
                            )
                        }
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
    onClick: () -> Unit,
) {
    // The paper circle itself lives in the parent Box and glides between
    // slots; the slot only cross-fades its icon between ink-on-paper and
    // dim paper, and gives slightly under the finger.
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(
        targetValue = if (selected) BrandColor.Ink else BrandColor.Paper.copy(alpha = 0.52f),
        label = "navSlotTint",
    )
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = Color.Transparent,
        contentColor = tint,
        interactionSource = interaction,
        modifier = modifier
            .size(46.dp)
            .pressScale(interaction),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(20.dp))
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
)

/** Routes the active tab to its feature entry. */
@Composable
fun ShellContent(
    tab: ShellTab,
    graph: AppGraph,
    me: Me,
    companyId: String,
    modifier: Modifier = Modifier,
    onOpenThread: (conversationId: String, highlightMessageId: String?) -> Unit,
    onOpenTask: (taskId: String) -> Unit,
    onOpenContact: (contactId: String) -> Unit,
    onOpenNotifications: () -> Unit,
    onComposeNew: (prefillContactId: String?) -> Unit,
    onOpenCalls: () -> Unit,
    onViewedConversationChanged: (conversationId: String?) -> Unit,
) {
    when (tab) {
        ShellTab.ForYou -> ForYouTab(
            graph, companyId, me, modifier,
            onOpenCalls = onOpenCalls,
            onOpenThread = { onOpenThread(it, null) },
            onOpenNotifications = onOpenNotifications,
        )

        ShellTab.Inbox -> InboxTab(
            graph, companyId, me, modifier,
            onOpenThread = onOpenThread,
            onOpenTask = onOpenTask,
            onComposeNew = onComposeNew,
        )

        ShellTab.Calls -> CallsScreen(
            graph, companyId, me, modifier,
            openConversation = { onOpenThread(it, null) },
        )

        ShellTab.Tasks -> TasksTab(
            graph, companyId, me, modifier,
            onOpenTask = onOpenTask,
        )

        ShellTab.Contacts -> ContactsTab(
            graph, companyId, modifier,
            me = me,
            onOpenContact = onOpenContact,
            onComposeNew = { contactId -> onComposeNew(contactId) },
        )
    }
}
