package com.loonext.android.features.settings

import android.Manifest
import android.app.ActivityManager
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import com.loonext.android.push.ChannelIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CallDeviceSettingsTest {
    private val context: Application = RuntimeEnvironment.getApplication()
    private val notifications = context.getSystemService(NotificationManager::class.java)

    @Before
    fun grantPermissions() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.RECORD_AUDIO)
    }

    @Test
    fun `blocked incoming channel appears separately from the app permission`() {
        notifications.createNotificationChannel(
            NotificationChannel(ChannelIds.INCOMING_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_NONE),
        )

        val settings = readCallDeviceSettings(context)

        assertTrue(CallDeviceSetting.CHANNEL_BLOCKED in settings)
        assertFalse(CallDeviceSetting.CHANNEL_SILENT in settings)
        assertFalse(CallDeviceSetting.NOTIFICATIONS in settings)
    }

    @Test
    fun `a muted channel can still vibrate`() {
        notifications.createNotificationChannel(
            NotificationChannel(ChannelIds.INCOMING_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(true)
            },
        )

        assertFalse(CallDeviceSetting.CHANNEL_SILENT in readCallDeviceSettings(context))
    }

    @Test
    fun `silent channel and Android restrictions have actionable rows`() {
        notifications.createNotificationChannel(
            NotificationChannel(ChannelIds.INCOMING_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
            },
        )
        shadowOf(notifications).setNotificationsEnabled(false)
        shadowOf(notifications).setNotificationPolicyAccessGranted(true)
        notifications.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
        shadowOf(context.getSystemService(ActivityManager::class.java)).setBackgroundRestricted(true)
        shadowOf(context.getSystemService(UsageStatsManager::class.java))
            .setCurrentAppStandbyBucket(UsageStatsManager.STANDBY_BUCKET_RARE)
        shadowOf(context.getSystemService(PowerManager::class.java)).setIsPowerSaveMode(true)
        shadowOf(context).denyPermissions(Manifest.permission.RECORD_AUDIO)

        val settings = readCallDeviceSettings(context)

        assertTrue(settings.containsAll(listOf(
            CallDeviceSetting.NOTIFICATIONS,
            CallDeviceSetting.CHANNEL_SILENT,
            CallDeviceSetting.DO_NOT_DISTURB,
            CallDeviceSetting.STANDBY,
            CallDeviceSetting.BATTERY_RESTRICTED,
            CallDeviceSetting.BATTERY_SAVER,
            CallDeviceSetting.MICROPHONE,
        )))
    }

    @Test
    fun `settings intents point at this app and its incoming channel`() {
        val packageName = context.packageName
        val channel = CallDeviceSetting.CHANNEL_SILENT.settingsIntent(packageName)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, channel.action)
        assertEquals(packageName, channel.getStringExtra(Settings.EXTRA_APP_PACKAGE))
        assertEquals(ChannelIds.INCOMING_CALLS, channel.getStringExtra(Settings.EXTRA_CHANNEL_ID))

        val standby = CallDeviceSetting.STANDBY.settingsIntent(packageName)
        assertEquals(Settings.ACTION_APP_USAGE_SETTINGS, standby.action)
        assertEquals(packageName, standby.getStringExtra(Intent.EXTRA_PACKAGE_NAME))

        val fullScreen = CallDeviceSetting.FULL_SCREEN.settingsIntent(packageName)
        assertEquals(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, fullScreen.action)
        assertEquals("package:$packageName", fullScreen.dataString)
    }
}
