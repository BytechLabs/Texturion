package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #733: a notice that carries an action goes through one helper.
 *
 * - An Undo or an Open on a snackbar is `showUndo` / `showOpen` (5 seconds, the
 *   web's `UNDO_DURATION_MS`), never an `actionLabel` handed to `showSnackbar`.
 * - A delete that cannot be put back asks first through `ConfirmDialog`, then
 *   reports plainly. Fails on a file that says "deleted" or "removed" without
 *   one, unless the exception names why it is safe.
 * - The platform `Toast` is not a notice with an action; each use is named.
 */
class NoticeGuardTest {
    private val actionRule = "an action label handed straight to showSnackbar"
    private val visualsRule = "TrashSnackbarVisuals built outside the helper"
    private val toastRule = "Toast.makeText"
    private val deleteRule = "a deleted/removed notice in a file with no ConfirmDialog"

    private val doneKey = Regex(""""[A-Za-z]+\.(?!hist|activity|sys)[A-Za-z]*(?:Deleted|Removed)(?:One|Many)?"""")

    private val guard = PatternGuard(
        name = "NoticeGuardTest",
        home = setOf("ui/common/Notices.kt", "ui/common/TrashSnackbar.kt"),
        rules = listOf(
            callRule(actionRule, "showSnackbar", Regex("""\bactionLabel\b""")),
            regexRule(visualsRule, Regex("""\bTrashSnackbarVisuals\(""")),
            regexRule(toastRule, Regex("""\bToast\.makeText\(""")),
            GuardRule(deleteRule) { s ->
                if (s.path.startsWith("core/") || s.path.startsWith("features/activity/") || s.text.contains("ConfirmDialog(")) 0 else doneKey.findAll(s.text).count()
            },
        ),
        roster = listOf(
            GuardException(
                "features/attachments/MeteredMedia.kt", actionRule, 1,
                "the action is 'Load' on a data-saver prompt: neither an Undo nor an Open",
            ),
            GuardException(
                "features/tasks/NewTask.kt", toastRule, 1,
                "the sheet closes with no snackbar host to outlive it; the notice is plain and has no action",
            ),
            GuardException(
                "features/tasks/CallTask.kt", toastRule, 1,
                "same as NewTask: a plain notice from a sheet that closes itself",
            ),
            GuardException(
                "features/thread/AttachmentsGalleryScreen.kt", toastRule, 1,
                "a plain failure report from a full-screen viewer that has no snackbar host",
            ),
            GuardException(
                "ui/common/VoicemailTranscript.kt", toastRule, 1,
                "'copied' feedback from a long press inside a row, no host in reach",
            ),
        ) + deleteExceptions(),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no action label outside the helper and no plain delete without a confirm`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()

    @Test
    fun `an undo and an open last ten seconds like iOS`() {
        // Twice web's 5 seconds on purpose: docs/UNDO-AUDIT.md §3.
        assertEquals(10_000L, NOTICE_ACTION_WINDOW_MS)
    }

    private fun deleteExceptions() = listOf(
        undoable("features/calls/CallsScreen.kt", 2),
        undoable("features/inbox/InboxTab.kt", 1),
        undoable("features/thread/ThreadController.kt", 3),
        GuardException(
            "features/foryou/ForYouTab.kt", deleteRule, 1,
            "taking a panel off the page is put back from the same page, and nothing is lost",
        ),
        GuardException(
            "features/settings/ClosedDatesCard.kt", deleteRule, 1,
            "a closed date is a row the owner re-adds in seconds; the card reports it plainly",
        ),
    )

    private fun undoable(file: String, count: Int) = GuardException(
        file, deleteRule, count,
        "the delete goes to the Trash and the notice carries Undo through showUndo",
    )
}
