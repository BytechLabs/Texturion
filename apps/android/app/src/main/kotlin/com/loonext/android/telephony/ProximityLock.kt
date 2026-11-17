package com.loonext.android.telephony

import android.content.Context
import android.os.PowerManager
import androidx.core.telecom.CallEndpointCompat

internal fun shouldHoldProximityLock(phase: CallPhase?, endpointType: Int?): Boolean =
    phase == CallPhase.ACTIVE && endpointType == CallEndpointCompat.TYPE_EARPIECE

internal class ProximityLock(context: Context) {
    private val wakeLock by lazy {
        val power = context.getSystemService(PowerManager::class.java)
        val level = PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK
        power?.takeIf { it.isWakeLockLevelSupported(level) }
            ?.newWakeLock(level, "loonext:call-proximity")
            ?.apply { setReferenceCounted(false) }
    }

    fun setHeld(hold: Boolean) {
        val lock = wakeLock ?: return
        if (hold == lock.isHeld) return
        if (hold) {
            lock.acquire()
        } else {
            lock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
        }
    }
}
