package com.loonext.android.features.contacts

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactAutosaveWireTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun leavingContactSavesOnlyTheLatestNotes() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(
                MockResponse(
                    body = """{"id":"contact","phone_e164":"+14165550100","created_at":"2026-11-18","updated_at":"2026-11-18"}""",
                ),
            )
            val apiUrl = server.url("/").toString().trimEnd('/')
            val graph = AppGraph(
                ApplicationProvider.getApplicationContext(),
                supabaseUrl = apiUrl,
                apiUrl = apiUrl,
            )
            try {
                runBlocking {
                    graph.sessionStore.save(
                        Session(
                            accessToken = "test-token",
                            refreshToken = "test-refresh",
                            expiresAt = System.currentTimeMillis() / 1000 + 3600,
                            userId = "member",
                            email = "tester@loonext.test",
                        ),
                    )
                }
                val mutations = ContactMutations(graph.api, apiUrl)
                val visible = mutableStateOf(true)
                compose.setContent {
                    MaterialTheme {
                        if (visible.value) {
                            AutosaveRow(
                                appScope = graph.appScope,
                                fieldKey = "contact:notes",
                                label = "Notes",
                                initial = "old",
                                maxLength = 5_000,
                                placeholder = "Add notes",
                                singleLine = false,
                                save = { mutations.updateField("company", "contact", "notes", it) },
                            )
                        }
                    }
                }

                val field = compose.onNode(hasSetTextAction())
                field.performTextReplacement("first draft")
                field.performTextReplacement(" final notes ")
                assertEquals(0, server.requestCount)
                compose.runOnIdle { visible.value = false }

                compose.waitUntil(timeoutMillis = 5_000) { server.requestCount >= 1 }
                val request = checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
                assertEquals("PATCH", request.method)
                assertEquals("/v1/contacts/contact", request.url.encodedPath)
                assertEquals("company", request.headers["X-Company-Id"])
                val body = Json.parseToJsonElement(request.body?.utf8().orEmpty()).jsonObject
                assertEquals(setOf("notes"), body.keys)
                assertEquals("final notes", body.getValue("notes").jsonPrimitive.content)
                shadowOf(Looper.getMainLooper()).idleFor(1, TimeUnit.SECONDS)
                compose.waitForIdle()
                assertEquals(1, server.requestCount)
            } finally {
                graph.appScope.cancel()
            }
        }
    }
}
