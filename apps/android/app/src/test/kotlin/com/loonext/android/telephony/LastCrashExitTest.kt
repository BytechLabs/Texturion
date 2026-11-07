package com.loonext.android.telephony

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowActivityManager.ApplicationExitInfoBuilder

/** The interrupted-call line reads the crash the OS recorded, not a file of ours. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LastCrashExitTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun recordExit(reason: Int, atMs: Long) {
        val manager = context.getSystemService(ActivityManager::class.java)
        shadowOf(manager).addApplicationExitInfo(
            ApplicationExitInfoBuilder.newBuilder()
                .setProcessName(context.packageName)
                .setReason(reason)
                .setTimestamp(atMs)
                .build(),
        )
    }

    @Test
    fun `reads the newest crash from the process exit history`() {
        recordExit(ApplicationExitInfo.REASON_CRASH, 1_000L)
        recordExit(ApplicationExitInfo.REASON_USER_REQUESTED, 3_000L)
        recordExit(ApplicationExitInfo.REASON_CRASH_NATIVE, 2_000L)

        assertEquals(2_000L, PostCrashHonesty.lastCrashAtMs(context))
    }

    @Test
    fun `an exit history with no crash in it reports none`() {
        recordExit(ApplicationExitInfo.REASON_USER_REQUESTED, 3_000L)

        assertNull(PostCrashHonesty.lastCrashAtMs(context))
    }
}
