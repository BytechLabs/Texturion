package com.loonext.android.features.thread

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.net.ApiDecodeException
import com.loonext.android.features.payments.PaymentsRepository
import com.loonext.android.features.settings.formatMoney
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #224 — both halves of text-to-pay as the thread sees them, and the one place
 * that talks to the API about either.
 *
 * The strip and the ask are separate composables because they are separate
 * ideas — one reports, one acts — but they share a fetch and a refresh, and
 * splitting that would mean two clients of the same two endpoints disagreeing
 * about when to re-read them. This is the seam: reads, mutations and refresh
 * live here; the two composables below it are layout.
 *
 * ## Two reads, two lifetimes
 *
 * The ACCOUNT belongs to the workspace, is the same answer on every thread, and
 * costs a live Stripe call on the server — so it is cached per company and
 * shared with the settings card. The REQUESTS belong to one conversation and
 * change when a customer pays, which is a webhook nobody here initiated.
 *
 * ## What refreshes this, and what honestly does not
 *
 * A payment landing produces NO realtime event, and that is worth stating
 * because docs/TEXT-TO-PAY.md reads as though it does. `stripe-connect.ts`
 * inserts a `conversation_event`, and the broadcast triggers in
 * supabase/migrations/20260701000400_triggers.sql fire on messages,
 * conversations, numbers and registrations — not on that table.
 *
 * So the triggers here are: opening the thread, our own mutations, and coming
 * back to the app after a real absence. That is the same set the web client
 * has, and saying so beats leaving somebody to discover it: a crew watching
 * this strip for a payment sees it on their next return to the app, not the
 * instant the card clears.
 */
@Composable
fun ThreadPayments(
    graph: AppGraph,
    companyId: String,
    conversationId: String,
    /** The workspace's name, for the SMS preview. Null while it is still loading. */
    businessName: String?,
    /**
     * May this reader act on the thread? #315's view-only observer reads the
     * strip and is offered nothing — the same split web draws on the spam
     * banner with `canAct`, and the same one this client's composer already
     * draws by rendering nothing but the banner for that role.
     */
    canAct: Boolean,
    /** Snackbar. Carries the API's own words on a refusal, never a paraphrase. */
    onNotice: (String) -> Unit,
    /**
     * A request went out as an ordinary text, so the transcript has a message
     * the timeline does not know about yet.
     */
    onSent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { PaymentsRepository(graph.api) }
    val coroutines = rememberCoroutineScope()
    var accountRefresh by remember(companyId) { mutableIntStateOf(0) }
    var requestsRefresh by remember(conversationId) { mutableIntStateOf(0) }
    var cancellingId by remember(conversationId) { mutableStateOf<String?>(null) }

    ResyncOnResume(conversationId) {
        accountRefresh++
        requestsRefresh++
    }

    val accountState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.payoutAccount(companyId),
        refreshKey = accountRefresh,
        // #315: the observer holds neither `conversations.send` nor
        // `billing.manage`, and `GET /v1/payments/account` requires one of them
        // — so for that role this is a guaranteed 403 on every thread open. Not
        // asked rather than asked-and-refused: a wasted round trip per thread
        // for the role that reads the most of them, and a diagnostics log full
        // of a refusal nobody can act on.
        //
        // The strip below still renders for them from cache when a request
        // exists; what they never get is the ask or the cancel.
        enabled = canAct,
    ) { repo.account(companyId) }
    val account = (accountState as? LoadState.Ready)?.value

    val requestsState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.paymentRequests(companyId, conversationId),
        refreshKey = requestsRefresh,
        // A workspace with no connected account cannot have a payment request:
        // the route that creates one refuses without it. So this is not an
        // optimisation guess, it is an invariant — and honouring it means the
        // overwhelming majority of workspaces, which will never use this
        // feature, do not pay a request per thread they open.
        enabled = account?.connected == true,
    ) { repo.requests(companyId, conversationId) }

    val rows = paymentRowsToShow(
        (requestsState as? LoadState.Ready)?.value?.payment_requests ?: emptyList(),
    )

    val cancel: (String) -> Unit = { id ->
        cancellingId = id
        coroutines.launch {
            try {
                repo.cancelRequest(companyId, id)
                onNotice(CALLED_OFF)
            } catch (cause: ApiDecodeException) {
                // The cancel LANDED — only our model of the row it answered
                // with disagreed. Reporting a failure here would leave a
                // cancelled request on screen looking live, and invite a
                // second tap on a link that is already dead.
                onNotice(CALLED_OFF)
            } catch (cause: Exception) {
                // Still live. The API's own words, because a refusal here is
                // usually a RULE — already paid, refund it from Stripe instead
                // — and "couldn't cancel" would read as the button being
                // broken rather than the rule working.
                onNotice(cause.userMessage())
            } finally {
                cancellingId = null
                requestsRefresh++
            }
        }
    }

    // A failed read draws NOTHING rather than an error. This sits above a
    // composer somebody opened to answer a customer, and a red bar about a
    // feature they are not using would be the loudest thing on the screen.
    Column(modifier) {
        PaymentStrip(
            rows = rows,
            cancellingId = cancellingId,
            // An observer reads the money and is offered no way to move it.
            onCancel = cancel.takeIf { canAct },
        )

        if (canAct) {
            AskForPayment(
                account = account,
                businessName = businessName,
                onAsk = { ask ->
                    try {
                        repo.createRequest(
                            companyId = companyId,
                            conversationId = conversationId,
                            amountCents = ask.amountCents,
                            description = ask.description,
                            idempotencyKey = ask.idempotencyKey,
                        )
                        onNotice("Asked for ${formatMoney(ask.amountCents, ask.currency)}.")
                        requestsRefresh++
                        onSent()
                        true
                    } catch (cause: ApiDecodeException) {
                        // The request EXISTS and the customer already has the
                        // text. Treating a decode mismatch as a failure would
                        // leave the form open with the amount still in it,
                        // which is how somebody bills a customer twice for one
                        // deposit.
                        requestsRefresh++
                        onSent()
                        true
                    } catch (cause: Exception) {
                        onNotice(cause.userMessage())
                        false
                    }
                },
            )
        }
    }
}

/** Said in both places a cancel can land, so the two cannot drift apart. */
private const val CALLED_OFF = "Called off. You can ask again any time."
