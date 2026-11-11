package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import com.loonext.android.ui.common.CallActionsInput
import com.loonext.android.ui.common.callActions
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallPhase
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun call(
    outcome: String? = null,
    state: String? = null,
    direction: String = "inbound",
    forwardSeconds: Int = 0,
    contactName: String? = null,
    callerName: String? = null,
    callerE164: String? = null,
    screening: String? = null,
    id: String = "c1",
    answeredBy: String? = null,
    answeredByName: String? = null,
    answeredAt: String? = null,
    phoneNumberId: String? = null,
) = Call(
    id = id,
    call_session_id = "sess-1",
    caller_e164 = callerE164,
    contact_name = contactName,
    caller_name = callerName,
    phone_number_id = phoneNumberId,
    outcome = outcome,
    state = state,
    direction = direction,
    forward_seconds = forwardSeconds,
    screening_result = screening,
    answered_by_user_id = answeredBy,
    answered_by_name = answeredByName,
    answered_at = answeredAt,
    started_at = "2026-07-15T12:00:00Z",
)

private fun member(id: String, userId: String, name: String) = Member(
    id = id,
    user_id = userId,
    role = "member",
    created_at = "2026-07-01T00:00:00Z",
    display_name = name,
)

private fun number(id: String, e164: String?) = PhoneNumberSummary(
    id = id,
    status = "active",
    country = "US",
    number_e164 = e164,
    created_at = "2026-07-01T00:00:00Z",
)

class CallsLogicTest {
    @Test
    fun `caller resolution order is contact then CNAM then number`() {
        assertEquals(
            "Dana Fix-It",
            callerDisplayName(
                call(contactName = "Dana Fix-It", callerName = "DANA F", callerE164 = "+14155550134"),
            ),
        )
        assertEquals(
            "DANA F",
            callerDisplayName(call(callerName = "DANA F", callerE164 = "+14155550134")),
        )
        assertEquals("(415) 555-0134", callerDisplayName(call(callerE164 = "+14155550134")))
        assertEquals("Unknown caller", callerDisplayName(call()))
    }

    @Test
    fun `ring hero prefers the name, else formats the number, never a bare E164`() {
        // A trusted name always leads.
        assertEquals("Dana Fix-It", callerHeroLine("Dana Fix-It", "+14155550134"))
        // No name: the number becomes the hero, formatted (never raw +1…).
        assertEquals("(415) 555-0134", callerHeroLine("", "+14155550134"))
        assertEquals("(415) 555-0134", callerHeroLine("   ", "+14155550134"))
        // Nothing at all resolves to a stable label, not an empty hero.
        assertEquals("Unknown caller", callerHeroLine("", ""))
        assertEquals("Unknown caller", callerHeroLine("  ", "  "))
        // A non-NANP number is shown as-is rather than dropped.
        assertEquals("+445555", callerHeroLine("", "+445555"))
    }

    @Test
    fun `ring sub-line shows the number only under a name hero`() {
        // Name hero: the formatted number belongs beneath it.
        assertEquals("(415) 555-0134", callerSubLine("Dana Fix-It", "+14155550134"))
        // Number IS the hero: no echo below.
        assertNull(callerSubLine("", "+14155550134"))
        assertNull(callerSubLine("   ", "+14155550134"))
        // No number to show.
        assertNull(callerSubLine("Dana Fix-It", ""))
        assertNull(callerSubLine("Dana Fix-It", "   "))
    }

    @Test
    fun `outcome labels match the web's plain language`() {
        assertEquals("Missed", callOutcomeLabel(call(outcome = "missed")))
        assertEquals("No answer", callOutcomeLabel(call(outcome = "missed", direction = "outbound")))
        assertEquals("Voicemail", callOutcomeLabel(call(outcome = "voicemail")))
        assertEquals("Answered", callOutcomeLabel(call(outcome = "answered")))
        assertEquals(
            "Answered · 4m 32s",
            callOutcomeLabel(call(outcome = "answered", forwardSeconds = 272)),
        )
        assertEquals(
            "You called · 58s",
            callOutcomeLabel(
                call(outcome = "answered", direction = "outbound", forwardSeconds = 58),
            ),
        )
        assertEquals("You called", callOutcomeLabel(call(outcome = "answered", direction = "outbound")))
        assertEquals("In progress", callOutcomeLabel(call(outcome = null)))
        assertEquals("Calling…", callOutcomeLabel(call(outcome = null, direction = "outbound")))
        // Unknown future outcome values degrade to the in-flight copy, never crash.
        assertEquals("In progress", callOutcomeLabel(call(outcome = "some_new_state")))
    }

    @Test
    fun `#191 an answered call names the acting placer or answerer`() {
        // Outbound: the placer's name replaces the viewer-assumed "You called".
        assertEquals(
            "Sam called · 3m 12s",
            callOutcomeLabel(
                call(
                    outcome = "answered",
                    direction = "outbound",
                    forwardSeconds = 192,
                    answeredByName = "Sam",
                ),
            ),
        )
        // Inbound: the answerer's name replaces the bare "Answered".
        assertEquals(
            "Answered by Sam · 4m 32s",
            callOutcomeLabel(
                call(
                    outcome = "answered",
                    direction = "inbound",
                    forwardSeconds = 272,
                    answeredByName = "Sam",
                ),
            ),
        )
        // No talk time still names the actor.
        assertEquals(
            "Sam called",
            callOutcomeLabel(call(outcome = "answered", direction = "outbound", answeredByName = "Sam")),
        )
        assertEquals(
            "Answered by Sam",
            callOutcomeLabel(call(outcome = "answered", direction = "inbound", answeredByName = "Sam")),
        )
    }

    @Test
    fun `#191 falls back to the crew-side copy when the actor is unknown`() {
        assertEquals(
            "You called",
            callOutcomeLabel(call(outcome = "answered", direction = "outbound", answeredByName = null)),
        )
        assertEquals(
            "Answered",
            callOutcomeLabel(call(outcome = "answered", direction = "inbound", answeredByName = null)),
        )
        // A blank name is no name at all — still falls back.
        assertEquals(
            "You called",
            callOutcomeLabel(call(outcome = "answered", direction = "outbound", answeredByName = "  ")),
        )
        assertEquals(
            "Answered",
            callOutcomeLabel(call(outcome = "answered", direction = "inbound", answeredByName = "  ")),
        )
    }

    @Test
    fun `only an inbound miss is actionable urgency`() {
        assertTrue(isActionableMiss(call(outcome = "missed")))
        assertFalse(isActionableMiss(call(outcome = "missed", direction = "outbound")))
        assertFalse(isActionableMiss(call(outcome = "answered")))
    }

    /**
     * #721: the cases `packages/shared/src/call-screening.ts` generates. Every
     * production call carries `"action":"flag_calls"`, and the old word match
     * labelled all of them spam.
     */
    @Test
    fun `screening agrees with the shared vectors`() {
        var dir: File? = File("").absoluteFile
        var text: String? = null
        while (dir != null && text == null) {
            val candidate = File(dir, "packages/shared/vectors/call-screening.json")
            if (candidate.exists()) text = candidate.readText()
            dir = dir.parentFile
        }
        val cases = Json.parseToJsonElement(checkNotNull(text) { "call-screening.json not found" }).jsonArray
        assertTrue("no screening vectors", cases.isNotEmpty())
        for (case in cases.map { it.jsonObject }) {
            val result = case["result"]?.jsonPrimitive?.contentOrNull
            val callerName = case["callerName"]?.jsonPrimitive?.contentOrNull
            assertEquals(
                "result $result, caller $callerName",
                case.getValue("spam").jsonPrimitive.boolean,
                callLooksSpam(result, callerName),
            )
        }
        assertEquals("Spam likely", screeningLabel("spam_likely", null))
        assertNull(screeningLabel("""{"action":"flag_calls","reputation":0}""", null))
    }

    /** #721: every route's reason, in the web's words. */
    @Test
    fun `routing reasons agree with the shared vectors`() {
        var dir: File? = File("").absoluteFile
        var text: String? = null
        while (dir != null && text == null) {
            val candidate = File(dir, "packages/shared/vectors/call-routing.json")
            if (candidate.exists()) text = candidate.readText()
            dir = dir.parentFile
        }
        val cases = Json.parseToJsonElement(checkNotNull(text) { "call-routing.json not found" }).jsonArray
        assertTrue("no routing vectors", cases.isNotEmpty())
        for (case in cases.map { it.jsonObject }) {
            val routing = case.getValue("routing").jsonPrimitive.content
            assertEquals(routing, case["reason"]?.jsonPrimitive?.contentOrNull, callRoutingReason(routing))
        }
        assertEquals(
            "Voicemail · After hours, nobody on call",
            callOutcomeLabel(call(outcome = "voicemail").copy(routing = "after_hours")),
        )
        assertEquals("Missed", callOutcomeLabel(call(outcome = "missed").copy(routing = "rang")))
    }

    /** #725: every end reason, in the web's words. */
    @Test
    fun `end reasons agree with the shared vectors`() {
        var dir: File? = File("").absoluteFile
        var text: String? = null
        while (dir != null && text == null) {
            val candidate = File(dir, "packages/shared/vectors/call-end-reasons.json")
            if (candidate.exists()) text = candidate.readText()
            dir = dir.parentFile
        }
        val cases = Json.parseToJsonElement(checkNotNull(text) { "call-end-reasons.json not found" }).jsonArray
        assertTrue("no end-reason vectors", cases.isNotEmpty())
        for (case in cases.map { it.jsonObject }) {
            val reason = case.getValue("reason").jsonPrimitive.content
            assertEquals(reason, case["words"]?.jsonPrimitive?.contentOrNull, callEndReason(reason))
        }
        assertNull(callEndReason(null))
        assertNull(callEndReason("a_reason_from_the_future"))
        assertEquals(
            "Missed · The caller hung up",
            callOutcomeLabel(call(outcome = "missed").copy(ended_reason = "caller_hung_up")),
        )
        assertEquals(
            "Voicemail · After hours, nobody on call",
            callOutcomeLabel(
                call(outcome = "voicemail").copy(routing = "after_hours", ended_reason = "caller_hung_up"),
            ),
        )
    }

    /** #734: one primary action inline, chosen by what the call needs. */
    @Test
    fun `each outcome gets its one primary action`() {
        val number = "+14155550101"
        // Missed and voicemail want a call back.
        assertEquals(CallRowAction.CALL_BACK, callPrimaryAction(call(outcome = "missed", callerE164 = number)))
        assertEquals(CallRowAction.CALL_BACK, callPrimaryAction(call(outcome = "voicemail", callerE164 = number)))
        // Answered and outbound want a message, whatever their outcome.
        assertEquals(CallRowAction.MESSAGE, callPrimaryAction(call(outcome = "answered", callerE164 = number)))
        assertEquals(
            CallRowAction.MESSAGE,
            callPrimaryAction(call(outcome = "answered", direction = "outbound", callerE164 = number)),
        )
        assertEquals(
            CallRowAction.MESSAGE,
            callPrimaryAction(call(outcome = "missed", direction = "outbound", callerE164 = number)),
        )
        // A caller we cannot reach gets none; a thread alone can still be messaged.
        assertNull(callPrimaryAction(call(outcome = "missed")))
        assertEquals(
            CallRowAction.MESSAGE,
            callPrimaryAction(call(outcome = "missed").copy(conversation_id = "conv-1")),
        )
        // The spoken name is the same key on both, and carries whose it is.
        assertEquals("shell.callActionCallBackFor", callRowActionLabelKey(CallRowAction.CALL_BACK))
        assertEquals("shell.callActionMessageFor", callRowActionLabelKey(CallRowAction.MESSAGE))
    }

    /** #734: everything else that leaves the row is in the record menu. */
    @Test
    fun `the record menu holds everything the row no longer draws`() {
        fun ids(call: Call, canDelete: Boolean = false) = callActions(
            CallActionsInput(
                hasConversation = call.conversation_id != null,
                hasContact = call.contact_id != null,
                callerE164 = call.caller_e164,
                hasVoicemail = false,
                canDelete = canDelete,
                canMakeTask = call.outcome == "answered" && call.conversation_id != null,
                canOpenDetails = true,
            ),
        ).filter { it.allowed }.map { it.id }
        val linked = call(outcome = "answered", callerE164 = "+14155550101")
            .copy(conversation_id = "conv-1", contact_id = "con-1")
        assertEquals(
            listOf("call-back", "text", "copy-number", "contact", "task", "details", "delete-call"),
            ids(linked, canDelete = true),
        )
        // An unsaved number offers Add contact in place of Contact; a miss has no task.
        val bare = call(outcome = "missed", callerE164 = "+14155550101")
        assertEquals(
            listOf("call-back", "text", "copy-number", "add-contact", "details"),
            ids(bare),
        )
        // No number and no thread: Details is all that is left.
        assertEquals(listOf("details"), ids(call(outcome = "missed")))
    }

    /** #734: a tap on the row opens the call's details, never the conversation. */
    @Test
    fun `tapping a call row opens its details`() {
        val screen = listOf("features/calls/CallsScreen.kt")
            .joinToString("\n") { readMainSource(it) }
        assertTrue(screen.contains("onOpen = { onOpenCall(call.call_session_id) }"))
        assertTrue(screen.contains("onClick = onOpen,"))
        // The old action bar under each row is gone.
        assertFalse(screen.contains("CallRowActionBar"))
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val file = File(File(base), relative)
            if (file.exists()) return file.readText()
        }
        throw AssertionError("source not found: $relative")
    }

    @Test
    fun `the calls list narrows only to a known reason`() {
        assertTrue(isCallReasonFilter("after_hours"))
        assertTrue(isCallReasonFilter("declined_by_everyone"))
        assertFalse(isCallReasonFilter("made_up"))
        assertFalse(isCallReasonFilter(null))
        assertEquals("After hours, nobody on call", callReasonLabel("after_hours"))
        assertEquals("Everyone declined", callReasonLabel("declined_by_everyone"))
        assertEquals("answered", callReasonLabel("answered"))
    }

    @Test
    fun `an effect note is silent at zero`() {
        val effects = com.loonext.android.core.model.CallEffects(
            days = 30,
            counts = mapOf("after_hours" to 12),
        )
        assertEquals(12, callEffectCount(effects, "after_hours"))
        assertEquals(0, callEffectCount(effects, "blocked"))
        assertEquals(0, callEffectCount(null, "after_hours"))
    }

    @Test
    fun `the call page says what happened and why there are no words`() {
        assertEquals("shell.outcomeLeftVoicemail", callOutcomeLineKey(call(outcome = "voicemail")))
        assertEquals("shell.outcomeNoAnswer", callOutcomeLineKey(call(outcome = "missed", direction = "outbound")))
        assertEquals("shell.outcomeInProgress", callOutcomeLineKey(call()))
        val lost = callTranscriptState(call(outcome = "voicemail"))
        assertEquals("shell.transcriptRecordingLost", lost.key)
        assertTrue(lost.muted)
        val tried = callTranscriptState(
            call(outcome = "voicemail").copy(has_voicemail = true, voicemail_transcript_attempted_at = "2026-07-15T12:05:00Z"),
        )
        assertEquals("shell.transcriptNoWords", tried.key)
        val words = callTranscriptState(call(outcome = "voicemail").copy(has_voicemail = true, voicemail_transcript = "Call me"))
        assertEquals("Call me", words.text)
        assertFalse(words.muted)
    }

    @Test
    fun `durations format like the web`() {
        assertEquals("58s", formatCallDuration(58))
        assertEquals("4m 32s", formatCallDuration(272))
        assertEquals("2m", formatCallDuration(120))
        assertEquals("0s", formatCallDuration(-5))
    }

    @Test
    fun `a call over an hour reads with hours`() {
        // #570: it read "183m 12s". Nothing caps talk time — the timeouts in the
        // call code bound RINGING and a transfer, not a connected call.
        assertEquals("3h 3m", formatCallDuration(3 * 3600 + 3 * 60 + 12))
        assertEquals("1h", formatCallDuration(3600))
        // The hour boundary, both sides.
        assertEquals("59m 59s", formatCallDuration(3599))
        assertEquals("1h", formatCallDuration(3601))
        // Seconds are dropped past an hour and kept under one.
        assertEquals("1h", formatCallDuration(3600 + 59))
        assertEquals("59s", formatCallDuration(59))
    }

    @Test
    fun `the live clock and the logged duration agree about the same call`() {
        // #570: they did not. formatTimer has always rolled over to 1:02:33 while
        // formatCallDuration said "62m 33s", so one call was described two ways
        // depending on whether it was still happening.
        val oneHourTwoMinutes = 3600 + 2 * 60 + 33
        assertEquals("1:02:33", formatTimer(oneHourTwoMinutes * 1000L))
        assertEquals("1h 2m", formatCallDuration(oneHourTwoMinutes))
    }

    @Test
    fun `the live timer formats minutes and hours`() {
        assertEquals("0:00", formatTimer(0))
        assertEquals("0:42", formatTimer(42_000))
        assertEquals("12:04", formatTimer((12 * 60 + 4) * 1000L))
        assertEquals("1:02:33", formatTimer((3600 + 2 * 60 + 33) * 1000L))
    }

    @Test
    fun `dialable numbers are NANP - 10 digits, 11 with a 1, or already E164`() {
        assertEquals("+14155550134", dialableE164("4155550134"))
        assertEquals("+14155550134", dialableE164("(415) 555-0134"))
        assertEquals("+14155550134", dialableE164("14155550134"))
        assertEquals("+14155550134", dialableE164("+1 415 555 0134"))
        assertNull(dialableE164("415555"))
        assertNull(dialableE164(""))
        assertNull(dialableE164("24155550134"))
    }

    @Test
    fun `progressive dial formatting`() {
        assertEquals("", formatAsYouDial(""))
        assertEquals("(415", formatAsYouDial("415"))
        assertEquals("(415) 555", formatAsYouDial("415555"))
        assertEquals("(415) 555-0134", formatAsYouDial("4155550134"))
        assertEquals("(415) 555-0134", formatAsYouDial("14155550134"))
    }

    // -------------------------------------- #202 in-call controls honesty

    @Test
    fun `route toggle lights from the OS-confirmed route only`() {
        // Nothing lit before the OS reports an endpoint.
        assertFalse(routeToggleLit(AudioRoute.SPEAKER, pending = null, confirmed = null))
        assertFalse(routeToggleLit(AudioRoute.BLUETOOTH, pending = null, confirmed = null))
        // The confirmed route drives the lit state, including switches the OS
        // or a headset made on its own.
        assertTrue(routeToggleLit(AudioRoute.BLUETOOTH, null, AudioRoute.BLUETOOTH))
        assertTrue(routeToggleLit(AudioRoute.SPEAKER, null, AudioRoute.SPEAKER))
        assertFalse(routeToggleLit(AudioRoute.SPEAKER, null, AudioRoute.BLUETOOTH))
        assertFalse(routeToggleLit(AudioRoute.BLUETOOTH, null, AudioRoute.EARPIECE))
    }

    @Test
    fun `optimistic pending choice wins only until the OS answers`() {
        // Tap speaker while the earpiece is confirmed: speaker reads lit.
        assertTrue(routeToggleLit(AudioRoute.SPEAKER, AudioRoute.SPEAKER, AudioRoute.EARPIECE))
        // The pending choice unlights the other toggle at the same time.
        assertFalse(routeToggleLit(AudioRoute.BLUETOOTH, AudioRoute.SPEAKER, AudioRoute.BLUETOOTH))
        // Pending cleared (confirm or revert): back to the confirmed truth.
        assertFalse(routeToggleLit(AudioRoute.SPEAKER, null, AudioRoute.EARPIECE))
    }

    @Test
    fun `speaker and bluetooth can never both read lit`() {
        val options = listOf<AudioRoute?>(null) + AudioRoute.values()
        for (pending in options) {
            for (confirmed in options) {
                val lit = AudioRoute.values().filter { routeToggleLit(it, pending, confirmed) }
                assertTrue(
                    "pending=$pending confirmed=$confirmed lit=$lit",
                    lit.size <= 1,
                )
            }
        }
    }

    @Test
    fun `bluetooth toggle exists only when a BT endpoint does`() {
        assertFalse(bluetoothToggleAvailable(emptySet()))
        assertFalse(bluetoothToggleAvailable(setOf(AudioRoute.EARPIECE, AudioRoute.SPEAKER)))
        assertTrue(bluetoothToggleAvailable(setOf(AudioRoute.EARPIECE, AudioRoute.BLUETOOTH)))
        assertTrue(bluetoothToggleAvailable(setOf(AudioRoute.BLUETOOTH)))
    }

    @Test
    fun `tapping a lit toggle returns to earpiece - an unlit one requests its route`() {
        assertEquals(AudioRoute.SPEAKER, routeTapTarget(AudioRoute.SPEAKER, lit = false))
        assertEquals(AudioRoute.EARPIECE, routeTapTarget(AudioRoute.SPEAKER, lit = true))
        assertEquals(AudioRoute.BLUETOOTH, routeTapTarget(AudioRoute.BLUETOOTH, lit = false))
        assertEquals(AudioRoute.EARPIECE, routeTapTarget(AudioRoute.BLUETOOTH, lit = true))
    }

    @Test
    fun `note control says Linking while the thread link resolves`() {
        assertEquals("Linking…", noteControlLabel(linked = false, resolving = true))
        assertEquals("Note", noteControlLabel(linked = true, resolving = false))
        // Resolution genuinely gave up: honest plain label, no endless pending.
        assertEquals("Note", noteControlLabel(linked = false, resolving = false))
        // A linked note is never pending, whatever the resolver flag says.
        assertEquals("Note", noteControlLabel(linked = true, resolving = true))
    }

    // -------------------------------------------- #210 ongoing call card

    @Test
    fun `ongoing means outcome unstamped and state not already ended`() {
        assertTrue(isOngoingCall(call(outcome = null, state = null)))
        assertTrue(isOngoingCall(call(outcome = null, state = "ringing")))
        assertTrue(isOngoingCall(call(outcome = null, state = "answered")))
        assertTrue(isOngoingCall(call(outcome = null, state = "voicemail_greeting")))
        assertTrue(isOngoingCall(call(outcome = null, state = "voicemail_recording")))
        // Mirror lag: the state already says terminal — never pin a ghost.
        assertFalse(isOngoingCall(call(outcome = null, state = "ended_missed")))
        assertFalse(isOngoingCall(call(outcome = null, state = "ended_answered")))
        assertFalse(isOngoingCall(call(outcome = null, state = "ended_rejected")))
        // A stamped outcome resolves the row whatever the mirror still says.
        assertFalse(isOngoingCall(call(outcome = "answered", state = "answered")))
        assertFalse(isOngoingCall(call(outcome = "missed")))
        assertFalse(isOngoingCall(call(outcome = "voicemail")))
    }

    @Test
    fun `ongoing-resolved partition preserves the log's order and loses nothing`() {
        val list = listOf(
            call(id = "a", outcome = null, state = "ringing"),
            call(id = "b", outcome = "missed"),
            call(id = "c", outcome = null, state = "answered"),
            call(id = "d", outcome = "answered"),
        )
        assertEquals(listOf("a", "c"), ongoingCalls(list).map { it.id })
        assertEquals(listOf("b", "d"), resolvedCalls(list).map { it.id })
        assertTrue(ongoingCalls(emptyList()).isEmpty())
    }

    @Test
    fun `phase follows state first, then the answer stamps, then direction`() {
        assertEquals(OngoingPhase.RINGING, ongoingPhase(call(state = "ringing")))
        assertEquals(OngoingPhase.ANSWERED, ongoingPhase(call(state = "answered")))
        assertEquals(OngoingPhase.VOICEMAIL, ongoingPhase(call(state = "voicemail_greeting")))
        assertEquals(OngoingPhase.VOICEMAIL, ongoingPhase(call(state = "voicemail_recording")))
        // No state (outbound rows and pre-backfill rows): stamps speak next.
        assertEquals(OngoingPhase.ANSWERED, ongoingPhase(call(answeredBy = "u1")))
        assertEquals(
            OngoingPhase.ANSWERED,
            ongoingPhase(call(direction = "outbound", answeredAt = "2026-07-15T12:00:30Z")),
        )
        assertEquals(OngoingPhase.DIALING, ongoingPhase(call(direction = "outbound")))
        assertEquals(OngoingPhase.RINGING, ongoingPhase(call()))
    }

    @Test
    fun `status line - ringing names no one, answered names who has the line`() {
        assertEquals("Ringing…", ongoingStatusLabel(OngoingPhase.RINGING, memberName = null))
        // A ringing call never shows a member, even if a stale name is passed.
        assertEquals("Ringing…", ongoingStatusLabel(OngoingPhase.RINGING, memberName = "Dana"))
        assertEquals("With Dana", ongoingStatusLabel(OngoingPhase.ANSWERED, "Dana"))
        // Answered but the roster can't name the member: the line is still
        // honestly taken, not blank.
        assertEquals("On a call", ongoingStatusLabel(OngoingPhase.ANSWERED, null))
        assertEquals("On a call", ongoingStatusLabel(OngoingPhase.ANSWERED, "  "))
        assertEquals("Calling…", ongoingStatusLabel(OngoingPhase.DIALING, null))
        assertEquals("Leaving a voicemail", ongoingStatusLabel(OngoingPhase.VOICEMAIL, null))
    }

    @Test
    fun `only the answered phase ticks a timer`() {
        assertTrue(ongoingShowsTimer(OngoingPhase.ANSWERED))
        assertFalse(ongoingShowsTimer(OngoingPhase.RINGING))
        assertFalse(ongoingShowsTimer(OngoingPhase.DIALING))
        assertFalse(ongoingShowsTimer(OngoingPhase.VOICEMAIL))
    }

    @Test
    fun `timer anchors on answered_at and falls back to started_at`() {
        assertEquals(
            "2026-07-15T12:00:30Z",
            ongoingAnchorIso(call(answeredAt = "2026-07-15T12:00:30Z")),
        )
        assertEquals("2026-07-15T12:00:00Z", ongoingAnchorIso(call()))
    }

    @Test
    fun `member names resolve from the roster by user id`() {
        val roster = listOf(
            member("m1", "u1", "Dana"),
            member("m2", "u2", ""),
        )
        assertEquals("Dana", memberDisplayName("u1", roster))
        // A blank display name is no name at all.
        assertNull(memberDisplayName("u2", roster))
        assertNull(memberDisplayName("u9", roster))
        assertNull(memberDisplayName(null, roster))
        assertNull(memberDisplayName("u1", emptyList()))
    }

    @Test
    fun `number chip appears only when the company owns more than one number`() {
        val one = listOf(number("n1", "+14155550100"))
        val two = one + number("n2", "+14155550101")
        // One number: zero ambiguity, no chip.
        assertNull(ongoingNumberLabel("n1", one))
        assertEquals("(415) 555-0101", ongoingNumberLabel("n2", two))
        // Unresolvable or absent ids stay quiet instead of guessing.
        assertNull(ongoingNumberLabel("n9", two))
        assertNull(ongoingNumberLabel(null, two))
        assertNull(ongoingNumberLabel("n3", two + number("n3", null)))
    }

    // -------------------------------------------- #204 living backdrop

    @Test
    fun `backdrop drifts calm at full glow while ringing or dialing`() {
        assertEquals(BackdropSpec(drift = 1f, glow = 1f), backdropSpec(CallPhase.RINGING))
        assertEquals(BackdropSpec(drift = 1f, glow = 1f), backdropSpec(CallPhase.CONNECTING))
    }

    @Test
    fun `backdrop nearly stills during the call and cools at the end`() {
        val ringing = backdropSpec(CallPhase.RINGING)
        val active = backdropSpec(CallPhase.ACTIVE)
        val held = backdropSpec(CallPhase.HELD)
        val ended = backdropSpec(CallPhase.ENDED)
        // The conversation owns the screen: motion drops hard but never to zero.
        assertTrue(active.drift < ringing.drift * 0.4f)
        assertTrue(active.drift > 0f)
        // Hold sits quieter than active; the end is the quietest and dimmest.
        assertTrue(held.drift <= active.drift)
        assertTrue(held.glow < active.glow)
        assertTrue(ended.drift <= held.drift)
        assertTrue(ended.glow < held.glow)
        assertTrue(ended.glow > 0f)
        // No call at all reads exactly like an ended one (cooling, not dead).
        assertEquals(ended, backdropSpec(null))
    }

    @Test
    fun `connect pulse fires exactly on ring-or-dial to active`() {
        assertTrue(connectPulseFires(CallPhase.RINGING, CallPhase.ACTIVE))
        assertTrue(connectPulseFires(CallPhase.CONNECTING, CallPhase.ACTIVE))
        // Resume from hold is not a connect.
        assertFalse(connectPulseFires(CallPhase.HELD, CallPhase.ACTIVE))
        // Composing onto an already-active call must not flash.
        assertFalse(connectPulseFires(null, CallPhase.ACTIVE))
        assertFalse(connectPulseFires(CallPhase.ACTIVE, CallPhase.ACTIVE))
        // Leaving active never pulses.
        assertFalse(connectPulseFires(CallPhase.ACTIVE, CallPhase.HELD))
        assertFalse(connectPulseFires(CallPhase.ACTIVE, CallPhase.ENDED))
        assertFalse(connectPulseFires(CallPhase.RINGING, CallPhase.ENDED))
        assertFalse(connectPulseFires(CallPhase.RINGING, null))
    }

    @Test
    fun `activity backdrop phase mirrors the surface branch order`() {
        // A live call always wins, whatever else is set.
        assertEquals(
            CallPhase.ACTIVE,
            activityBackdropPhase(
                livePhase = CallPhase.ACTIVE,
                answerFailed = true,
                answering = true,
                ringing = true,
            ),
        )
        assertEquals(
            CallPhase.HELD,
            activityBackdropPhase(
                livePhase = CallPhase.HELD,
                answerFailed = false,
                answering = false,
                ringing = false,
            ),
        )
        // A failed answer cools like an ended call.
        assertEquals(
            CallPhase.ENDED,
            activityBackdropPhase(
                livePhase = null,
                answerFailed = true,
                answering = true,
                ringing = true,
            ),
        )
        // Mid-answer with nothing live yet: connecting drift.
        assertEquals(
            CallPhase.CONNECTING,
            activityBackdropPhase(
                livePhase = null,
                answerFailed = false,
                answering = true,
                ringing = true,
            ),
        )
        // The ring surface (including the lock-screen ring).
        assertEquals(
            CallPhase.RINGING,
            activityBackdropPhase(
                livePhase = null,
                answerFailed = false,
                answering = false,
                ringing = true,
            ),
        )
        // The cold "Connecting…" fallback.
        assertEquals(
            CallPhase.CONNECTING,
            activityBackdropPhase(
                livePhase = null,
                answerFailed = false,
                answering = false,
                ringing = false,
            ),
        )
    }

    @Test
    fun `a deleted call leaves the log and Undo puts it back in time order`() {
        val a = call(id = "a").copy(started_at = "2026-11-10T12:00:00Z")
        val b = call(id = "b").copy(started_at = "2026-11-10T11:00:00Z")
        val c = call(id = "c").copy(started_at = "2026-11-10T10:00:00Z")
        val after = withoutCall(listOf(a, b, c), "b")
        assertEquals(listOf("a", "c"), after.map { it.id })
        assertEquals(listOf("a", "b", "c"), reinsertCall(after, b).map { it.id })
        // Restoring twice never duplicates the row.
        assertEquals(3, reinsertCall(reinsertCall(after, b), b).size)
    }

    @Test
    fun `deleting a voicemail keeps the call and drops the recording and its words`() {
        val vm = call(id = "v", outcome = "voicemail").copy(
            voicemail_seconds = 22,
            voicemail_transcript = "Call me back",
        )
        val other = call(id = "o").copy(voicemail_seconds = 5)
        val after = withoutVoicemail(listOf(vm, other), "v")
        assertEquals(2, after.size)
        assertNull(after[0].voicemail_seconds)
        assertNull(after[0].voicemail_transcript)
        assertNull(after[0].voicemail_intake)
        assertEquals(5, after[1].voicemail_seconds)
    }
}
