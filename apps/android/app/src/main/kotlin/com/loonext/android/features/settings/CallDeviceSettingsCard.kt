package com.loonext.android.features.settings

import android.app.ActivityManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.loonext.android.core.i18n.t
import com.loonext.android.push.ChannelIds
import com.loonext.android.telephony.RingBeaconPermission
import com.loonext.android.telephony.collectRingBeaconDevice
import com.loonext.android.ui.common.InlineError
import com.loonext.android.ui.common.LinkButton

internal enum class CallDeviceSetting(val label: String) {
    NOTIFICATIONS("callDevice.notifications"),
    CHANNEL_BLOCKED("callDevice.channelBlocked"),
    CHANNEL_SILENT("callDevice.channelSilent"),
    DO_NOT_DISTURB("callDevice.doNotDisturb"),
    STANDBY("callDevice.standby"),
    BATTERY_RESTRICTED("callDevice.batteryRestricted"),
    BATTERY_SAVER("callDevice.batterySaver"),
    FULL_SCREEN("callDevice.fullScreen"),
    MICROPHONE("callDevice.microphone");

    fun settingsIntent(packageName: String): Intent = when (this) {
        NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        CHANNEL_BLOCKED, CHANNEL_SILENT -> Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, ChannelIds.INCOMING_CALLS)
        DO_NOT_DISTURB -> Intent(Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS)
        STANDBY, BATTERY_RESTRICTED -> {
            if (Build.VERSION.SDK_INT >= 29) {
                Intent(Settings.ACTION_APP_USAGE_SETTINGS).putExtra(Intent.EXTRA_PACKAGE_NAME, packageName)
            } else {
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            }
        }
        BATTERY_SAVER -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
        FULL_SCREEN -> Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageUri(packageName))
        MICROPHONE -> applicationDetails(packageName)
    }
}

private fun packageUri(packageName: String): Uri = Uri.fromParts("package", packageName, null)

private fun applicationDetails(packageName: String): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(packageName))

internal fun readCallDeviceSettings(context: Context): List<CallDeviceSetting> {
    val notifications = context.getSystemService(NotificationManager::class.java)
    val channel = notifications?.getNotificationChannel(ChannelIds.INCOMING_CALLS)
    val device = collectRingBeaconDevice(context)
    return buildList {
        if (device.permissions[RingBeaconPermission.NOTIFICATIONS] == false) {
            add(CallDeviceSetting.NOTIFICATIONS)
        }
        if (channel != null) {
            val noSoundOrVibration = channel.sound == null && !channel.shouldVibrate()
            when {
                channel.importance == NotificationManager.IMPORTANCE_NONE -> add(CallDeviceSetting.CHANNEL_BLOCKED)
                channel.importance < NotificationManager.IMPORTANCE_DEFAULT || noSoundOrVibration ->
                    add(CallDeviceSetting.CHANNEL_SILENT)
            }
        }
        val filter = notifications?.currentInterruptionFilter
        if (filter == NotificationManager.INTERRUPTION_FILTER_NONE ||
            filter == NotificationManager.INTERRUPTION_FILTER_ALARMS ||
            (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY && channel?.canBypassDnd() != true)
        ) {
            add(CallDeviceSetting.DO_NOT_DISTURB)
        }
        if (device.standbyBucket == "rare" || device.standbyBucket == "restricted") {
            add(CallDeviceSetting.STANDBY)
        }
        if (context.getSystemService(ActivityManager::class.java)?.isBackgroundRestricted == true) {
            add(CallDeviceSetting.BATTERY_RESTRICTED)
        }
        if (device.powerSave == true) add(CallDeviceSetting.BATTERY_SAVER)
        if (device.permissions[RingBeaconPermission.FULL_SCREEN_INTENT] == false) {
            add(CallDeviceSetting.FULL_SCREEN)
        }
        if (device.permissions[RingBeaconPermission.MICROPHONE] == false) {
            add(CallDeviceSetting.MICROPHONE)
        }
    }
}

private fun Context.openCallDeviceSettings(setting: CallDeviceSetting): Boolean {
    return listOf(setting.settingsIntent(packageName), applicationDetails(packageName))
        .distinctBy { it.action }
        .any { intent ->
            try {
                startActivity(intent)
                true
            } catch (_: ActivityNotFoundException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }
}

@Composable
internal fun CallDeviceSettingsCard() {
    val context = LocalContext.current
    var settings by remember(context) { mutableStateOf(readCallDeviceSettings(context)) }
    var launchFailed by remember { mutableStateOf(false) }
    LifecycleResumeEffect(context) {
        settings = readCallDeviceSettings(context)
        onPauseOrDispose { }
    }
    SettingsCard(title = t("callDevice.title"), description = t("callDevice.description")) {
        if (settings.isEmpty()) Text(t("callDevice.ready"))
        for (setting in settings) {
            LinkButton(onClick = { launchFailed = !context.openCallDeviceSettings(setting) }) {
                Text(t(setting.label))
            }
        }
        InlineError(if (launchFailed) t("callDevice.openFailed") else null)
    }
}
