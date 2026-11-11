package com.loonext.android.ui.common

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #733: an icon is one of three sizes, [IconSize.Small], [IconSize.Default] or
 * [IconSize.Large]. Fails on an `Icon` whose `size(...)` is a dp literal outside
 * the tokens. An avatar, an illustration or the call screen keeps its own number,
 * named below with why.
 */
class IconSizeGuardTest {
    private val rule = "an Icon sized with a dp literal"

    private val guard = PatternGuard(
        name = "IconSizeGuardTest",
        home = setOf("ui/common/IconSize.kt"),
        rules = listOf(
            callRule(rule, "Icon", Regex("""\.(?:size|requiredSize)\([^)]*\d\.dp""")),
        ),
        roster = listOf(
            GuardException(
                "features/calls/InCallScreen.kt", rule, 1,
                "the call screen: its answer, decline and mute buttons are sized for a gloved thumb and are not list-row icons",
            ),
            GuardException(
                "features/calls/DialerSheet.kt", rule, 2,
                "the dialer pad: its glyphs scale with the key (a dp literal times the font scale), like the call screen",
            ),
            GuardException(
                "core/update/UpdatePrompt.kt", rule, 1,
                "an illustration: the 40dp glyph is the picture on the update screen, not a row icon",
            ),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no Icon sized outside the tokens`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()

    @Test
    fun `the three sizes are distinct and ordered`() {
        assertEquals(listOf(14.dp, 18.dp, 20.dp), listOf(IconSize.Small, IconSize.Default, IconSize.Large))
    }
}
