package com.loonext.android.core.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import org.junit.rules.ExternalResource
import org.junit.rules.TemporaryFolder

class SessionPreferencesRule : ExternalResource() {
    private val directory = TemporaryFolder()
    private val scope = CoroutineScope(Dispatchers.IO)

    lateinit var dataStore: DataStore<Preferences>
        private set

    override fun before() {
        directory.create()
        val file = directory.root.resolve("session.preferences_pb")
        dataStore = PreferenceDataStoreFactory.create(scope = scope) { file }
    }

    override fun after() {
        runBlocking { scope.coroutineContext.job.cancelAndJoin() }
        directory.delete()
    }
}
