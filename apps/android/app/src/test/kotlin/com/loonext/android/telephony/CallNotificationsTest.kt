package com.loonext.android.telephony

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import com.loonext.android.push.ensureChannels
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The incoming ring repeats like a phone's until a teardown cancels it, on a channel whose
 * sound and vibration were set for that. A plain Application keeps the app's own startup
 * from creating channels before each test does.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CallNotificationsTest {
    private val context: Application = RuntimeEnvironment.getApplication()
    private val manager: NotificationManager = context.getSystemService(NotificationManager::class.java)

    @Before
    fun grantNotifications() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun posted(session: String): Notification? =
        manager.activeNotifications.singleOrNull { it.tag == "call:$session" }?.notification

    @Test
    fun `the incoming ring repeats until cancelled, on the v2 calls channel`() {
        assertTrue(CallNotifier(context).showIncoming("s1", "Sam", "+15551230000"))

        val ring = requireNotNull(posted("s1")) { "no ring posted" }
        assertTrue("FLAG_INSISTENT", ring.flags and Notification.FLAG_INSISTENT != 0)
        assertEquals("incoming_calls_v2", ring.channelId)
    }

    @Test
    fun `the v2 calls channel rings with the ringtone and buzzes a second on, a second off`() {
        ensureChannels(context)

        val channel = requireNotNull(manager.getNotificationChannel("incoming_calls_v2")) { "no v2 channel" }
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        assertEquals(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), channel.sound)
        assertEquals(AudioAttributes.USAGE_NOTIFICATION_RINGTONE, channel.audioAttributes.usage)
        assertTrue(channel.shouldVibrate())
        assertArrayEquals(longArrayOf(0, 1000, 1000), channel.vibrationPattern)
    }

    @Test
    fun `the old calls channel is gone after ensureChannels`() {
        manager.createNotificationChannel(
            NotificationChannel("incoming_calls", "Incoming calls", NotificationManager.IMPORTANCE_HIGH),
        )

        ensureChannels(context)

        assertNull(manager.getNotificationChannel("incoming_calls"))
        assertNotNull(manager.getNotificationChannel("incoming_calls_v2"))
    }

    @Test
    fun `a member's choices on the old calls channel carry over`() {
        manager.createNotificationChannel(
            NotificationChannel("incoming_calls", "Incoming calls", NotificationManager.IMPORTANCE_LOW).apply {
                setSound(null, null)
                enableVibration(false)
            },
        )

        ensureChannels(context)

        val channel = requireNotNull(manager.getNotificationChannel("incoming_calls_v2")) { "no v2 channel" }
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
        assertNull("the member silenced it", channel.sound)
        assertFalse("the member turned vibration off", channel.shouldVibrate())
    }

    @Test
    fun `the silent connecting notice for an outbound dial does not repeat`() {
        CallNotifier(context).showConnecting("s2", "Sam")

        val connecting = requireNotNull(posted("s2")) { "no connecting notice posted" }
        assertEquals(0, connecting.flags and Notification.FLAG_INSISTENT)
    }

    @Test
    fun `Decline on the ring stops it`() {
        CallNotifier(context).showIncoming("s3", "Sam", "+15551230000")
        assertNotNull(posted("s3"))

        CallActionReceiver().onReceive(
            context,
            Intent(CallNotifier.ACTION_DECLINE).putExtra(CallNotifier.EXTRA_SESSION, "s3"),
        )

        assertNull(posted("s3"))
    }
}
