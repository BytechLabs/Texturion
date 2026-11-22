package com.loonext.android.telephony

import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallForegroundServiceTest {
    private val context = CallServiceContext(ApplicationProvider.getApplicationContext())

    @Test
    fun `idle snapshots do not ask Android to stop the call service`() {
        CallForegroundService.stop(context)
        CallForegroundService.stop(context)

        assertEquals(emptyList<String>(), context.requests)
    }

    @Test
    fun `a failed stop can be retried and a completed stop is not repeated`() {
        CallForegroundService.start(context, "Caller")
        context.failNextStop = true

        CallForegroundService.stop(context)
        CallForegroundService.stop(context)
        CallForegroundService.stop(context)

        assertEquals(listOf("start", "stop", "stop"), context.requests)
    }

    private class CallServiceContext(context: Context) : ContextWrapper(context) {
        val requests = mutableListOf<String>()
        var failNextStop = false

        override fun startForegroundService(service: Intent): ComponentName? {
            requests.add("start")
            return service.component
        }

        override fun stopService(service: Intent): Boolean {
            requests.add("stop")
            if (failNextStop) {
                failNextStop = false
                error("Service manager unavailable")
            }
            return true
        }
    }
}
