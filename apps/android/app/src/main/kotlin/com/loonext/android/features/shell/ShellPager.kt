package com.loonext.android.features.shell

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * #203 shell paging logic: the pure page<->tab mapping and indicator math
 * behind [MainShell]'s HorizontalPager, kept composable-free so JVM tests can
 * pin the decisions.
 *
 * The pageable surfaces are exactly the four pill slots, in slot order.
 * Contacts is deliberately absent: it is a You-sheet surface, not a nav slot
 * (design IA), so it never participates in paging — the shell parks the pager
 * and overlays Contacts above it.
 */
val SHELL_PAGE_TABS: List<ShellTab> = listOf(
    ShellTab.ForYou,
    ShellTab.Inbox,
    ShellTab.Calls,
    ShellTab.Tasks,
)

/** The pager page for a tab, or null for surfaces outside the pager. */
fun shellPageForTab(tab: ShellTab): Int? =
    SHELL_PAGE_TABS.indexOf(tab).takeIf { it >= 0 }

/** The tab a pager page renders; out-of-range pages clamp to the edges. */
fun shellTabForPage(page: Int): ShellTab =
    SHELL_PAGE_TABS[page.coerceIn(0, SHELL_PAGE_TABS.lastIndex)]

/**
 * Which two nav slots the active-circle indicator is between, and how far
 * across it is. Input is the pager's continuous position: [currentPage] plus
 * [offsetFraction] (PagerState.currentPageOffsetFraction, -0.5..0.5 around
 * the current page; a positive offset moves toward the NEXT page). At either
 * end the blend degenerates to a single anchor with fraction 0 so an
 * overscroll can never aim the circle off the pill.
 */
data class IndicatorBlend(val fromPage: Int, val toPage: Int, val fraction: Float)

fun shellIndicatorBlend(
    currentPage: Int,
    offsetFraction: Float,
    pageCount: Int,
): IndicatorBlend {
    if (pageCount <= 0) return IndicatorBlend(0, 0, 0f)
    val last = pageCount - 1
    val from = currentPage.coerceIn(0, last)
    val to = if (offsetFraction >= 0f) {
        (from + 1).coerceAtMost(last)
    } else {
        (from - 1).coerceAtLeast(0)
    }
    if (to == from) return IndicatorBlend(from, to, 0f)
    return IndicatorBlend(from, to, kotlin.math.abs(offsetFraction).coerceIn(0f, 1f))
}

/** Linear blend between two slot centers by [fraction] (0 = from, 1 = to). */
fun shellIndicatorCenter(fromCenter: Float, toCenter: Float, fraction: Float): Float =
    fromCenter + (toCenter - fromCenter) * fraction

/**
 * Escape hatch a PAGE surface uses when its own horizontal gesture cannot
 * coexist with shell paging child-first (#203). Today's one caller: the Tasks
 * map view — its pan lives inside an osmdroid AndroidView, and the deliberate
 * trade is to disable pager drags while the map is the settled surface rather
 * than risk a pan turning into a page (the pill's nav taps still switch tabs,
 * animateScrollToPage ignores userScrollEnabled). Every Compose-native
 * horizontal gesture (SwipeActionRow, sliders, horizontal filter rails) wins
 * over the pager by consuming its drag after slop and must NOT use this.
 *
 * Pages call it with true while the conflicting surface is active and MUST
 * call it with false when the surface goes away (or on dispose). The shell
 * scopes the flag to the providing page, so a stale flag can never lock a
 * different tab.
 */
val LocalShellPagerBlocker = staticCompositionLocalOf<(Boolean) -> Unit> { {} }

/**
 * Whether this composition is the shell pager's SETTLED page (#203). Pages
 * kept composed off-screen (beyondViewportPageCount) must gate global
 * side-channels on this — today the Inbox search's BackHandler, which would
 * otherwise intercept the back button while another tab is showing. Defaults
 * to true so surfaces hosted outside the pager (routes, Contacts) behave as
 * if visible.
 */
val LocalShellPageActive = compositionLocalOf { true }
