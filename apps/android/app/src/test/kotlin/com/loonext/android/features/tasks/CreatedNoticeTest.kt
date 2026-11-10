package com.loonext.android.features.tasks

import androidx.compose.material3.SnackbarDuration
import com.loonext.android.core.i18n.AppStrings
import org.junit.Assert.assertEquals
import org.junit.Test

/** #724: the Open on a creation notice is the catalogue word and lasts as long as an Undo. */
class CreatedNoticeTest {
    @Test
    fun `open stays up as long as an undo notice`() {
        assertEquals(SnackbarDuration.Long, CreatedNoticeDuration)
    }

    @Test
    fun `open is in both languages`() {
        assertEquals("Open", AppStrings.translate(null, "common.open"))
        assertEquals("Ouvrir", AppStrings.translate("fr-CA", "common.open"))
    }
}
