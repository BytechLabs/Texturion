package com.loonext.android.features.thread

import android.content.Context
import androidx.annotation.Keep
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.loonext.android.LoonextApp
import java.io.IOException

@Keep
class OutboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as LoonextApp).graph
        return try {
            val result = graph.outbox.flush()
            if (result.stillQueued.isEmpty()) Result.success() else Result.retry()
        } catch (_: IOException) {
            Result.retry()
        }
    }
}

internal object OutboxWork {
    private const val NAME = "sms-outbox"

    fun enqueue(context: Context) {
        val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<OutboxWorker>().setConstraints(connected).build()
        WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
}
