package com.loonext.android.push

/**
 * The calls-wake seam (#135/#155). An incoming-call push (`kind:'call'`) is
 * handed here instead of the notification tray when a handler is installed —
 * #155's SoftphoneManager.onIncomingCallPush should implement this (register
 * the softphone, then POST /v1/calls/live/{sessionId}/ring-me exactly once).
 *
 * [PushContent.callSessionId] carries the `call_session_id` parsed from the
 * wake link; [PushContent.title]/[PushContent.body] carry the caller line for
 * an in-app ring surface.
 */
fun interface CallWakeHandler {
    fun onIncomingCallPush(content: PushContent)
}

/**
 * The ring-revocation seam (calls-v3 §9.2). A `kind:'call_end'` push exits
 * every ringing surface for a session on every ringing-exit (answered /
 * voicemail / missed). The tray `call:<session>` entry is cancelled by tag in
 * [LoonextMessagingService] (data-only FCM carries no collapse key, so the
 * client-side cancel is the ONLY dismissal mechanism); this handler brings the
 * IN-APP surfaces (banner, ringer, CallStyle notification) down. It NEVER
 * touches telecom or the SDK leg — the server sends the BYE.
 */
fun interface CallEndHandler {
    fun onCallEnd(content: PushContent)
}

/**
 * Process-wide wiring points the softphone claims at construction
 * ([com.loonext.android.telephony.SoftphoneManager]'s init installs BOTH —
 * calls-v3 §10.2's single-handler rule: nothing else overwrites them).
 * While [callWakeHandler] is null (softphone not built/wired yet), call pushes
 * fall back to a high-importance ringing notification with the `/calls?call=…`
 * deep link — never silently dropped. A null [callEndHandler] just means the
 * in-app dismissal is skipped; the tray cancel-by-tag runs regardless.
 */
object PushHooks {
    @Volatile
    var callWakeHandler: CallWakeHandler? = null

    @Volatile
    var callEndHandler: CallEndHandler? = null
}
