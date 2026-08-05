package com.loonext.android.core.scheduled

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * #233 — send later, as this phone understands it.
 *
 * A hand-port of packages/shared/src/scheduled-send.ts, mirrored again in
 * apps/ios/Loonext/Core/ScheduledSend.swift. What is shared is the SPEC: which
 * presets exist, the hour they land on, the order, the wording of every reason
 * a message did not go, and which of those reasons will clear on their own.
 *
 * The reasons matter more here than the timing does. `docs/DECISIONS.md` makes
 * disclosure binding — held not dropped, everything held or cancelled told to
 * the owner, time-sensitive work expiring rather than arriving late — and a
 * rule about disclosure is only as good as the sentence doing the disclosing.
 * Three clients writing their own version of "we did not send this" is how one
 * of them ends up saying nothing at all.
 *
 * The calendar arithmetic is deliberately NOT shared, for the same reason
 * `SnoozeTiming` gives: only a real calendar gets DST right. "Tomorrow at 8" on
 * the night the clocks go forward is not "now plus 24 hours", and a hand-rolled
 * offset would be wrong twice a year in a way nobody reports as a bug.
 *
 * Resolved in the DESTINATION's zone rather than the device's, which is the one
 * place this differs from the snooze ladder: a snooze is when YOU want to see
 * something again, and a scheduled text is when THEY read it.
 */
object ScheduledSend {
    /** The hour presets land on. Early enough to be first in the inbox. */
    const val PRESET_HOUR = 8

    /** The longest a scheduled body may be. Mirrors the column check. */
    const val BODY_MAX = 1600

    /** How far out a send may be scheduled. Mirrors the SQL horizon. */
    const val HORIZON_DAYS = 90L

    /** How many live scheduled messages one workspace may hold. Mirrors SQL. */
    const val PER_COMPANY_CAP = 200

    /** ...and one thread, so a conversation cannot become a drip campaign. */
    const val PER_THREAD_CAP = 20

    /** Statuses a scheduled message can be in, mirroring the column's CHECK. */
    val STATUSES = listOf("pending", "held", "sent", "canceled", "expired", "failed")

    /** Still going, as far as anybody knows. */
    fun isLive(status: String): Boolean = status == "pending" || status == "held"

    /**
     * Why a scheduled message did not go, in the words the owner reads.
     *
     * Each is a REASON, not an error. `recipient_opted_out` deliberately offers
     * no remedy, because there is not one — an opt-out can only be lifted by
     * the customer, which is carrier truth rather than our policy.
     */
    val HOLD_REASONS: Map<String, String> = mapOf(
        "subscription_inactive" to
            "Your subscription has lapsed, so this has not been sent. It will go out when billing is sorted.",
        // #277: the seasonal hold. A SEPARATE reason from a lapse because the
        // events and the remedies are separate: nothing lapsed, no card needs
        // sorting, and the number is not on any clock. The sentence above used
        // to say "paused" for a lapse; that word belongs to this now, and two
        // reasons both claiming it is the confusion this roster exists to stop.
        "workspace_paused" to
            "Your plan is paused, so this has not been sent. It will go out when you resume.",
        "registration_pending" to
            "This is waiting on carrier approval for US texting. It will send once that clears.",
        "service_unavailable" to
            "Texting is paused while we deal with an issue. This is still queued and nothing was lost.",
        "customer_replied" to
            "They replied after you scheduled this, so we held it rather than talk over them. Send it anyway, or cancel it.",
        "recipient_opted_out" to
            "They replied STOP after you scheduled this, so it was not sent. Only they can undo that.",
        "invalid_destination" to
            "We cannot text this number any more, so this was not sent.",
        "expired" to
            "The send window passed before this could go, so it was not sent. A late message is usually worse than none.",
        "workspace_closed" to
            "The workspace was closed before this was due to send.",
        // #237: done, deleted, or reminders switched off for that job. One
        // reason for three causes — from the reader's side the actionable fact
        // is identical, and three near-identical sentences is the drift this
        // roster exists to prevent.
        "job_no_longer_scheduled" to
            "That job is no longer booked, so this reminder was not sent.",
    )

    /**
     * Does this reason clear on its own?
     *
     * Drives whether the UI offers "we will keep trying" or asks for a
     * decision. A reason wrongly marked recoverable is a message that retries
     * forever against a condition that will never change.
     */
    fun reasonRecovers(reason: String): Boolean = when (reason) {
        // #277: a pause is the most recoverable state in the product. It is a
        // season, and the whole promise is that everything is where it was left
        // when the crew comes back. Marked terminal, pausing would quietly
        // destroy a workspace's scheduled work.
        "subscription_inactive", "workspace_paused", "registration_pending",
        "service_unavailable", "customer_replied" -> true
        else -> false
    }

    /**
     * The sentences the send-later UI says on every client.
     *
     * [HOLD_REASONS] covers the states where a message did NOT go; this covers
     * the rest of the surface — the picker, the quiet-hours warning, the
     * confirmations. Here for the same reason: three clients writing their own
     * version of "that lands late where they are" is three different products,
     * and the phone is where somebody schedules a text at 9:40pm with the van
     * still running.
     *
     * Whole sentences only. Button labels stay per-platform, because a Compose
     * `TextButton` and a web dialog footer have different conventions and a
     * shared "Cancel" would be pretending otherwise.
     */
    val COPY: Map<String, String> = mapOf(
        "picker_reassurance" to
            "You can change or cancel it any time before it goes.",
        "quiet_hours_choice" to
            "You can send it anyway, or pick a time in their morning.",
        "quiet_hours_unknown" to
            "That time is inside this customer's quiet hours.",
        "canceled_confirmation" to
            "Cancelled — that text will not go out.",
        "nothing_scheduled" to
            "Nothing is waiting to send. Anything you schedule shows up here.",
    )

    /** One line of [COPY], or empty rather than a crash on a key typo. */
    fun copy(key: String): String = COPY[key] ?: ""

    /**
     * Whose clock the sender picked against, said out loud.
     *
     * The same three rungs and the same wording as the thread's "their time"
     * line (`clockProvenance` in MessagingData.kt) — a product that says "from
     * their area code" in one place and something else in another has two
     * vocabularies for one fact.
     */
    fun clockProvenance(source: String): String = when (source) {
        "contact" -> "their time, set on their contact"
        "area_code" -> "their time, from their area code"
        else -> "your workspace's time — we don't know theirs"
    }

    /** One offer in the send-later menu. `at` is null for the picker. */
    data class Preset(val id: String, val label: String, val at: Instant?)

    /**
     * The two presets plus the escape hatch.
     *
     * Two, not five: #233 names exactly these, and a preset list long enough to
     * need reading is slower than the picker it was meant to avoid.
     *
     * Computed in the DESTINATION's zone, because "tomorrow 8am" means 8am
     * where the customer is reading it.
     */
    fun presets(now: Instant, zone: ZoneId): List<Preset> {
        val here = now.atZone(zone)
        return listOf(
            Preset("tomorrow", "Tomorrow, 8:00am", atHour(here.plusDays(1))),
            Preset("monday", "Monday, 8:00am", atHour(nextMonday(here))),
            Preset("custom", "Pick a time", null),
        )
    }

    /** That calendar day at PRESET_HOUR, resolved by the zone's own rules. */
    private fun atHour(day: ZonedDateTime): Instant =
        day.withHour(PRESET_HOUR).withMinute(0).withSecond(0).withNano(0).toInstant()

    /**
     * The next Monday, where "next" from a Monday means the following one.
     *
     * Otherwise "Monday 8:00am" chosen on a Monday afternoon is a time that has
     * already passed, and the API refuses it — a preset that cannot be used.
     */
    private fun nextMonday(from: ZonedDateTime): ZonedDateTime {
        var day = from.plusDays(1)
        while (day.dayOfWeek != DayOfWeek.MONDAY) day = day.plusDays(1)
        return day
    }
}
