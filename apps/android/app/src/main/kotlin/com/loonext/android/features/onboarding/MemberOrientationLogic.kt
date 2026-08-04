package com.loonext.android.features.onboarding

import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole

/**
 * #286 — who is shown the joining orientation, and when.
 *
 * Hand-ported from packages/shared/src/member-orientation.ts and covered by the
 * same vectors. The decision is three lines and it is on three clients: a phone
 * that disagrees with the web about whether somebody is new shows them the flow
 * twice, or never.
 */

/**
 * Show the joining orientation?
 *
 * [oriented] is the server's answer for THIS membership (api_member_firsts), so
 * a skip on a phone is a skip on the laptop too. Null means the read has not
 * landed: show nothing rather than flashing four screens at somebody who has
 * been here for months.
 *
 * The audience is the one #405 already drew for the first-run checklist —
 * somebody who answers customers and does not run the workspace. Not a filtered
 * version of the owner's flow but a different one, for the same reason: the
 * owner walked a five-step wizard and chose this product, and the member was
 * told to use it.
 *
 * Deliberately NOT shown to a read-only observer or a bookkeeper. Every screen
 * of it is about answering customers, which neither of them does; four screens
 * explaining a job that is not yours is worse than no screens.
 */
fun shouldShowOrientation(role: String?, oriented: Boolean?): Boolean {
    if (oriented != false) return false
    if (role == null) return false
    if (MemberRole.has(role, Capability.SETTINGS_MANAGE)) return false
    return MemberRole.has(role, Capability.CONVERSATIONS_SEND)
}

/**
 * How far along the bar reads, 0..1 — never zero.
 *
 * Somebody on screen one has already done something: they accepted an invite,
 * signed in and opened the app. A bar that starts empty says otherwise and
 * makes four screens feel like a form.
 *
 * *Applying: Goal Gradient Effect.*
 */
fun orientationProgress(index: Int, total: Int = ORIENTATION_SCREEN_COUNT): Float {
    val clamped = index.coerceIn(0, total - 1)
    return (clamped + 1).toFloat() / total
}

/**
 * #521: the joining note as the first screen should carry it, or null when
 * there is nothing to carry.
 *
 * `{ note: null }` is the ordinary answer, not a failure: every membership
 * predating this, every owner who made their own workspace and every invite
 * sent without a note reads that way. A blank-looking note is the same
 * nothing: the server normalises whitespace away, and a client that trusted
 * it blindly would open an empty quotation mark over an empty line.
 */
fun joiningNoteToShow(note: String?): String? = note?.trim()?.ifEmpty { null }
