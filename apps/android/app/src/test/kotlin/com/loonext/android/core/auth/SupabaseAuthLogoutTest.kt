package com.loonext.android.core.auth

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test

class SupabaseAuthLogoutTest {
    @Test
    fun `sign out requests only the current device`() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse(code = 204))
            val auth = SupabaseAuth(OkHttpClient(), server.url("/").toString().trimEnd('/'), "test-key")

            auth.signOut("current-session")

            val request = checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
            assertEquals("POST", request.method)
            assertEquals("/auth/v1/logout", request.url.encodedPath)
            assertEquals("local", request.url.queryParameter("scope"))
            assertEquals("Bearer current-session", request.headers["Authorization"])
        }
    }
}
