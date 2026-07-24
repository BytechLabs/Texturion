package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallPhase
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

    @Test
    fun `screening labels stay quiet unless the carrier flagged the call`() {
        assertNull(screeningLabel(null))
        assertNull(screeningLabel(""))
        assertNull(screeningLabel("no_flag"))
        assertNull(screeningLabel("CLEAN"))
        assertEquals("Spam likely", screeningLabel("SPAM"))
        assertEquals("Spam likely", screeningLabel("fraud_risk"))
        assertEquals("Spam likely", screeningLabel("robocall"))
        assertNull(screeningLabel("unknown_verdict"))
    }

    @Test
    fun `durations format like the web`() {
        assertEquals("58s", formatCallDuration(58))
        assertEquals("4m 32s", formatCallDuration(272))
        assertEquals("2m", formatCallDuration(120))
        assertEquals("0s", formatCallDuration(-5))
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
        assertEquals("On the line", ongoingStatusLabel(OngoingPhase.ANSWERED, null))
        assertEquals("On the line", ongoingStatusLabel(OngoingPhase.ANSWERED, "  "))
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
}
