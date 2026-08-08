package com.loonext.android.core.time

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * #539 — a time on this screen must say whose clock it is on.
 *
 * The hand-port of `packages/shared/src/two-clocks.ts`.
 *
 * ## The bug this closes
 *
 * A queued message showed "Tue, 8:00 AM", formatted in the CUSTOMER's zone
 * because that is the time whoever scheduled it picked. Nothing said so. A
 * dispatcher in Toronto reading a send queued for a customer in Vancouver saw
 * "8:00 AM", read their own clock, and was three hours out — with nothing on the
 * screen to argue with. The string is correct and the reader is wrong, which is
 * the worst kind of label.
 *
 * ## The rule
 *
 * One instant, two wall clocks. Say both — but ONLY when they differ, because a
 * crew whose customers are all in town would otherwise read
 * "8:00 AM their time · 8:00 AM yours" on every row forever, and a label that is
 * noise on the ordinary day is one people stop reading before the day it matters.
 *
 * ## Why "differ" is decided on the rendered clock, not the zone id
 *
 * `America/Toronto` and `America/New_York` are two names for one clock. Deciding
 * by id would put the label on every row of a workspace that texts across a state
 * line into the same hour. Comparing what a reader would READ is also correct
 * across DST on its own, with no offset arithmetic — and right for the half-hour
 * zones, where an hours-apart number is wrong every day rather than twice a year.
 *
 * ## The split with the formatter
 *
 * This owns the RULE and the WORDS. Turning an instant into a wall clock stays
 * with `java.time`, because a date rendered by hand in three languages is three
 * chances to disagree about a locale.
 */
object TwoClocks {

    /** What the destination's clock is called, in the product's voice. */
    const val THERE = "their time"

    /** ...and the reader's own. Not "my time": the screen is talking TO them. */
    const val HERE = "yours"

    /**
     * Are these two rendered wall clocks the same moment on the same clock face?
     *
     * Takes the FORMATTED strings rather than the zones, so the comparison is
     * whatever the caller is about to put on the screen. Trimmed first, because a
     * formatter that pads one zone differently from another would otherwise force
     * the label on for a difference nobody can see.
     */
    fun sameClock(there: String, here: String): Boolean =
        there.trim() == here.trim()

    /**
     * The line to show for one instant.
     *
     * `here` may be null when the caller already knows the reader's clock is not
     * worth naming. Passing the same string twice is the same as passing null,
     * which is what makes this safe to call unconditionally from a render path.
     *
     * The separator is a middot rather than a bracket or a slash: it reads as one
     * line of two facts, which is what it is, and it survives a narrow row without
     * looking like a truncation.
     */
    fun bothClocks(there: String, here: String? = null): String {
        val t = there.trim()
        if (here == null || sameClock(t, here)) return t
        return "$t $THERE · ${here.trim()} $HERE"
    }

    /**
     * The same two facts spelled out, for TalkBack.
     *
     * A middot is announced as "middle dot" or skipped entirely depending on the
     * reader, and "8:00 AM their time middle dot 11:00 AM yours" is not a sentence.
     */
    fun bothClocksSpoken(there: String, here: String? = null): String {
        val t = there.trim()
        if (here == null || sameClock(t, here)) return t
        return "$t $THERE, which is ${here.trim()} $HERE"
    }

    /**
     * Which clock a typed time is being read in — the switch #539 asks for
     * ("why cant i choose? let me switch?").
     *
     * Two values, not a zone picker. The question a sender actually has is "did I
     * mean 8am here or 8am there", and offering 400 IANA zones to answer it would
     * be a worse version of the same confusion.
     */
    enum class Choice(val label: String) {
        THEIRS("Their time"),
        YOURS("Your time"),
    }

    /**
     * The default side for a typed time, and why it is the reader's own.
     *
     * A native date-and-time picker reads and writes the DEVICE's zone. Defaulting
     * to theirs would mean the value shown is not the value held, which is a worse
     * bug than the one this switch exists to fix.
     */
    val DEFAULT_CHOICE = Choice.YOURS

    /**
     * The instant at which a given zone's clock reads this wall time.
     *
     * What the switch needs: a time picker reads and writes the DEVICE's zone, so
     * "8am their time" is not something the picker can express — the same digits
     * have to be resolved against a different calendar.
     *
     * ## The two days a year, and why this is a one-liner here
     *
     * `java.time` already resolves both edges the way the shared module's iterative
     * version does, and the tests assert that rather than trusting it:
     *
     *   - SPRING FORWARD skips an hour, so 2:30am does not exist. `atZone` shifts
     *     forward by the gap, landing at 3:30 — a send asked for at a time that
     *     never happened goes at the first moment that did, never an hour early.
     *   - FALL BACK has 1:30am twice. `atZone` takes the EARLIER offset, so the
     *     message goes at the first 1:30 rather than an hour after the sender
     *     expected.
     *
     * Returns null for a zone id the runtime rejects, so a caller falls back to the
     * device's own clock rather than sending at a guessed instant.
     */
    fun instantForWallClock(wall: LocalDateTime, timeZone: String): Instant? {
        val zone = runCatching { ZoneId.of(timeZone) }.getOrNull() ?: return null
        return wall.atZone(zone).toInstant()
    }
}
