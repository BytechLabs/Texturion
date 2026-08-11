package com.loonext.android.features.shell

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.UiLocale
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.settings.SettingsRepository
import com.loonext.android.core.realtime.RealtimeLifecycle
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Mirrors the web's CompanyProvider bootstrap: session → GET /v1/me →
 * resolve active company (persisted pick or first membership) → route.
 */
sealed interface RootState {
    data object Loading : RootState
    data object SignedOut : RootState

    /** Signed in, zero memberships — workspace creation lives on web (checkout). */
    data class NeedsWorkspace(val me: Me) : RootState

    /** Owner/admin with subscription_status incomplete — finish checkout on web. */
    data class NeedsCheckout(val me: Me, val companyId: String) : RootState

    /**
     * #496/#314: this session has not satisfied two-factor. `enrolmentRequired`
     * tells the gate which question to ask — a code from somebody who has a
     * factor, or enrolment first for somebody the WORKSPACE is insisting on and
     * who has none.
     */
    data class NeedsMfa(val enrolmentRequired: Boolean) : RootState

    data class Ready(val me: Me, val companyId: String) : RootState

    data class Failed(val message: String) : RootState
}

/**
 * #483: the waits before each retry of a bootstrap number list that failed.
 *
 * The hydrated `/v1/me` is the ONLY source of the access-filtered number list,
 * and when it fails [RootViewModel] hands realtime an empty one — the member
 * holds the company topic and not a single per-number topic. The reconnect
 * collector heals that on the next re-JOIN, which on a healthy socket can be
 * hours away, and since #484's contract step those are hours of an inbox that
 * never updates. Three tries across ~17s turn one transient 5xx into a
 * blink; going longer would only race the re-JOIN heal that already exists.
 */
internal val NUMBER_LIST_RETRY_DELAYS_MS = listOf(1_000L, 4_000L, 12_000L)

/**
 * Run [attempt] after each wait in [NUMBER_LIST_RETRY_DELAYS_MS] until one
 * reports success. Waits FIRST: the read that just failed fails the same way if
 * it is repeated in the same millisecond.
 */
internal suspend fun retryNumberList(attempt: suspend () -> Boolean): Boolean {
    for (delayMs in NUMBER_LIST_RETRY_DELAYS_MS) {
        delay(delayMs)
        if (attempt()) return true
    }
    return false
}

class RootViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow<RootState>(RootState.Loading)
    val state: StateFlow<RootState> = _state

    /** #483: the in-flight [retryNumberList], so bootstraps cannot stack them. */
    private var numberListRetry: Job? = null

    /**
     * #289: the pending background drop, so a quick app-switch cancels it
     * rather than stacking a second one behind it.
     */
    private var realtimeDrop: Job? = null

    /**
     * #289: whether the socket is down because the app is backgrounded, as
     * opposed to never having been up.
     *
     * Needed because ON_START fires on every return to the app, and reconnecting
     * a socket that is already connected would tear down a live one for nothing.
     */
    private var droppedForBackground = false

    init {
        // Session appearing/disappearing drives everything.
        viewModelScope.launch {
            graph.sessionStore.session.collect { session ->
                if (session == null) {
                    graph.realtime.disconnect()
                    _state.value = RootState.SignedOut
                } else if (_state.value is RootState.SignedOut ||
                    _state.value is RootState.Loading
                ) {
                    bootstrap()
                }
            }
        }
        // #289: the socket a backgrounded phone should not be holding.
        //
        // Both apps connected on sign-in and disconnected on sign-out, so a
        // phone in a pocket kept a WebSocket alive and sent a heartbeat every
        // 25 seconds all day. The bytes are nothing; the RADIO is the cost —
        // on LTE each transmission holds the modem in a high-power state for
        // seconds afterwards, so a packet every 25 seconds never lets it sleep.
        //
        // Nothing is lost by dropping it: push carries every message, task and
        // — the unforgivable one — every incoming call, which is woken through
        // PushHooks.callWakeHandler and never by a socket frame.
        watchAppVisibility()

        // A dead refresh token anywhere lands back on login.
        viewModelScope.launch {
            graph.api.signedOut.collect {
                graph.realtime.disconnect()
                _state.value = RootState.SignedOut
            }
        }
        // #480: somebody's number access changed in this company. Which numbers
        // this member may see is a SERVER answer and it may just have changed, so
        // ask again and move the per-number subscriptions with it.
        //
        // Re-subscribing is the part a plain refetch cannot do. Realtime
        // authorization is a join-time handshake (D88 addendum), so a member who
        // just lost a number stays joined to its topic and keeps receiving its
        // events until their JWT refreshes — up to an hour of a boundary the
        // product believes it is enforcing. The event names only the company, so
        // a client cannot tell whether it was the subject; it just asks again.
        viewModelScope.launch {
            graph.realtime.events.collect { event ->
                // LAUNCHED, not awaited. reconnectRealtime() makes two network
                // calls, and this collector shares one MutableSharedFlow whose
                // overflow policy is SUSPEND at 64 buffered frames: the single
                // dispatch pump stalls once the SLOWEST collector falls behind,
                // which would starve every other collector in the app — inbox,
                // thread, calls, tasks, notifications — of every frame while this
                // one waited on /v1/me behind a captive portal.
                if (event.event == "access.changed") {
                    viewModelScope.launch { reconnectRealtime() }
                }
            }
        }

        // #480: broadcasts are NOT replayed. An access.changed published while
        // this app was backgrounded or out of signal is gone, so on reconnect we
        // would re-join exactly the pre-gap topic set — a number granted during
        // the outage would have no realtime for the rest of the process lifetime,
        // with the socket reporting Joined the whole time.
        //
        // Re-deriving on every re-JOIN is the heal. It also covers a number list
        // that failed to load at bootstrap, which otherwise left the member with
        // no per-number subscriptions at all until the app was killed.
        //
        // AWAITED inside the callback, unlike the `access.changed` collector
        // above, which cannot be. Two round trips in here no longer cost anyone an
        // edge: `reconnected`'s overflow policy is DROP_OLDEST (#483), so a signal
        // arriving while this works replaces the pending one and is delivered when
        // it returns, and the eleven screen collectors are handed it meanwhile.
        // Launching per signal would instead put two /v1/me-then-connect passes in
        // flight at once, and the loser of that race hands the realtime client the
        // OLDER number list — leaving a revoked number joined, or a granted one
        // unjoined, until some later signal. Serial and one behind beats parallel
        // and wrong.
        viewModelScope.launch {
            graph.realtime.reconnected.collect { reconnectRealtime() }
        }
    }

    fun retry() {
        _state.value = RootState.Loading
        viewModelScope.launch { bootstrap() }
    }

    fun switchWorkspace(companyId: String) {
        viewModelScope.launch {
            graph.prefs.setActiveCompany(companyId)
            bootstrap()
        }
    }

    fun signOut() {
        viewModelScope.launch {
            // Drop the device push token while the bearer still works —
            // best-effort; a dead token also self-prunes server-side (#151).
            runCatching { graph.pushRegistrar.unregister() }
            // Revoke the session SERVER-side, in the same "while the bearer still
            // works" slot and for a sharper reason. `AuthManager.signOut` ends the
            // GoTrue session and nothing else, so `user_sessions.revoked_at` stayed
            // null and the softphone credential was never swept — and because
            // authorization is `revoked_at is null`, the access token this phone is
            // holding kept full read and send for the rest of its life after
            // somebody pressed Sign out.
            //
            // Best-effort, like the line above and for the same reason: nobody may
            // be trapped in an account because the network blipped on the way out.
            // The cost of a failure is that the token expires on its own instead of
            // being cut short, which is the state we were in for every sign-out.
            runCatching { SettingsRepository(graph.api).revokeThisSession() }
            graph.authManager.signOut()
        }
    }

    /**
     * Re-derive the visible numbers and hand the new set to the realtime client,
     * which joins what was added and LEAVES what was taken away.
     *
     * Silent on failure by design: this runs off a broadcast, not off something
     * the member did, so a failed read must leave the shell exactly as it was.
     * The subscriptions are then a moment stale until the next reconnect, and a
     * topic we no longer have access to is refused when we next try to join it.
     *
     * Reports whether the list actually moved, which is what [retryNumberList]
     * needs to know when it is standing in for a bootstrap read that failed
     * (#483). The two collectors above discard it: they fire off a signal that
     * will come again, so there is nothing for them to do about a `false`.
     */
    /**
     * #289: drop the socket when the phone goes in a pocket; bring it back when
     * somebody looks at the app.
     *
     * The grace window is what makes this safe to do at all — see
     * [RealtimeLifecycle.BACKGROUND_GRACE_MS]. A live call holds the socket
     * regardless: call state rides realtime, and a call is exactly when the
     * phone is out and being used.
     */
    private fun watchAppVisibility() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        realtimeDrop?.cancel()
                        realtimeDrop = null
                        if (droppedForBackground) {
                            droppedForBackground = false
                            // Not `connect` directly: the token may have expired
                            // while the app was away, and the number list may
                            // have changed. This is the same path the #480
                            // access-change signal uses.
                            viewModelScope.launch { reconnectRealtime() }
                        }
                    }

                    Lifecycle.Event.ON_STOP -> {
                        realtimeDrop?.cancel()
                        realtimeDrop = viewModelScope.launch {
                            val wait = RealtimeLifecycle.dropDelayMs(
                                foreground = false,
                                backgroundedForMs = 0,
                                callActive = graph.callActive(),
                            ) ?: return@launch
                            delay(wait)
                            // Asked again after the wait: a call can start
                            // inside the grace window (a push wakes the app,
                            // rings, and the person answers from the lock
                            // screen without the app ever coming forward).
                            if (graph.callActive()) return@launch
                            droppedForBackground = true
                            graph.realtime.disconnect()
                        }
                    }

                    else -> Unit
                }
            },
        )
    }

    private suspend fun reconnectRealtime(): Boolean {
        val ready = _state.value as? RootState.Ready ?: return false
        val refreshed = runCatching { graph.meRepo.me(ready.companyId) }.getOrNull() ?: return false
        // #228: this runs on every return to the foreground, so it is where a
        // language changed on the laptop reaches the phone.
        graph.prefs.setUiLocale(refreshed.locale)
        graph.prefs.setWorkspaceLocale(
            refreshed.memberships.firstOrNull { it.company_id == ready.companyId }?.locale,
        )
        val session = graph.sessionStore.session.first() ?: return false
        graph.realtime.connect(
            ready.companyId,
            session.accessToken,
            refreshed.company?.numbers?.map { it.id }.orEmpty(),
            // #302: the presence key. Nothing else on this socket says anything
            // about who the viewer is.
            userId = refreshed.user_id,
        )
        // The screens read the number list off this same `me` (the dial-from
        // picker, the composer's From), so a member who just lost a number stops
        // being offered it here rather than on their next app launch.
        _state.value = RootState.Ready(refreshed, ready.companyId)
        return true
    }

    private suspend fun bootstrap() {
        try {
            val me = graph.meRepo.me()
            // #228: the server has just answered the first two thirds of "what
            // language is this app in", so write both down before anything else
            // uses them. The mirror is what makes the NEXT cold start paint in
            // the right language on its first frame instead of flashing English
            // at a French crew while this call is in flight.
            graph.prefs.setUiLocale(me.locale)
            if (me.memberships.isEmpty()) {
                _state.value = RootState.NeedsWorkspace(me)
                return
            }
            val stored = graph.prefs.currentCompanyId()
            val membership = me.memberships.firstOrNull { it.company_id == stored }
                ?: me.memberships.first()
            graph.prefs.setActiveCompany(membership.company_id)
            // The WORKSPACE half, and it has to wait for the line above: which
            // company's language matters is a question the active membership
            // answers, and somebody in two workspaces has two answers.
            graph.prefs.setWorkspaceLocale(membership.locale)

            val incomplete = membership.subscription_status == SubscriptionStatus.INCOMPLETE ||
                membership.subscription_status == SubscriptionStatus.INCOMPLETE_EXPIRED
            if (incomplete && MemberRole.atLeast(membership.role, MemberRole.ADMIN)) {
                _state.value = RootState.NeedsCheckout(me, membership.company_id)
                return
            }

            // The access-filtered number list and the client flags exist ONLY on
            // the hydrated /v1/me — the one that carries X-Company-Id. The call
            // above cannot ask for either: it is what discovers which company to
            // ask about.
            //
            // Two things ride on this second read. #480: the per-number realtime
            // topics must be joined for exactly the numbers this member may see,
            // and the server is the only thing that knows which those are
            // (`loadCompanyView` filters them, and re-deriving the rule here
            // would be a second implementation of D88). And #283's realtime kill
            // switch, which has never actually worked on Android: the route
            // populates `flags` only when hydrating, so the unhydrated `me()`
            // always reported an empty map, which reads as ON.
            //
            // Best-effort, because a failed hydration must not cost the shell.
            // Without it the member joins the company topic alone, which for the
            // length of D88's dual-publish transition still carries every event.
            // Kept as a nullable rather than folded into `view`, because whether
            // it failed is what decides the #483 retry at the bottom.
            //
            // #314/#496: WHY the failure code is kept and not just the null. A
            // refused hydration and a failed one look identical from a null, and
            // one of them is a wall this app is supposed to render a way through
            // rather than shrug at.
            val hydration = runCatching { graph.meRepo.me(membership.company_id) }
            val hydrated = hydration.getOrNull()
            val refusal = (hydration.exceptionOrNull() as? ApiException)?.code
            val view = hydrated ?: me

            // Connect realtime for the active workspace.
            //
            // #283: unless the realtime kill switch is off. This is the one
            // switch the server cannot enforce — the app holds its own Supabase
            // token and opens its own socket, so there is nothing for the
            // Worker to refuse. Not connecting leaves the app on its normal
            // refresh path: slower, never wrong.
            //
            // `!= false` rather than a truthiness check: an absent flag means
            // "no statement", which must read as ON.
            val realtimeAllowed = view.flags["kill:realtime"] != false
            val session = graph.sessionStore.session.first()
            if (session != null && realtimeAllowed) {
                graph.realtime.connect(
                    membership.company_id,
                    session.accessToken,
                    // Empty is a real state when the read SUCCEEDED: a member
                    // restricted out of every number joins the company topic and
                    // nothing else, and everything company-wide still reaches
                    // them. It is a failure when it came from the unhydrated `me`,
                    // whose `company` is always null — hence the retry below.
                    view.company?.numbers?.map { it.id }.orEmpty(),
                    userId = view.user_id, // #302: the presence key
                )
            }
            // #496/#314: two-factor, which the server has just answered about
            // in the only two ways it can.
            //
            // The CHALLENGE case is asked positively rather than read off the
            // refusal, because there is a window where the server is not
            // refusing yet — a Worker deployed ahead of the migration reports no
            // enrolment — and the app should still ask. /v1/mfa is
            // company-exempt, so it answers even for a session every other route
            // is refusing, which is exactly the session that needs the answer.
            if (refusal == ApiErrorCode.MFA_CHALLENGE_REQUIRED) {
                _state.value = RootState.NeedsMfa(enrolmentRequired = false)
                return
            }
            if (refusal == ApiErrorCode.MFA_REQUIRED) {
                _state.value = RootState.NeedsMfa(enrolmentRequired = true)
                return
            }
            val mfa = runCatching { graph.settingsRepo.mfa() }.getOrNull()
            if (mfa != null && mfa.enrolled && mfa.aal != "aal2") {
                _state.value = RootState.NeedsMfa(enrolmentRequired = false)
                return
            }

            _state.value = RootState.Ready(view, membership.company_id)

            // #483: one transient 5xx on the hydrated read must not cost a whole
            // session of per-number realtime. Retried OFF the bootstrap path —
            // the shell is already Ready above, so nothing here is waited on —
            // and through [reconnectRealtime], which is exactly the same work the
            // `access.changed` and reconnect collectors do.
            //
            // A retry still pending from an earlier bootstrap is stale whatever
            // happened here: this pass has just read for the company it would
            // read for.
            numberListRetry?.cancel()
            numberListRetry = if (hydrated == null) {
                viewModelScope.launch { retryNumberList { reconnectRealtime() } }
            } else {
                null
            }
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.UNAUTHORIZED) {
                _state.value = RootState.SignedOut
            } else {
                _state.value = RootState.Failed(cause.message)
            }
        } catch (cause: Exception) {
            _state.value = RootState.Failed(
                AppStrings.translate(uiLocale(), "shell.bootstrapFailed"),
            )
        }
    }

    /**
     * #228: the reader's language, for the one sentence on this path that is
     * OURS.
     *
     * Every other [RootState.Failed] above carries `cause.message` — the API's
     * own words, which are the API's to translate; a client-side catalogue entry
     * for a server refusal would be a second copy that drifts. This one is the
     * catch-all we wrote, and there is no composition here to read a locale from,
     * so it is resolved the same way the Compose root resolves it: the mirror
     * this class itself keeps up to date, then the device, then the workspace.
     */
    private suspend fun uiLocale(): String = UiLocale.resolve(
        graph.prefs.uiLocale.first(),
        UiLocale.deviceTag(),
        graph.prefs.workspaceLocale.first(),
    )
}
