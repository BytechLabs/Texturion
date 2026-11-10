package com.loonext.android.core.time

import java.time.Instant
import java.time.ZoneId

/**
 * #720: which words a date or time is shown in. Hand-port of
 * `packages/shared/src/timestamp-shape.ts`; `TimestampShapeVectorsTest` runs it
 * against `packages/shared/vectors/timestamp-shape.json`.
 *
 * Calendar days are counted in the reader's zone, so a text from 11 PM last night
 * is "yesterday" even when it was four hours ago.
 */
enum class TimestampBucket(val wire: String) {
    NOW("now"),
    MINUTES_AGO("minutesAgo"),
    TODAY("today"),
    YESTERDAY("yesterday"),
    TOMORROW("tomorrow"),
    THIS_WEEK("thisWeek"),
    THIS_YEAR("thisYear"),
    OLDER("older"),
}

data class TimestampShape(val bucket: TimestampBucket, val minutes: Int = 0)

private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 60 * MINUTE_MS

fun timestampShape(atMs: Long, nowMs: Long, zone: ZoneId): TimestampShape {
    val ago = nowMs - atMs
    if (Math.abs(ago) < MINUTE_MS) return TimestampShape(TimestampBucket.NOW)
    if (ago > 0 && ago < HOUR_MS) {
        return TimestampShape(TimestampBucket.MINUTES_AGO, (ago / MINUTE_MS).toInt())
    }
    val at = Instant.ofEpochMilli(atMs).atZone(zone).toLocalDate()
    val now = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val daysAgo = now.toEpochDay() - at.toEpochDay()
    return TimestampShape(
        when {
            daysAgo == 0L -> TimestampBucket.TODAY
            daysAgo == 1L -> TimestampBucket.YESTERDAY
            daysAgo == -1L -> TimestampBucket.TOMORROW
            Math.abs(daysAgo) < 7 -> TimestampBucket.THIS_WEEK
            at.year == now.year -> TimestampBucket.THIS_YEAR
            else -> TimestampBucket.OLDER
        },
    )
}
