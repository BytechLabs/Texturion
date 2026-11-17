package com.loonext.android.core.net

import android.app.Application
import android.net.ConnectivityManager
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ConnectionWatchTest {
    @Test
    fun `cold offline shows until a path is available and obsolete losses are ignored`() {
        val app = RuntimeEnvironment.getApplication()
        val manager = shadowOf(app.getSystemService(ConnectivityManager::class.java))
        manager.setActiveNetworkInfo(null)
        val scope = CoroutineScope(Dispatchers.Unconfined)

        try {
            val watch = ConnectionWatch(app, scope)
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(watch.offline.value)

            val callback = manager.networkCallbacks.single()
            val wifi = ShadowNetwork.newInstance(100)
            val cellular = ShadowNetwork.newInstance(101)
            callback.onAvailable(wifi)
            assertFalse(watch.offline.value)
            callback.onAvailable(cellular)
            callback.onLost(wifi)
            assertFalse(watch.offline.value)
            callback.onLost(cellular)
            assertTrue(watch.offline.value)
        } finally {
            scope.cancel()
        }
        assertTrue(manager.networkCallbacks.isEmpty())
    }
}
