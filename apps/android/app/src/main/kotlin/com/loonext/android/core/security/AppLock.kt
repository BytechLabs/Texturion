package com.loonext.android.core.security

/**
 * #330 — whether the inbox should be behind a lock right now.
 *
 * ## Why this exists at all
 *
 * D12's customer is a crew of one to ten texting customers from PERSONAL
 * handsets. The device this app runs on is not a work device: it is the tech's
 * own phone, and a spare one lives in the truck and gets handed to whoever is
 * covering the weekend. Today there is nothing between "signed in" and "signed
 * out", so handing the phone over hands over every customer conversation.
 *
 * ## The tension, and how it is resolved rather than dismissed
 *
 * A lock is friction on the one thing this product promises — answering a
 * customer inside the five minutes that decide the job (#388). A crew sharing a
 * truck phone and a sole operator have OPPOSITE correct answers, so the lock is
 * optional and off by default, and the grace window below exists so that
 * checking a map and coming back is not a second authentication.
 *
 * ## Pure on purpose
 *
 * Every decision is here, and the prompt is not. Whether the app is locked is
 * arithmetic over four facts; showing a fingerprint sheet is a platform call that
 * no unit test can exercise. Keeping them apart is what makes the rules — cold
 * start always locks, the grace is a maximum not a minimum, an unlock does not
 * outlive a sign-out — assertions rather than intentions.
 */
object AppLock {

    /**
     * How long the app may be away before it locks again.
     *
     * Sixty seconds is chosen against the two real cases rather than as a round
     * number. Glancing at the map, the dialler or a photo and coming back is
     * seconds, and re-authenticating for that would teach people to turn this
     * off — which protects nobody. Handing a phone to somebody else is longer
     * than a minute in practice, and a cold start locks regardless of any of
     * this.
     *
     * It is a MAXIMUM, not a promise: anything that clears the unlock earlier —
     * a sign-out, a process death — locks sooner.
     */
    const val GRACE_MILLIS: Long = 60_000L

    /** Why the lock is showing, so the screen can say something true. */
    enum class Reason {
        /** The process started fresh. Nothing is trusted across a cold start. */
        COLD_START,

        /** Away longer than the grace window. */
        AWAY_TOO_LONG,

        /** Turned on while the app was open, so nothing has been unlocked yet. */
        NEVER_UNLOCKED,
    }

    /**
     * Should the app be locked?
     *
     * @param enabled the member turned the lock on for this device.
     * @param unlockedAtMillis when the lock was last satisfied IN THIS PROCESS, or
     *   null if it has not been. Deliberately not persisted — see [Reason.COLD_START].
     * @param nowMillis the clock, passed in so this is testable and so a device
     *   whose clock jumps cannot be reasoned about differently here than in a test.
     */
    fun reasonToLock(
        enabled: Boolean,
        unlockedAtMillis: Long?,
        nowMillis: Long,
    ): Reason? {
        if (!enabled) return null
        if (unlockedAtMillis == null) return Reason.NEVER_UNLOCKED
        // A CLOCK THAT WENT BACKWARDS LOCKS. `now < unlockedAt` should be
        // impossible and happens anyway — a manual time change, an NTP
        // correction. Treating a negative age as "recently unlocked" would make
        // moving the clock back a way past the lock, so the honest answer to an
        // age that cannot be trusted is to ask again.
        val age = nowMillis - unlockedAtMillis
        if (age < 0L) return Reason.AWAY_TOO_LONG
        if (age > GRACE_MILLIS) return Reason.AWAY_TOO_LONG
        return null
    }

    /**
     * What the lock screen says, given why it is showing.
     *
     * Never "Session expired" or anything that reads as a fault. Nothing has gone
     * wrong: the person turned this on, and the phone is theirs.
     */
    fun headline(reason: Reason): String = when (reason) {
        Reason.COLD_START, Reason.AWAY_TOO_LONG -> "Unlock to see your inbox"
        Reason.NEVER_UNLOCKED -> "Unlock to finish turning this on"
    }

    /**
     * Whether the lock may be turned ON, given what the device can actually do.
     *
     * FAILS CLOSED IN THE HONEST DIRECTION: a device with no biometric and no
     * screen lock cannot enforce this, so the setting refuses to turn on rather
     * than displaying a lock that anything can walk past. Silently accepting the
     * toggle would be the worse outcome — somebody would believe the phone in
     * their glovebox was protected.
     */
    fun canEnable(hasBiometric: Boolean, hasDeviceCredential: Boolean): Boolean =
        hasBiometric || hasDeviceCredential

    /** Why it cannot be turned on, for the one case where that is true. */
    const val CANNOT_ENABLE_NOTE: String =
        "Set a screen lock, fingerprint or face unlock on this phone first — " +
            "without one there is nothing for this to ask you for."
}
