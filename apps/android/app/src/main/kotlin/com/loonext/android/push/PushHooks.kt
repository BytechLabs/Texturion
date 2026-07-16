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
 * Process-wide wiring point the integrator sets at app start
 * (`PushHooks.callWakeHandler = softphoneManager::onIncomingCallPush`).
 * While null (softphone not built/wired yet), call pushes fall back to a
 * high-importance ringing notification with the `/calls?call=…` deep link —
 * never silently dropped.
 */
object PushHooks {
    @Volatile
    var callWakeHandler: CallWakeHandler? = null
}
