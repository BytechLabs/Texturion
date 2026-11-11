package com.loonext.android.ui.common

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ContactSummary
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ConversationSnippet
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.ForYouTask
import com.loonext.android.core.model.ForYouTotals
import com.loonext.android.core.model.ForYouUnread
import com.loonext.android.core.model.ForYouWaiting
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.PipelineReport
import com.loonext.android.core.model.PipelineReportResponse
import com.loonext.android.core.model.ResponseTimeReport
import com.loonext.android.core.model.SatisfactionReport
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.TaskContactLocation
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.TaskProfile
import com.loonext.android.core.model.TaskSourceMessage
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.calls.CallRow
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.callRowActions
import com.loonext.android.features.contacts.ContactDetailScreen
import com.loonext.android.features.contacts.ContactMutations
import com.loonext.android.features.foryou.ForYouList
import com.loonext.android.features.inbox.InboxAuditBody
import com.loonext.android.features.settings.SettingsIndex
import com.loonext.android.features.shell.AccountSheetContent
import com.loonext.android.features.tasks.CallTaskButton
import com.loonext.android.features.tasks.TaskDetailScreen
import com.loonext.android.features.tasks.TaskMutations
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Pictures of the phone, for the issues that close on "somebody looked".
 *
 * Each test draws ONE real screen (or the largest real composable under it, where
 * the screen itself needs a live view model) with fixture data, in light and dark,
 * at a 390x844dp phone, and writes `build/screenshots/evidence/<name>-<mode>.png`.
 * It asserts only that something drew; the PNGs are the deliverable.
 *
 * One `setContent` per test, because the compose rule allows one, so every screen is
 * a pair of tests. Screens that read the network (the task, the contact and its
 * timeline) talk to a MockWebServer that answers only the activity routes, and read
 * the rest from the store cache the app itself reads first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class IssueEvidenceScreenshotTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: MockWebServer
    private lateinit var graph: AppGraph

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                return when {
                    path == "/v1/contacts/p1/activity" -> MockResponse(body = ACTIVITY_JSON)
                    path == "/v1/members" -> MockResponse(body = MEMBERS_JSON)
                    path == "/v1/calls" -> MockResponse(body = CALLS_JSON)
                    else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
                }
            }
        }
        server.start()
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            supabaseUrl = server.url("/gotrue").toString(),
            apiUrl = server.url("/").toString().trimEnd('/'),
        )
        runBlocking {
            graph.sessionStore.save(
                Session(
                    accessToken = "token-1",
                    refreshToken = "refresh-1",
                    expiresAt = System.currentTimeMillis() / 1000 + 3600,
                    userId = "usr_1",
                    email = "jordan@example.com",
                ),
            )
        }
    }

    @After
    fun tearDown() {
        server.close()
    }

    // --- 1. inbox -------------------------------------------------------------------

    @Test fun `inbox light`() = shoot("inbox", dark = false) { inbox() }
    @Test fun `inbox dark`() = shoot("inbox", dark = true) { inbox() }

    @Composable
    private fun inbox() = InboxAuditBody(
        listOf(
            conversation("c1", "Dana Whitcomb", unread = true, snippet = "Can you come by Tuesday morning?"),
            conversation("c2", "Sam Ortiz", unread = true, snippet = "The faucet is leaking again."),
            conversation("c3", null, unread = false, snippet = "Thanks, payment sent.", closed = true),
            conversation("c4", "Priya Nair", unread = false, snippet = "Sounds good, see you then."),
        ),
        views = ListViews(
            entries = listOf(
                ViewsMenuEntry(id = "v1", name = "Needs a reply", count = 4, isDefault = true),
                ViewsMenuEntry(id = "v2", name = "Estimates", count = 11),
            ),
            activeId = "v1",
            canSaveCurrent = false,
            canShare = true,
            onApply = {},
            onSaveCurrent = {},
            onDefault = {},
            onRename = { _, _ -> },
            onShare = { _, _ -> },
            onDelete = {},
        ),
    )

    // --- 2. calls --------------------------------------------------------------------

    @Test fun `calls light`() = shoot("calls", dark = false) { calls() }
    @Test fun `calls dark`() = shoot("calls", dark = true) { calls() }

    @Composable
    private fun calls() {
        val repo = CallsRepository(graph.api)
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
            Spacer(Modifier.height(12.dp))
            SectionHeader("Today", count = 3)
            PaperCard(Modifier.fillMaxWidth()) {
                callFixtures().forEachIndexed { index, call ->
                    if (index > 0) RowDivider()
                    callRow(repo, call)
                }
            }
        }
    }

    @Composable
    private fun callRow(repo: CallsRepository, call: Call) = CallRow(
        call = call,
        repo = repo,
        companyId = "co_1",
        makeTask = call.conversation_id?.takeIf { call.outcome == CallOutcome.ANSWERED }?.let { conversationId ->
            {
                CallTaskButton(
                    graph = graph,
                    companyId = "co_1",
                    conversationId = conversationId,
                    callerName = "Dana Whitcomb",
                    callId = call.id,
                )
            }
        },
        rowActions = callRowActions(call),
        onRowAction = {},
        actions = callActions(
            CallActionsInput(
                hasConversation = call.conversation_id != null,
                hasContact = call.contact_id != null,
                callerE164 = call.caller_e164,
                hasVoicemail = false,
                canDelete = true,
            ),
        ),
        onAction = {},
    )

    // --- 3. call-menu -----------------------------------------------------------------

    @Test fun `call-menu light`() = shoot("call-menu", dark = false) { callMenu() }
    @Test fun `call-menu dark`() = shoot("call-menu", dark = true) { callMenu() }

    @Composable
    private fun callMenu() {
        val repo = CallsRepository(graph.api)
        val call = callFixtures().first()
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
            Spacer(Modifier.height(12.dp))
            PaperCard(Modifier.fillMaxWidth()) { callRow(repo, call) }
            Spacer(Modifier.height(8.dp))
            // The popup window the menu normally floats in cannot be captured, so the same
            // items are drawn on the menu's own surface.
            Surface(
                shape = MaterialTheme.shapes.extraSmall,
                color = MaterialTheme.colorScheme.surfaceContainer,
                shadowElevation = 3.dp,
                modifier = Modifier.width(240.dp),
            ) {
                Column(Modifier.padding(vertical = 8.dp)) {
                    RecordMenuItems(
                        actions = callActions(
                            CallActionsInput(
                                hasConversation = true,
                                hasContact = true,
                                callerE164 = call.caller_e164,
                                hasVoicemail = false,
                                canDelete = true,
                            ),
                        ),
                        onDismiss = {},
                        onSelect = { _, _ -> },
                        exactTime = TimestampFormat.exact(call.started_at),
                    )
                }
            }
        }
    }

    // --- 4. settings ------------------------------------------------------------------

    @Test @Config(qualifiers = "w390dp-h1500dp-xhdpi")
    fun `settings light`() = shoot("settings", dark = false, heightDp = 1500) { settings() }

    @Test @Config(qualifiers = "w390dp-h1500dp-xhdpi")
    fun `settings dark`() = shoot("settings", dark = true, heightDp = 1500) { settings() }

    @Composable
    private fun settings() = SettingsIndex(
        company = previewCompany(),
        me = previewMe(),
        role = "owner",
        usage = previewUsage(),
        onHandOver = {},
        unsentCount = { 0 },
        onOpen = {},
        onCopyNumber = {},
    )

    // --- 5. settings-search -----------------------------------------------------------

    @Test fun `settings-search light`() = shoot("settings-search", dark = false, afterShow = { typeSearch() }) { settings() }
    @Test fun `settings-search dark`() = shoot("settings-search", dark = true, afterShow = { typeSearch() }) { settings() }

    private fun typeSearch() {
        compose.onNode(hasSetTextAction()).performTextInput("time zone")
    }

    // --- 6. for-you --------------------------------------------------------------------

    @Test fun `for-you light`() = shoot("for-you", dark = false) { forYou(editing = false) }
    @Test fun `for-you dark`() = shoot("for-you", dark = true) { forYou(editing = false) }
    @Test fun `for-you-edit light`() = shoot("for-you-edit", dark = false) { forYou(editing = true) }
    @Test fun `for-you-edit dark`() = shoot("for-you-edit", dark = true) { forYou(editing = true) }

    @Composable
    private fun forYou(editing: Boolean) {
        val contact = ContactSummary("p1", "Dana Whitcomb", "+14155550134")
        ForYouList(
            forYou = ForYou(
                waiting_on_you = listOf(
                    ForYouWaiting("c1", "open", contact, last_message_at = "2026-07-15T12:00:00Z", unread = true, urgency = 1),
                    ForYouWaiting("c2", "open", ContactSummary("p2", "Sam Ortiz", "+14155550177"), last_message_at = "2026-07-15T09:00:00Z"),
                ),
                my_tasks = listOf(
                    ForYouTask("t1", "Send Dana the estimate", due_at = "2026-07-14T15:00:00Z", overdue = true),
                    ForYouTask("t2", "Order the replacement valve", due_at = "2026-07-17T15:00:00Z"),
                ),
                unread = listOf(ForYouUnread("c1", "open", contact, last_message_at = "2026-07-15T12:00:00Z")),
                totals = ForYouTotals(waiting_on_you = 2, my_tasks = 2, unread = 1, distinct_work = 3),
            ),
            spamReview = emptyList(),
            onAnswerSpamReview = { _, _ -> },
            recentCalls = LoadState.Ready(callFixtures()),
            outstandingQuotes = emptyList(),
            chasedQuotes = null,
            onChaseQuote = { _, _ -> },
            responseTime = ResponseTimeReport(
                leads = 4,
                answered = 3,
                unanswered = 1,
                median_seconds = 372.0,
                p90_seconds = 1840.0,
            ),
            responseDays = 30,
            onResponseWindow = {},
            satisfaction = SatisfactionReport(
                asked = 8,
                answered = 5,
                average = 4.6,
                distribution = mapOf("5" to 3, "4" to 2),
                poor = 0,
                minimum_sample = 3,
            ),
            pipeline = PipelineReportResponse(
                days = 30,
                current = PipelineReport(quoted = 6, won = 2, lost = 0, open = 4, median_days_to_win = 3.0),
                previous = PipelineReport(quoted = 4, won = 1, lost = 1, open = 2),
                win_rate = 33,
                previous_win_rate = 25,
            ),
            leadSources = null,
            referralMoment = null,
            referralLink = null,
            referralOpened = false,
            onOpenReferral = {},
            onDismissReferral = {},
            unreadNotifications = 2,
            me = previewMe(),
            onOpenConversation = {},
            onOpenTask = {},
            onOpenCalls = {},
            onOpenNotifications = {},
            onOpenContacts = {},
            onOpenSettings = {},
            onOpenUnanswered = {},
            hidden = emptyList(),
            layout = null,
            editing = editing,
            layoutFailed = false,
            onToggleEditing = {},
            onSaveLayout = { _, _ -> },
            onSaveHidden = {},
            onAnnounce = {},
        )
    }

    // --- 7. task-detail ----------------------------------------------------------------

    @Test fun `task-detail light`() = shoot("task-detail", dark = false, settle = true) { taskDetail() }
    @Test fun `task-detail dark`() = shoot("task-detail", dark = true, settle = true) { taskDetail() }

    @Composable
    private fun taskDetail() {
        graph.storeCache.flowOf<TaskDetail>(CacheKeys.task("co_1", "t1")).value = TASK
        TaskDetailScreen(
            graph = graph,
            mutations = TaskMutations(graph.api),
            companyId = "co_1",
            me = previewMe(),
            taskId = "t1",
            onBack = {},
            onOpenConversation = { _, _ -> },
        )
    }

    // --- 8. contact --------------------------------------------------------------------

    @Test @Config(qualifiers = "w390dp-h1800dp-xhdpi")
    fun `contact light`() = shoot("contact", dark = false, heightDp = 1800, settle = true) { contactDetail() }

    @Test @Config(qualifiers = "w390dp-h1800dp-xhdpi")
    fun `contact dark`() = shoot("contact", dark = true, heightDp = 1800, settle = true) { contactDetail() }

    @Composable
    private fun contactDetail() {
        graph.storeCache.flowOf<Contact>(CacheKeys.contact("co_1", "p1")).value = CONTACT
        ContactDetailScreen(
            graph = graph,
            mutations = ContactMutations(graph.api, server.url("/").toString().trimEnd('/')),
            companyId = "co_1",
            contactId = "p1",
            onBack = {},
            onOpenConversation = {},
            onComposeNew = {},
            canDelete = true,
        )
    }

    // --- 9. timestamp ------------------------------------------------------------------

    @Test fun `timestamp light`() = shoot("timestamp", dark = false) { timestamp() }
    @Test fun `timestamp dark`() = shoot("timestamp", dark = true) { timestamp() }

    @Composable
    private fun timestamp() {
        val iso = "2026-07-14T15:42:00Z"
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            PaperCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Dana Whitcomb", style = MaterialTheme.typography.titleSmall)
                    Text("Can you come by Tuesday morning?", style = MaterialTheme.typography.bodyMedium)
                    Timestamp(iso, style = TimestampFormat.Style.SHORT)
                }
            }
            Spacer(Modifier.height(6.dp))
            // The tip a long-press raises, drawn in place because a popup window is not captured.
            ExactTimeTip(TimestampFormat.exact(iso))
        }
    }

    // --- 10. account-sheet --------------------------------------------------------------

    @Test fun `account-sheet light`() = shoot("account-sheet", dark = false) { accountSheet() }
    @Test fun `account-sheet dark`() = shoot("account-sheet", dark = true) { accountSheet() }

    @Composable
    private fun accountSheet() = AccountSheetContent(
        me = previewMe(),
        companyId = "co_1",
        unreadNotifications = 2,
        theme = "system",
        onSelectTheme = {},
        onOpenContacts = {},
        onOpenNotifications = {},
        onOpenSettings = {},
        onSwitchWorkspace = {},
        onSignOut = {},
        onDismiss = {},
    )

    // --- harness --------------------------------------------------------------------------

    private fun shoot(
        name: String,
        dark: Boolean,
        heightDp: Int = 844,
        settle: Boolean = false,
        afterShow: () -> Unit = {},
        content: @Composable () -> Unit,
    ) {
        compose.setContent {
            LoonextTheme(darkTheme = dark) {
                val size = DpSize(390.dp, heightDp.dp)
                CompositionLocalProvider(
                    LocalWindowSizeClass provides WindowSizeClass.calculateFromSize(size),
                ) {
                    // A Surface, as the app root has one: it sets the content colour rows inherit.
                    Surface(
                        modifier = Modifier.size(size.width, size.height),
                        color = MaterialTheme.colorScheme.background,
                    ) { content() }
                }
            }
        }
        compose.waitForIdle()
        afterShow()
        if (settle) {
            // Let the first network answer land and the screen redraw.
            repeat(30) {
                Thread.sleep(100)
                compose.waitForIdle()
            }
        } else {
            compose.waitForIdle()
        }
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val mode = if (dark) "dark" else "light"
        val dir = File("build/screenshots/evidence").apply { mkdirs() }
        File(dir, "$name-$mode.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue("$name-$mode drew nothing", drewSomething(bitmap))
    }

    private fun drewSomething(bitmap: Bitmap): Boolean {
        val first = bitmap.getPixel(0, 0)
        for (x in 0 until bitmap.width step 3) {
            for (y in 0 until bitmap.height step 3) {
                if (bitmap.getPixel(x, y) != first) return true
            }
        }
        return false
    }

    // --- fixtures -------------------------------------------------------------------------

    private fun callFixtures() = listOf(
        Call(
            id = "k1", call_session_id = "s1", caller_e164 = "+14155550134", contact_id = "p1",
            contact_name = "Dana Whitcomb", conversation_id = "c1", outcome = CallOutcome.ANSWERED,
            direction = "inbound", forward_seconds = 184, ended_reason = "caller_hung_up",
            started_at = "2026-07-15T14:20:00Z",
        ),
        Call(
            id = "k2", call_session_id = "s2", caller_e164 = "+14155550177", conversation_id = "c2",
            outcome = CallOutcome.MISSED, direction = "inbound", ended_reason = "no_answer_in_time",
            started_at = "2026-07-15T11:05:00Z",
        ),
        Call(
            id = "k3", call_session_id = "s3", caller_e164 = "+14155550199", outcome = CallOutcome.MISSED,
            direction = "inbound", ended_reason = "declined_by_everyone", started_at = "2026-07-15T09:12:00Z",
        ),
    )

    private fun conversation(
        id: String,
        name: String?,
        unread: Boolean,
        snippet: String,
        closed: Boolean = false,
    ) = ConversationListItem(
        id = id,
        company_id = "co",
        contact_id = "p-$id",
        phone_number_id = "n1",
        status = if (closed) "closed" else "open",
        is_spam = false,
        last_message_at = "2026-07-15T12:00:00Z",
        created_at = "2026-07-14T12:00:00Z",
        updated_at = "2026-07-15T12:00:00Z",
        contact = ContactSummary(id = "p-$id", name = name, phone_e164 = "+14155550134"),
        tags = if (unread) listOf(Tag(id = "t1", name = "Estimate", color = "#66801F")) else emptyList(),
        unread = unread,
        last_message = ConversationSnippet(
            id = "m-$id",
            direction = "inbound",
            body = snippet,
            created_at = "2026-07-15T12:00:00Z",
            has_attachments = false,
        ),
    )

    private companion object {
        val TASK = TaskDetail(
            id = "t1",
            company_id = "co_1",
            conversation_id = "c1",
            contact_id = "p1",
            contact = TaskContactLocation(id = "p1", name = "Dana Whitcomb"),
            title = "Replace the kitchen faucet at 14 Alder St",
            description = "Brushed nickel, single handle. Bring the shutoff valve and a basin wrench.",
            assigned_user_id = "usr_1",
            due_at = "2026-07-17T15:00:00Z",
            created_by_user_id = "usr_1",
            created_at = "2026-07-14T12:00:00Z",
            updated_at = "2026-07-15T12:00:00Z",
            assignee = TaskProfile("usr_1", "Jordan Lee"),
            created_by = TaskProfile("usr_1", "Jordan Lee"),
            addr_street = "14 Alder St",
            addr_city = "Oakland",
            addr_state = "CA",
            addr_postal_code = "94607",
            source_message = TaskSourceMessage(
                id = "m1",
                body = "Can you come by Thursday and swap the faucet? The old one drips all night.",
                created_at = "2026-07-14T11:58:00Z",
                direction = "inbound",
            ),
        )

        val CONTACT = Contact(
            id = "p1",
            phone_e164 = "+14155550134",
            name = "Dana Whitcomb",
            email = "dana@example.com",
            address = "14 Alder St, Oakland CA",
            conversation_count = 3,
            first_conversation_at = "2026-06-02T12:00:00Z",
            notes = "Prefers texts before 5pm.",
            created_at = "2026-06-02T12:00:00Z",
            updated_at = "2026-07-15T12:00:00Z",
        )

        const val MEMBERS_JSON = """{"data":[{"id":"mem_1","user_id":"usr_1","role":"owner","created_at":"2026-01-01T00:00:00Z","display_name":"Jordan Lee"}],"next_cursor":null}"""

        const val CALLS_JSON = """{"data":[{"id":"k1","call_session_id":"s1","caller_e164":"+14155550134","contact_id":"p1","contact_name":"Dana Whitcomb","outcome":"answered","direction":"inbound","forward_seconds":184,"started_at":"2026-07-15T11:20:00Z"}],"next_cursor":null}"""

        const val ACTIVITY_JSON = """{"data":[
          {"id":"a1","kind":"text_in","category":"message","occurred_at":"2026-07-15T12:00:00Z","actor":{"type":"customer","display_name":"Dana Whitcomb"}},
          {"id":"a2","kind":"call","category":"call","occurred_at":"2026-07-15T11:20:00Z","actor":{"type":"customer","display_name":"Dana Whitcomb"},"payload":{"direction":"inbound","outcome":"answered","talk_seconds":184,"ended_reason":"caller_hung_up"}},
          {"id":"a3","kind":"tagged","category":"change","occurred_at":"2026-07-14T16:00:00Z","actor":{"type":"member","user_id":"usr_1","display_name":"Jordan Lee"},"payload":{"name":"Estimate"}},
          {"id":"a4","kind":"text_out","category":"message","occurred_at":"2026-07-14T15:42:00Z","actor":{"type":"member","user_id":"usr_1","display_name":"Jordan Lee"}}
        ],"next_cursor":null}"""
    }
}
