package com.loonext.android.core.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.stateIn

class ConnectionWatch(context: Context, scope: CoroutineScope) {
    val offline: StateFlow<Boolean> = callbackFlow {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return@callbackFlow
        val handler = Handler(Looper.getMainLooper())
        val callback = object : ConnectivityManager.NetworkCallback() {
            private var current: Network? = null

            override fun onAvailable(network: Network) {
                current = network
                trySend(false)
            }

            override fun onLost(network: Network) {
                if (current == network) {
                    current = null
                    trySend(true)
                }
            }
        }
        if (runCatching { manager.registerDefaultNetworkCallback(callback, handler) }.isFailure) {
            return@callbackFlow
        }
        // Read the initial network on the same queue as the change callbacks.
        val initial = Runnable {
            runCatching { manager.activeNetwork == null }.onSuccess { trySend(it) }
        }
        handler.post(initial)
        awaitClose {
            handler.removeCallbacks(initial)
            runCatching { manager.unregisterNetworkCallback(callback) }
        }
    }.stateIn(scope, SharingStarted.Eagerly, false)
}
