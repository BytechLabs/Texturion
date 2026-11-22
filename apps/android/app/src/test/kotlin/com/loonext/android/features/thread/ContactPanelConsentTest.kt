package com.loonext.android.features.thread

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationDetailContact
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.Page
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.features.contacts.ConsentSource
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private const val WORKSPACE = "workspace"
private const val MEMBER = "member"
private const val CREATED_AT = "2026-07-08T15:00:00Z"

private data class ConsentCase(
    val id: String,
    val source: String?,
    val key: String,
    val attestedBy: String? = null,
)

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactPanelConsentTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun threadContactConsentUsesTheReadersLanguage() {
        val cases = listOf(
            ConsentCase("sms", ConsentSource.INBOUND_SMS, "consentTextedFirst"),
            ConsentCase("call", ConsentSource.INBOUND_CALL, "consentCalledFirst"),
            ConsentCase("attested", ConsentSource.ATTESTED, "consentRecordedBy", MEMBER),
            ConsentCase("widget", "widget_form", "consentRecorded"),
            ConsentCase("none", null, "consentNone"),
        )
        val roster = listOf(Member("membership", MEMBER, "owner", created_at = CREATED_AT, display_name = "Dana"))
        val current = mutableStateOf(cases.first())
        val locale = mutableStateOf(MessageLocale.FR_CA)
        val app = ApplicationProvider.getApplicationContext<Application>()

        MockWebServer().use { server ->
            val wire = cases.flatMap { consent ->
                val contact = Contact(
                    id = consent.id,
                    phone_e164 = "+14165550100",
                    name = "Contact ${consent.id}",
                    consent_source = consent.source,
                    consent_attested_by = consent.attestedBy,
                    created_at = CREATED_AT,
                    updated_at = CREATED_AT,
                )
                val detail = ConversationDetail(
                    id = consent.id,
                    company_id = WORKSPACE,
                    contact_id = contact.id,
                    phone_number_id = "line",
                    status = "open",
                    is_spam = false,
                    last_message_at = CREATED_AT,
                    created_at = CREATED_AT,
                    updated_at = CREATED_AT,
                    contact = ConversationDetailContact(
                        id = contact.id,
                        name = contact.name,
                        phone_e164 = contact.phone_e164,
                        consent_source = contact.consent_source,
                    ),
                    messages = Page(data = emptyList()),
                )
                listOf(
                    "/v1/conversations/${consent.id}" to Json.encodeToString(detail),
                    "/v1/contacts/${contact.id}" to Json.encodeToString(contact),
                )
            }.toMap()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    wire[request.url.encodedPath]?.let { MockResponse(body = it) } ?: MockResponse(code = 404)
            }
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val graph = AppGraph(app, supabaseUrl = origin, apiUrl = origin)
            try {
                runBlocking {
                    graph.sessionStore.save(
                        Session(
                            accessToken = "test-token",
                            refreshToken = "test-refresh",
                            expiresAt = System.currentTimeMillis() / 1000 + 3600,
                            userId = MEMBER,
                            email = "tester@loonext.test",
                        ),
                    )
                }
                compose.setContent {
                    key(current.value.id) {
                        val controller = remember {
                            ThreadController(
                                repo = MessagingRepository(graph.api),
                                meRepo = graph.meRepo,
                                uploader = NoteFileUploader(graph.api, origin),
                                appContext = app,
                                cache = graph.storeCache,
                                companyId = WORKSPACE,
                                conversationId = current.value.id,
                                meUserId = MEMBER,
                                scope = graph.appScope,
                                outboxCoordinator = graph.outbox,
                            )
                        }
                        LaunchedEffect(controller) { controller.start() }
                        if (controller.contact != null) {
                            CompositionLocalProvider(LocalAppLocale provides locale.value) {
                                MaterialTheme {
                                    ContactPanelSheet(
                                        graph = graph,
                                        companyId = WORKSPACE,
                                        controller = controller,
                                        members = roster,
                                        onOpenConversation = null,
                                        onOpenTask = null,
                                        onOpenContact = null,
                                        onDismiss = {},
                                    )
                                }
                            }
                        }
                    }
                }
                cases.forEach { consent ->
                    compose.runOnIdle { current.value = consent }
                    val name = "Contact ${consent.id}"
                    compose.waitUntil(timeoutMillis = 5000) {
                        compose.onAllNodesWithText(name).fetchSemanticsNodes().isNotEmpty()
                    }
                    val expected = AppStrings.translate(
                        MessageLocale.FR_CA,
                        "contactsTasks.${consent.key}",
                        mapOf("name" to "Dana"),
                    )
                    compose.onNodeWithText(expected).performScrollTo().assertIsDisplayed()
                }

                compose.runOnIdle { locale.value = MessageLocale.EN }
                compose.onNodeWithText(AppStrings.translate(MessageLocale.EN, "contactsTasks.consentNone"))
                    .performScrollTo().assertIsDisplayed()
            } finally {
                graph.appScope.cancel()
            }
        }
    }
}
