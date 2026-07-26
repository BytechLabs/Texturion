package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #306 — the focus queue's headline number.
 *
 * It used to count the rows on screen, and the rows are capped at the section
 * limit, so it was bounded by the page size rather than by the work: a member
 * with 60 conversations waiting on them read "20 things need you" and the
 * queue looked finished after twenty items. That inverts exactly when it
 * matters — a crew that is genuinely drowning is reassured at the moment it
 * should be alarmed.
 *
 * Two properties are pinned. The server's total wins when it is there, and
 * the fallback still deduplicates: "waiting on you" and "unread" overlap by
 * design, since the second is a cross-cut of the first rather than a separate
 * pile of work.
 */
class ForYouHeadlineTest {
    private fun waiting(id: String) = ForYouWaiting(
        conversation_id = id,
        status = "open",
        last_message_at = "2026-07-27T10:00:00Z",
    )

    private fun unread(id: String) = ForYouUnread(
        conversation_id = id,
        status = "open",
        last_message_at = "2026-07-27T10:00:00Z",
    )

    private fun task(id: String) = ForYouTask(
        task_id = id,
        title = "Call back about the quote",
        conversation_id = "conv-1",
        message_id = "msg-1",
    )

    @Test
    fun `the server total wins over the rows on screen`() {
        // The defect: twenty rows came back and the member is sixty-seven
        // things behind.
        val forYou = ForYou(
            waiting_on_you = (1..20).map { waiting("c$it") },
            totals = ForYouTotals(waiting_on_you = 63, unread = 41, distinct_work = 67),
        )
        assertEquals(67, forYouHeadlineWork(forYou))
    }

    @Test
    fun `without totals it falls back to counting rows`() {
        // A build running ahead of the Worker keeps today's behaviour — an
        // undercount — rather than showing a new wrong number or nothing.
        val forYou = ForYou(
            waiting_on_you = listOf(waiting("c1"), waiting("c2")),
            my_tasks = listOf(task("t1")),
        )
        assertEquals(3, forYouHeadlineWork(forYou))
    }

    @Test
    fun `the fallback counts a thread in two sections once`() {
        // c1 is assigned to me AND unread, so it appears twice. It is one
        // thing to do. Summing section lengths said two.
        val forYou = ForYou(
            waiting_on_you = listOf(waiting("c1"), waiting("c2")),
            unread = listOf(unread("c1")),
        )
        assertEquals(2, forYouHeadlineWork(forYou))
    }

    @Test
    fun `the fallback counts triage work too`() {
        val forYou = ForYou(
            waiting_on_you = listOf(waiting("c1")),
            triage = ForYouTriage(
                conversations = listOf(ForYouTriageConversation(
                        conversation_id = "c9",
                        status = "new",
                        last_message_at = "2026-07-27T10:00:00Z",
                    )),
                tasks = listOf(ForYouTriageTask(
                        task_id = "t9",
                        title = "Unassigned",
                        conversation_id = "conv-9",
                        message_id = "msg-9",
                    )),
            ),
        )
        assertEquals(3, forYouHeadlineWork(forYou))
    }

    @Test
    fun `an empty queue is zero, not one`() {
        assertEquals(0, forYouHeadlineWork(ForYou()))
    }
}
