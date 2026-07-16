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
        viewModelScope.launch { graph.authManager.signOut() }
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

            // Connect realtime for the active workspace.
            val session = graph.sessionStore.session.first()
            if (session != null) {
                graph.realtime.connect(membership.company_id, session.accessToken)
            }
            _state.value = RootState.Ready(me, membership.company_id)
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
