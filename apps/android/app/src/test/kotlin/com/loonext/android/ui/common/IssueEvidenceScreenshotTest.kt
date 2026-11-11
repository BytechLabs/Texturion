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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.outlined.Check
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import com.loonext.android.core.model.DayHours
import com.loonext.android.core.model.SettingChoice
import com.loonext.android.core.model.SettingChoices
import com.loonext.android.features.settings.CalendarFeedCard
import com.loonext.android.features.settings.CallingSection
import com.loonext.android.features.settings.OnCallCard
import com.loonext.android.features.settings.SettingsRepository
import com.loonext.android.features.settings.SettingsScope
import com.loonext.android.features.settings.TeamSection
import com.loonext.android.features.tasks.NewTaskSheetHost
import com.loonext.android.features.tasks.TaskCalendarSnapshot
import com.loonext.android.features.tasks.TaskCalendarView
import com.loonext.android.features.tasks.TaskMapView
import com.loonext.android.features.tasks.calendarDayDueIso
import com.loonext.android.features.tasks.taskCalendarBaseAssignee
import com.loonext.android.features.tasks.taskCalendarFilterKey
import com.loonext.android.features.tasks.taskMapFilterKey
import com.loonext.android.features.tasks.TasksTabKind
import kotlinx.serialization.json.JsonPrimitive
import java.time.YearMonth
import java.time.ZoneId
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
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TrashCallDetail
import com.loonext.android.core.model.TrashConversationDetail
import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.model.TrashMessageDetail
import com.loonext.android.core.model.TrashVoicemailDetail
import com.loonext.android.core.model.TaskContactLocation
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.TaskProfile
import com.loonext.android.core.model.TaskSourceMessage
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.calls.CallRow
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.contacts.ContactDetailScreen
import com.loonext.android.features.contacts.ContactMutations
import com.loonext.android.features.contacts.ContactsSnapshot
import com.loonext.android.features.contacts.ContactsTab
import com.loonext.android.features.foryou.ForYouList
import com.loonext.android.features.inbox.InboxAuditBody
import com.loonext.android.features.settings.SettingsIndex
import com.loonext.android.features.settings.TrashScreen
import com.loonext.android.features.shell.AccountSheetContent
import com.loonext.android.features.tasks.TaskDetailScreen
import com.loonext.android.features.tasks.TaskListLoader
import com.loonext.android.features.tasks.TaskListSnapshot
import com.loonext.android.features.tasks.TaskMutations
import com.loonext.android.features.tasks.TasksTab
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

    /** What /v1/members and /v1/calls answer; a test that needs more rows sets these first. */
    private var membersJson = MEMBERS_JSON
    private var callsJson = CALLS_JSON

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                return when {
                    path == "/v1/contacts/p1/activity" -> MockResponse(body = ACTIVITY_JSON)
                    path == "/v1/members" -> MockResponse(body = membersJson)
                    path == "/v1/tags" -> MockResponse(body = TAGS_JSON)
                    path == "/v1/calls" -> MockResponse(body = callsJson)
                    path == "/v1/conversations" -> MockResponse(body = CONVERSATIONS_JSON)
                    path == "/v1/contacts/p1/linked-tasks" -> MockResponse(body = LINKED_TASKS_JSON)
                    path == "/v1/invites" -> MockResponse(body = INVITES_JSON)
                    path == "/v1/company/ownership" -> MockResponse(body = OWNERSHIP_JSON)
                    path == "/v1/voicemail-greetings" -> MockResponse(body = """{"data":[],"next_cursor":null}""")
                    path == "/v1/on-call" -> MockResponse(body = """{"data":[]}""")
                    path == "/v1/calendar/feed" -> MockResponse(body = """{"active":false}""")
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
        onOpen = {},
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

    // --- 8b. contact-long (#740) -------------------------------------------------------------
    // The same contact with a long history, on the Activity tab, one pane per shot.

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long light`() =
        shoot("contact-long", dark = false, heightDp = 1400, settle = true, afterShow = { openActivityPane("Conversations") }) { longContact() }

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long dark`() =
        shoot("contact-long", dark = true, heightDp = 1400, settle = true, afterShow = { openActivityPane("Conversations") }) { longContact() }

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long-calls light`() =
        shoot("contact-long-calls", dark = false, heightDp = 1400, settle = true, afterShow = { openActivityPane("Calls") }) { longContact() }

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long-calls dark`() =
        shoot("contact-long-calls", dark = true, heightDp = 1400, settle = true, afterShow = { openActivityPane("Calls") }) { longContact() }

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long-tasks light`() =
        shoot("contact-long-tasks", dark = false, heightDp = 1400, settle = true, afterShow = { openActivityPane("Tasks") }) { longContact() }

    @Test @Config(qualifiers = "w390dp-h1400dp-xhdpi")
    fun `contact-long-tasks dark`() =
        shoot("contact-long-tasks", dark = true, heightDp = 1400, settle = true, afterShow = { openActivityPane("Tasks") }) { longContact() }

    private fun openActivityPane(pane: String) {
        compose.onAllNodes(hasText("Activity") and isSelectable())[0].performClick()
        compose.waitForIdle()
        compose.onAllNodes(hasText(pane) and isSelectable())[0].performClick()
    }

    @Composable
    private fun longContact() {
        callsJson = LONG_CALLS_JSON
        graph.storeCache.flowOf<Contact>(CacheKeys.contact("co_1", "p1")).value =
            CONTACT.copy(conversation_count = 9)
        ContactDetailScreen(
            graph = graph,
            mutations = ContactMutations(graph.api, server.url("/").toString().trimEnd('/')),
            companyId = "co_1",
            contactId = "p1",
            onBack = {},
            onOpenConversation = {},
            onOpenTask = {},
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

    // --- 11. trash ----------------------------------------------------------------------

    @Test fun `trash light`() = shoot("trash", dark = false, settle = true) { trash() }
    @Test fun `trash dark`() = shoot("trash", dark = true, settle = true) { trash() }

    @Composable
    private fun trash() {
        val now = java.time.Instant.now()
        fun row(kind: String, id: String, deletedDaysAgo: Long, build: (TrashItem) -> TrashItem) = build(
            TrashItem(
                id = id,
                kind = kind,
                deleted_at = now.minus(java.time.Duration.ofDays(deletedDaysAgo)).toString(),
                deleted_by_user_id = if (id == "cv1") "usr_1" else null,
                purge_after = now.plus(java.time.Duration.ofDays(30 - deletedDaysAgo)).toString(),
            ),
        )
        graph.storeCache.flowOf<Page<TrashItem>>(CacheKeys.trash("co_1")).value = Page(
            data = listOf(
                row("conversation", "cv1", 1) {
                    it.copy(conversation = TrashConversationDetail("Dana Whitcomb", "+14165550134", 12))
                },
                row("message", "m1", 3) {
                    it.copy(message = TrashMessageDetail(null, "+14165550188", "cv2", "outbound", "See you Tuesday at 9, bring the long ladder."))
                },
                row("call", "call1", 9) {
                    it.copy(call = TrashCallDetail("Sam Okafor", null, "answered", now.toString(), true))
                },
                row("voicemail", "call2", 29) {
                    it.copy(voicemail = TrashVoicemailDetail("Priya Nair", null, now.toString(), 42))
                },
            ),
        )
        TrashScreen(graph = graph, companyId = "co_1", meUserId = "usr_1")
    }

    // --- 12. tasks ----------------------------------------------------------------------
    // The real Tasks tab, painted from the cache entry the app itself reads first; the
    // mock server answers 404 to the revalidation, which keeps what is cached.

    @Test fun `tasks light`() = shoot("tasks", dark = false, settle = true) { tasks() }
    @Test fun `tasks dark`() = shoot("tasks", dark = true, settle = true) { tasks() }

    @Composable
    private fun tasks() {
        val now = java.time.Instant.now()
        fun task(id: String, title: String, dueHours: Long?, assignee: String?, done: Boolean = false) = Task(
            id = id,
            company_id = "co_1",
            title = title,
            assigned_user_id = assignee,
            due_at = dueHours?.let { now.plus(java.time.Duration.ofHours(it)).toString() },
            created_by_user_id = "usr_1",
            created_at = now.minus(java.time.Duration.ofDays(2)).toString(),
            updated_at = now.minus(java.time.Duration.ofDays(1)).toString(),
            done = done,
            status = if (done) "done" else "open",
        )
        val rows = listOf(
            task("t1", "Replace the kitchen faucet at 14 Alder St", -5, "usr_1"),
            task("t2", "Quote the water heater swap for Priya", 3, "usr_1"),
            task("t3", "Call back about the permit", 26, null),
            task("t4", "Order shutoff valves", 74, "usr_1"),
        )
        graph.storeCache.flowOf<TaskListSnapshot>(CacheKeys.tasks("co_1", "default")).value =
            TaskListSnapshot(rows, false, TaskListLoader(TaskMutations(graph.api), "co_1", emptyList()))
        TasksTab(graph = graph, companyId = "co_1", me = previewMe(), onOpenTask = {})
    }

    // --- 13. contacts -------------------------------------------------------------------

    @Test fun `contacts light`() = shoot("contacts", dark = false, settle = true) { contacts() }
    @Test fun `contacts dark`() = shoot("contacts", dark = true, settle = true) { contacts() }

    @Composable
    private fun contacts() {
        val now = java.time.Instant.now()
        fun person(id: String, name: String?, phone: String, hoursAgo: Long, optedOut: Boolean = false) = CONTACT.copy(
            id = id,
            name = name,
            phone_e164 = phone,
            last_activity_at = now.minus(java.time.Duration.ofHours(hoursAgo)).toString(),
            opted_out = optedOut,
        )
        val rows = listOf(
            person("p1", "Dana Whitcomb", "+14155550134", 2),
            person("p2", "Priya Nair", "+14155550177", 30),
            person("p3", "Sam Okafor", "+14155550188", 80, optedOut = true),
            person("p4", null, "+14155550199", 400),
            person("p5", "Marcus Bell", "+14155550142", 900),
        )
        graph.storeCache.flowOf<ContactsSnapshot>(CacheKeys.contacts("co_1")).value =
            ContactsSnapshot(rows, null)
        ContactsTab(graph = graph, companyId = "co_1", me = previewMe())
    }

    // --- 14. calendar-create (#739) ---------------------------------------------------------
    // The month grid with an empty day long-pressed, which opens New task due that day. Android
    // has no week view (the calendar is the month grid and a day list), so there is no
    // calendar-week shot.

    @Test fun `calendar-create light`() =
        shoot("calendar-create", dark = false, settle = true, afterShow = { longPressEmptyDay() }) { calendarCreate() }

    @Test fun `calendar-create dark`() =
        shoot("calendar-create", dark = true, settle = true, afterShow = { longPressEmptyDay() }) { calendarCreate() }

    private fun longPressEmptyDay() {
        val emptyDay = SemanticsMatcher("an empty day") { node ->
            node.config.getOrNull(SemanticsProperties.ContentDescription)
                ?.any { it.endsWith(", 0 tasks") } == true
        }
        // The sheet is its own window, which a test cannot capture, so this shows the tapped day
        // with the visible "New task on ..." button that opens it.
        compose.onAllNodes(emptyDay)[16].performClick()
    }

    @Composable
    private fun calendarCreate() {
        val zone = ZoneId.of("America/Los_Angeles")
        val month = YearMonth.now(zone)
        fun due(day: Int, hour: Int) = month.atDay(day).atTime(hour, 0).atZone(zone).toInstant().toString()
        fun task(id: String, title: String, day: Int, hour: Int = 9, done: Boolean = false) = Task(
            id = id,
            company_id = "co_1",
            title = title,
            assigned_user_id = "usr_1",
            due_at = due(day, hour),
            created_by_user_id = "usr_1",
            created_at = due(1, 8),
            updated_at = due(1, 8),
            done = done,
            status = if (done) "done" else "open",
        )
        val rows = listOf(
            task("t1", "Replace the kitchen faucet", 3),
            task("t2", "Quote the water heater swap", 9),
            task("t3", "Order shutoff valves", 9, 14),
            task("t4", "Walk the Alder St job", 12, done = true),
            task("t5", "Call back about the permit", 19),
            task("t6", "Inspect the boiler", 24),
        )
        graph.storeCache.flowOf<TaskCalendarSnapshot>(
            CacheKeys.tasks(
                "co_1",
                taskCalendarFilterKey(month, taskCalendarBaseAssignee(TasksTabKind.All, null, false), false, null),
            ),
        ).value = TaskCalendarSnapshot(rows, undatedOpen = 2, undatedDone = 0, undatedTruncated = false)
        var dueIso by remember { mutableStateOf<String?>(null) }
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.height(12.dp))
            TaskCalendarView(
                cache = graph.storeCache,
                mutations = TaskMutations(graph.api),
                companyId = "co_1",
                tab = TasksTabKind.All,
                assigneeChip = null,
                unassignedChip = false,
                dueChip = null,
                q = null,
                refreshKey = 0,
                memberName = { "Jordan Lee" },
                onOpenTask = {},
                onToggleDone = { _, _ -> },
                zone = zone,
                onCreateTask = { day -> dueIso = calendarDayDueIso(day, zone) },
            )
        }
        dueIso?.let { iso ->
            NewTaskSheetHost(
                graph = graph,
                companyId = "co_1",
                conversationId = null,
                contactId = null,
                contactName = "",
                onDismiss = { dueIso = null },
                initialDueIso = iso,
                zone = zone,
            )
        }
    }

    // --- 15. calendar-settings (#744) ---------------------------------------------------------

    @Test fun `calendar-settings light`() = shoot("calendar-settings", dark = false, settle = true) { calendarSettings() }
    @Test fun `calendar-settings dark`() = shoot("calendar-settings", dark = true, settle = true) { calendarSettings() }

    @Composable
    private fun calendarSettings() {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 12.dp)) {
            CalendarFeedCard(settingsScope())
        }
    }

    // --- 16. team-roles (#746) ------------------------------------------------------------------

    @Test @Config(qualifiers = "w390dp-h3500dp-xhdpi")
    fun `team-roles light`() = shoot("team-roles", dark = false, heightDp = 3500, settle = true) { teamRoles() }

    @Test @Config(qualifiers = "w390dp-h3500dp-xhdpi")
    fun `team-roles dark`() = shoot("team-roles", dark = true, heightDp = 3500, settle = true) { teamRoles() }

    @Test fun `team-role-open light`() = shoot("team-role-open", dark = false) { roleMenuOpen() }
    @Test fun `team-role-open dark`() = shoot("team-role-open", dark = true) { roleMenuOpen() }

    /**
     * The role field with its list open. The list is a popup window, which a test cannot
     * capture, so the same options are drawn on the menu's own surface (as call-menu does),
     * under the real closed field.
     */
    @Composable
    private fun roleMenuOpen() {
        val roles = listOf(
            "settingsMore.roleMember" to "settingsMore.roleMemberBlurb",
            "settingsMore.roleAdmin" to "settingsMore.roleAdminBlurb",
            "settingsMore.roleReadOnly" to "settingsMore.roleReadOnlyBlurb",
            "settingsMore.roleBookkeeper" to "settingsMore.roleBookkeeperBlurb",
        )
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            PaperCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(t("settingsMore.inviteTeammate"), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(10.dp))
                    SelectField(
                        options = roles.map { SelectOption(it.first, t(it.first), t(it.second)) },
                        selected = roles.first().first,
                        onSelect = {},
                        label = t("settingsMore.roleLabel"),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Surface(
                shape = MaterialTheme.shapes.extraSmall,
                color = MaterialTheme.colorScheme.surfaceContainer,
                shadowElevation = 3.dp,
                modifier = Modifier.width(300.dp).padding(start = 16.dp),
            ) {
                Column(Modifier.padding(vertical = 8.dp)) {
                    roles.forEachIndexed { index, (label, blurb) ->
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(t(label))
                                Text(
                                    t(blurb),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (index == 0) {
                                androidx.compose.material3.Icon(
                                    androidx.compose.material.icons.Icons.Outlined.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun teamRoles() {
        membersJson = TEAM_MEMBERS_JSON
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 12.dp)) {
            TeamSection(settingsScope(), previewCompany())
        }
    }

    // --- 17. on-call (#746) ---------------------------------------------------------------------

    @Test fun `on-call light`() = shoot("on-call", dark = false, settle = true) { onCall() }
    @Test fun `on-call dark`() = shoot("on-call", dark = true, settle = true) { onCall() }

    @Composable
    private fun onCall() {
        membersJson = TEAM_MEMBERS_JSON
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 12.dp)) {
            OnCallCard(settingsScope())
        }
    }

    // --- 18. tasks-map (#752) ---------------------------------------------------------------------
    // Map tiles are fetched over the network, which a test cannot do, so the pins sit on the
    // map's blank ground.

    @Test fun `tasks-map light`() = shoot("tasks-map", dark = false, settle = true) { tasksMap(located = true) }
    @Test fun `tasks-map dark`() = shoot("tasks-map", dark = true, settle = true) { tasksMap(located = true) }

    @Test fun `tasks-map-unlocated light`() = shoot("tasks-map-unlocated", dark = false, settle = true) { tasksMap(located = false) }
    @Test fun `tasks-map-unlocated dark`() = shoot("tasks-map-unlocated", dark = true, settle = true) { tasksMap(located = false) }

    @Composable
    private fun tasksMap(located: Boolean) {
        val now = java.time.Instant.now()
        fun task(id: String, title: String, contact: String, lat: Double?, lng: Double?) = Task(
            id = id,
            company_id = "co_1",
            title = title,
            assigned_user_id = "usr_1",
            due_at = now.plus(java.time.Duration.ofHours(30)).toString(),
            created_by_user_id = "usr_1",
            created_at = now.minus(java.time.Duration.ofDays(2)).toString(),
            updated_at = now.minus(java.time.Duration.ofDays(1)).toString(),
            status = "open",
            contact = TaskContactLocation(id = "c-$id", name = contact),
            lat = lat.takeIf { located },
            lng = lng.takeIf { located },
        )
        val rows = listOf(
            task("t1", "Replace the kitchen faucet", "Dana Whitcomb", 37.8044, -122.2712),
            task("t2", "Quote the water heater swap", "Priya Nair", 37.7749, -122.4194),
            task("t3", "Order shutoff valves", "Sam Okafor", 37.8715, -122.2730),
            task("t4", "Inspect the boiler", "Marcus Bell", 37.6879, -122.4702),
            task("t5", "Re-pipe the laundry room", "Dana Whitcomb", 37.8044, -122.2712),
        )
        graph.storeCache.flowOf<List<Task>>(CacheKeys.tasks("co_1", taskMapFilterKey(null, false, null, ""))).value = rows
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.height(12.dp))
            TaskMapView(graph = graph, companyId = "co_1", onOpenTask = {}, modifier = Modifier.fillMaxSize())
        }
    }

    // --- 19. calling-choice-note (#749) -----------------------------------------------------------

    @Test @Config(qualifiers = "w390dp-h1100dp-xhdpi")
    fun `calling-choice-note light`() =
        shoot("calling-choice-note", dark = false, heightDp = 1100, settle = true, afterShow = { scrollToChoiceNote() }) { callingChoiceNote() }

    @Test @Config(qualifiers = "w390dp-h1100dp-xhdpi")
    fun `calling-choice-note dark`() =
        shoot("calling-choice-note", dark = true, heightDp = 1100, settle = true, afterShow = { scrollToChoiceNote() }) { callingChoiceNote() }

    private fun scrollToChoiceNote() {
        compose.onNode(hasText("Sam Rivera chose this on", substring = true)).performScrollTo()
    }

    @Composable
    private fun callingChoiceNote() {
        graph.storeCache.flowOf<SettingChoices>(CacheKeys.settingChoices("co_1")).value = SettingChoices(
            listOf(
                SettingChoice(
                    key = "after_hours_calls",
                    value = JsonPrimitive("voicemail"),
                    default_value = JsonPrimitive("ring_everyone"),
                    chosen_by = "Sam Rivera",
                    chosen_at = "2026-08-08T15:31:13Z",
                ),
            ),
        )
        val days = listOf("mon", "tue", "wed", "thu", "fri").associateWith { DayHours("08:00", "17:00") }
        val company = previewCompany().copy(after_hours_calls = "voicemail", business_hours = days)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 12.dp)) {
            CallingSection(settingsScope(), company, onCompanyUpdated = {})
        }
    }

    private fun settingsScope(role: String = "owner") = SettingsScope(
        graph = graph,
        repo = SettingsRepository(graph.api),
        companyId = "co_1",
        me = previewMe(),
        role = role,
        showMessage = {},
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
        val bitmap = captureAll()
        val mode = if (dark) "dark" else "light"
        val dir = File("build/screenshots/evidence").apply { mkdirs() }
        File(dir, "$name-$mode.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue("$name-$mode drew nothing", drewSomething(bitmap))
    }

    /**
     * The activity's root, with any sheet or menu window drawn over it. A sheet and a
     * dropdown are their own windows, so `onRoot()` alone would leave them out.
     */
    private fun captureAll(): Bitmap {
        val roots = compose.onAllNodes(isRoot())
        val nodes = roots.fetchSemanticsNodes()
        class Layer(val bitmap: Bitmap, val x: Int, val y: Int)
        val layers = nodes.indices.map { i ->
            val at = IntArray(2)
            (nodes[i].root as? android.view.View)?.getLocationOnScreen(at)
            Layer(roots[i].captureToImage().asAndroidBitmap(), at[0], at[1])
        }.sortedByDescending { it.bitmap.width * it.bitmap.height }
        if (layers.size == 1) return layers.first().bitmap
        val base = layers.first().bitmap.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = android.graphics.Canvas(base)
        layers.drop(1).forEach { top ->
            val x = top.x - layers.first().x
            val y = top.y - layers.first().y
            // A sheet as wide as the screen sits at the bottom; a menu sits where it was placed.
            if (top.bitmap.width >= base.width) {
                canvas.drawBitmap(top.bitmap, 0f, (base.height - top.bitmap.height).toFloat(), null)
            } else {
                canvas.drawBitmap(top.bitmap, x.toFloat(), y.toFloat(), null)
            }
        }
        return base
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

        const val TAGS_JSON = """{"data":[{"id":"tg1","name":"Repeat customer"},{"id":"tg2","name":"Landlord"}],"next_cursor":null}"""

        const val MEMBERS_JSON = """{"data":[{"id":"mem_1","user_id":"usr_1","role":"owner","created_at":"2026-01-01T00:00:00Z","display_name":"Jordan Lee"}],"next_cursor":null}"""

        const val TEAM_MEMBERS_JSON = """{"data":[
          {"id":"mem_1","user_id":"usr_1","role":"owner","created_at":"2026-01-01T00:00:00Z","display_name":"Jordan Lee"},
          {"id":"mem_2","user_id":"usr_2","role":"admin","created_at":"2026-02-01T00:00:00Z","display_name":"Priya Nair"},
          {"id":"mem_3","user_id":"usr_3","role":"member","created_at":"2026-03-01T00:00:00Z","display_name":"Sam Okafor"},
          {"id":"mem_4","user_id":"usr_4","role":"read_only","created_at":"2026-04-01T00:00:00Z","display_name":"Marcus Bell"}
        ],"next_cursor":null}"""

        const val INVITES_JSON = """{"data":[
          {"id":"inv_1","company_id":"co_1","email":"alex@example.com","role":"member","invited_by":"usr_1","expires_at":"2099-01-01T00:00:00Z","created_at":"2026-07-10T00:00:00Z"},
          {"id":"inv_2","company_id":"co_1","email":"books@example.com","role":"bookkeeper","invited_by":"usr_1","expires_at":"2099-01-01T00:00:00Z","created_at":"2026-07-11T00:00:00Z"}
        ],"next_cursor":null}"""

        const val OWNERSHIP_JSON = """{"owner_member_id":"mem_1","backup_member_id":null,"i_am_owner":true,"can_offer":true}"""

        val LONG_CALLS_JSON = """{"data":[""" + (1..9).joinToString(",") { i ->
            """{"id":"k$i","call_session_id":"s$i","caller_e164":"+14155550134","contact_id":"p1","contact_name":"Dana Whitcomb","outcome":"${if (i % 3 == 0) "missed" else "answered"}","direction":"${if (i % 2 == 0) "outbound" else "inbound"}","forward_seconds":${60 + i * 17},"started_at":"2026-07-${(20 - i).toString().padStart(2, '0')}T15:20:00Z"}"""
        } + """],"next_cursor":null}"""

        const val CONVERSATIONS_JSON = """{"data":[{"id":"c1","company_id":"co_1","contact_id":"p1","phone_number_id":"n1","status":"open","is_spam":false,"last_message_at":"2026-07-15T12:00:00Z","created_at":"2026-06-02T12:00:00Z","updated_at":"2026-07-15T12:00:00Z","contact":{"id":"p1","name":"Dana Whitcomb","phone_e164":"+14155550134"},"tags":[],"unread":false,"last_message":{"id":"m1","direction":"inbound","body":"Can you come by Tuesday morning?","created_at":"2026-07-15T12:00:00Z","has_attachments":false}}],"next_cursor":null}"""

        val LINKED_TASKS_JSON = """{"data":[""" + listOf(
            "Replace the kitchen faucet", "Quote the water heater swap", "Order shutoff valves",
            "Call back about the permit", "Inspect the boiler", "Re-pipe the laundry room",
            "Send the final invoice", "Book the gas line test", "Collect the old fixtures",
        ).mapIndexed { i, title ->
            """{"id":"t${i + 1}","number":${101 + i},"title":"$title","done":${i >= 6},"due_at":"2026-07-${20 + i}T15:00:00Z","how":["contact"]}"""
        }.joinToString(",") + """],"next_cursor":null}"""

        const val CALLS_JSON = """{"data":[{"id":"k1","call_session_id":"s1","caller_e164":"+14155550134","contact_id":"p1","contact_name":"Dana Whitcomb","outcome":"answered","direction":"inbound","forward_seconds":184,"started_at":"2026-07-15T11:20:00Z"}],"next_cursor":null}"""

        const val ACTIVITY_JSON = """{"data":[
          {"id":"a1","kind":"text_in","category":"message","occurred_at":"2026-07-15T12:00:00Z","actor":{"type":"customer","display_name":"Dana Whitcomb"}},
          {"id":"a2","kind":"call","category":"call","occurred_at":"2026-07-15T11:20:00Z","actor":{"type":"customer","display_name":"Dana Whitcomb"},"payload":{"direction":"inbound","outcome":"answered","talk_seconds":184,"ended_reason":"caller_hung_up"}},
          {"id":"a3","kind":"tagged","category":"change","occurred_at":"2026-07-14T16:00:00Z","actor":{"type":"member","user_id":"usr_1","display_name":"Jordan Lee"},"payload":{"name":"Estimate"}},
          {"id":"a4","kind":"text_out","category":"message","occurred_at":"2026-07-14T15:42:00Z","actor":{"type":"member","user_id":"usr_1","display_name":"Jordan Lee"}}
        ],"next_cursor":null}"""
    }
}
