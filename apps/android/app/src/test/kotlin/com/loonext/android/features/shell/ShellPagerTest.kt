package com.loonext.android.features.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #203: the shell pager's pure decisions — page<->tab mapping (Contacts is
 * NOT pageable) and the pill indicator's blend math driven by the pager's
 * continuous scroll position.
 */
class ShellPagerTest {

    // ---- page <-> tab mapping ---------------------------------------------

    @Test
    fun `the four nav slots map to pages in slot order`() {
        assertEquals(
            listOf(ShellTab.ForYou, ShellTab.Inbox, ShellTab.Calls, ShellTab.Tasks),
            SHELL_PAGE_TABS,
        )
        assertEquals(0, shellPageForTab(ShellTab.ForYou))
        assertEquals(1, shellPageForTab(ShellTab.Inbox))
        assertEquals(2, shellPageForTab(ShellTab.Calls))
        assertEquals(3, shellPageForTab(ShellTab.Tasks))
    }

    @Test
    fun `contacts is a You-sheet surface, never a page`() {
        assertNull(shellPageForTab(ShellTab.Contacts))
    }

    @Test
    fun `page to tab round-trips for every pageable tab`() {
        SHELL_PAGE_TABS.forEachIndexed { page, tab ->
            assertEquals(tab, shellTabForPage(page))
            assertEquals(page, shellPageForTab(tab))
        }
    }

    @Test
    fun `out-of-range pages clamp to the edges instead of crashing`() {
        assertEquals(ShellTab.ForYou, shellTabForPage(-1))
        assertEquals(ShellTab.Tasks, shellTabForPage(SHELL_PAGE_TABS.size))
        assertEquals(ShellTab.Tasks, shellTabForPage(99))
    }

    // ---- indicator blend ---------------------------------------------------

    @Test
    fun `at rest the blend is a single anchor with zero fraction`() {
        val blend = shellIndicatorBlend(currentPage = 1, offsetFraction = 0f, pageCount = 4)
        assertEquals(1, blend.fromPage)
        assertEquals(0f, blend.fraction, 0f)
    }

    @Test
    fun `a positive offset blends toward the NEXT page by the offset`() {
        val blend = shellIndicatorBlend(currentPage = 1, offsetFraction = 0.3f, pageCount = 4)
        assertEquals(1, blend.fromPage)
        assertEquals(2, blend.toPage)
        assertEquals(0.3f, blend.fraction, 1e-6f)
    }

    @Test
    fun `a negative offset blends toward the PREVIOUS page by its magnitude`() {
        val blend = shellIndicatorBlend(currentPage = 2, offsetFraction = -0.4f, pageCount = 4)
        assertEquals(2, blend.fromPage)
        assertEquals(1, blend.toPage)
        assertEquals(0.4f, blend.fraction, 1e-6f)
    }

    @Test
    fun `overscroll at the first page degenerates to a still anchor`() {
        val blend = shellIndicatorBlend(currentPage = 0, offsetFraction = -0.2f, pageCount = 4)
        assertEquals(0, blend.fromPage)
        assertEquals(0, blend.toPage)
        assertEquals(0f, blend.fraction, 0f)
    }

    @Test
    fun `overscroll at the last page degenerates to a still anchor`() {
        val blend = shellIndicatorBlend(currentPage = 3, offsetFraction = 0.2f, pageCount = 4)
        assertEquals(3, blend.fromPage)
        assertEquals(3, blend.toPage)
        assertEquals(0f, blend.fraction, 0f)
    }

    @Test
    fun `an out-of-range current page clamps before blending`() {
        val blend = shellIndicatorBlend(currentPage = 9, offsetFraction = 0.5f, pageCount = 4)
        assertEquals(3, blend.fromPage)
        assertEquals(3, blend.toPage)
        assertEquals(0f, blend.fraction, 0f)
    }

    @Test
    fun `an empty pager yields the inert zero blend`() {
        val blend = shellIndicatorBlend(currentPage = 0, offsetFraction = 0.5f, pageCount = 0)
        assertEquals(IndicatorBlend(0, 0, 0f), blend)
    }

    // ---- indicator center lerp --------------------------------------------

    @Test
    fun `center lerp hits both endpoints and the midpoint`() {
        assertEquals(100f, shellIndicatorCenter(100f, 200f, 0f), 0f)
        assertEquals(200f, shellIndicatorCenter(100f, 200f, 1f), 0f)
        assertEquals(150f, shellIndicatorCenter(100f, 200f, 0.5f), 0f)
    }

    @Test
    fun `center lerp works right-to-left too`() {
        assertEquals(175f, shellIndicatorCenter(200f, 100f, 0.25f), 0f)
    }
}
