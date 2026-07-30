package com.loonext.android.features.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
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

    data class Ready(val me: Me, val companyId: String) : RootState

    data class Failed(val message: String) : RootState
}

class RootViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow<RootState>(RootState.Loading)
    val state: StateFlow<RootState> = _state

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
     */
    private suspend fun reconnectRealtime() {
        val ready = _state.value as? RootState.Ready ?: return
        val refreshed = runCatching { graph.meRepo.me(ready.companyId) }.getOrNull() ?: return
        val session = graph.sessionStore.session.first() ?: return
        graph.realtime.connect(
            ready.companyId,
            session.accessToken,
            refreshed.company?.numbers?.map { it.id }.orEmpty(),
        )
        // The screens read the number list off this same `me` (the dial-from
        // picker, the composer's From), so a member who just lost a number stops
        // being offered it here rather than on their next app launch.
        _state.value = RootState.Ready(refreshed, ready.companyId)
    }

    private suspend fun bootstrap() {
        try {
            val me = graph.meRepo.me()
            if (me.memberships.isEmpty()) {
                _state.value = RootState.NeedsWorkspace(me)
                return
            }
            val stored = graph.prefs.currentCompanyId()
            val membership = me.memberships.firstOrNull { it.company_id == stored }
                ?: me.memberships.first()
            graph.prefs.setActiveCompany(membership.company_id)

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
            val hydrated = runCatching { graph.meRepo.me(membership.company_id) }
                .getOrNull() ?: me

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
            val realtimeAllowed = hydrated.flags["kill:realtime"] != false
            val session = graph.sessionStore.session.first()
            if (session != null && realtimeAllowed) {
                graph.realtime.connect(
                    membership.company_id,
                    session.accessToken,
                    // Empty is a real state, not a failure: a member restricted
                    // out of every number joins the company topic and nothing
                    // else, and everything company-wide still reaches them.
                    hydrated.company?.numbers?.map { it.id }.orEmpty(),
                )
            }
            _state.value = RootState.Ready(hydrated, membership.company_id)
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.UNAUTHORIZED) {
                _state.value = RootState.SignedOut
            } else {
                _state.value = RootState.Failed(cause.message)
            }
        } catch (cause: Exception) {
            _state.value = RootState.Failed("Couldn't load your workspace.")
        }
    }
}
