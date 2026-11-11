package com.loonext.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #722 phase 3: every state machine the phone renders actions for is decoded
 * from `allowed_actions` by one model file and read by one screen file.
 *
 * The API serves `allowed_actions` on each record and refuses an action that is
 * not in it, so a phone that keeps its own local check shows a button the
 * server will refuse. A machine named here whose model or screen no longer
 * mentions the field fails, and the machines the phone does not offer say why.
 *
 * `packages/shared/src/state-machines/allowed-actions-roster.test.ts` holds the
 * list of machines that exist and names the same files, so a new machine fails
 * there until it has a row here.
 */
class AllowedActionsRosterTest {
    private data class Row(val machine: String, val model: String, val screen: String)

    private val base = "apps/android/app/src/main/kotlin/com/loonext/android/"

    private val rows = listOf(
        Row("conversation", "core/model/Messaging.kt", "features/inbox/InboxTab.kt"),
        Row("conversation_visibility", "core/model/Messaging.kt", "ui/common/RecordActions.kt"),
        // The retry button on a bubble and the menu item both read `Message.retryable`.
        Row("message", "core/model/Messaging.kt", "core/model/Messaging.kt"),
        Row("task", "core/model/Tasks.kt", "features/tasks/TaskRecordMenu.kt"),
        Row("call", "core/model/Calls.kt", "features/calls/CallsLogic.kt"),
        Row("scheduled_message", "core/model/Messaging.kt", "features/inbox/ScheduledSheet.kt"),
        Row("quote", "features/quotes/QuotesData.kt", "features/thread/ThreadQuotes.kt"),
        Row("payment_request", "features/payments/PaymentsData.kt", "features/thread/PaymentStrip.kt"),
        Row("subscription", "core/model/Core.kt", "features/settings/BillingSection.kt"),
        Row("workspace", "core/model/Core.kt", "features/settings/BillingSection.kt"),
        Row("registration", "features/settings/SettingsModels.kt", "features/settings/RegistrationFixForm.kt"),
        Row("port", "features/settings/SettingsModels.kt", "features/settings/PortCards.kt"),
        Row("phone_number", "core/model/Core.kt", "features/settings/NumbersSection.kt"),
        Row("text_enablement", "features/settings/SettingsModels.kt", "features/settings/TextEnableCards.kt"),
        Row("invite", "core/model/Team.kt", "features/settings/TeamSection.kt"),
        Row("data_export", "features/settings/SettingsModels.kt", "features/settings/UsageExportCard.kt"),
    )

    /** Machines with actions that the phone does not offer, and why. */
    private val notOffered = mapOf(
        "calendar_connection" to "Calendar connections are connected and removed on the web; the phones do not manage them.",
        "calendar_link" to "Calendar links are managed on the web; the phones do not manage them.",
    )

    private val field = Regex("""allowed_?[aA]ctions""")

    private fun repoRoot(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, base).isDirectory) return dir
            dir = dir.parentFile
        }
        throw AssertionError("repo root not found from ${File("").absolutePath}")
    }

    private fun mentionsField(relative: String): Boolean {
        val file = File(repoRoot(), base + relative)
        return file.isFile && field.containsMatchIn(file.readText())
    }

    @Test
    fun `every machine the phone renders names a model and a screen that carry allowed_actions`() {
        var checked = 0
        val missing = mutableListOf<String>()
        for (row in rows) {
            for ((role, path) in listOf("model" to row.model, "screen" to row.screen)) {
                checked += 1
                if (!mentionsField(path)) missing += "${row.machine} $role: $path"
            }
        }
        // A roster that checks nothing reports clean.
        assertTrue("checked $checked files", checked > 0)
        assertEquals("checked $checked files; these lack allowed_actions", emptyList<String>(), missing)
    }

    @Test
    fun `the machines are listed once and the machines not offered say why`() {
        assertEquals(rows.map { it.machine }.distinct(), rows.map { it.machine })
        assertTrue("no machine is offered by the phone", rows.isNotEmpty())
        assertTrue(rows.none { it.machine in notOffered })
        for ((machine, reason) in notOffered) {
            assertTrue("$machine needs a reason", reason.length > 10)
        }
    }
}
