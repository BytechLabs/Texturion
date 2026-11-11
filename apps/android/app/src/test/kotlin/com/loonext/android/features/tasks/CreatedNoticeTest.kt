package com.loonext.android.features.tasks

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.ui.common.NOTICE_ACTION_WINDOW_MS
import org.junit.Assert.assertEquals
import org.junit.Test

/** #724: the Open on a creation notice is the catalogue word and lasts as long as an Undo. */
class CreatedNoticeTest {
    @Test
    fun `open stays up as long as an undo notice`() {
        // A phone holds an action notice 10 seconds, as iOS does (docs/UNDO-AUDIT.md §3).
        assertEquals(10_000L, NOTICE_ACTION_WINDOW_MS)
    }

    @Test
    fun `open is in both languages`() {
        assertEquals("Open", AppStrings.translate(null, "common.open"))
        assertEquals("Ouvrir", AppStrings.translate("fr-CA", "common.open"))
    }
}
