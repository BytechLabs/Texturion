import Foundation

/// One realtime event off a company or per-number broadcast channel (SPEC §8).
/// Payloads are ID-only by design — consumers refetch the referenced resource
/// via the API.
struct RealtimeEvent: Sendable {
    let event: String
    let payload: JSONValue
}

/// Supabase Realtime private-broadcast client (Phoenix protocol over
/// URLSessionWebSocketTask) for the per-company channel `company:{id}` and, per
/// #480/D88, one `company:{id}:number:{n}` channel per number this member may
/// see. All of them ride ONE socket — Phoenix multiplexes channels by topic.
///
/// - Private channels: each join carries `access_token`; RLS on
///   realtime.messages authorizes it. The company topic admits every member;
///   the per-number topic is admitted only when `member_number_level` is not
///   'none', so a join for a number the member cannot see is REFUSED — that
///   refusal is the boundary working and must not disturb the other channels or
///   the transport. It is not final either: a refusal is indistinguishable here
///   from a join that raced a token refresh, so `repairNumberTopics` asks again,
///   once a minute, for whatever the server has not confirmed (#483). Token
///   refreshes are pushed per channel (see `pushAccessToken`) so the socket
///   survives JWT rotation.
/// - Reconnects with capped exponential backoff; each successful re-JOIN of the
///   COMPANY channel emits on `reconnected()` so callers refetch first pages
///   (payloads may have been lost while offline — the web client does exactly
///   this).
actor RealtimeClient {
    private let supabaseURL: URL
    private let publishableKey: String
    private let urlSession: URLSession

    private var socket: URLSessionWebSocketTask?
    private var connectLoop: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var numberTopicRepair: Task<Void, Never>?
    private var ref: UInt64 = 1
    private var companyId: String?

    /// #480: the numbers this member may see — one topic each. The list comes in
    /// from the caller ALREADY access-filtered by the server (GET /v1/numbers);
    /// deciding here which numbers are visible would be a second copy of the
    /// rule D88 spent an issue collapsing into one.
    private var numberIds: Set<String> = []

    /// The per-number topics a `phx_join` has been SENT for on the CURRENT
    /// socket and no `phx_leave` has gone out for — not necessarily accepted,
    /// since a refused join is a normal outcome. Kept apart from `numberIds`
    /// because that is what the reconcile has to diff against: diffing against
    /// the desired set would compute an empty delta and leave a revoked number's
    /// channel open.
    ///
    /// SENT, not intended: a send that failed must not move this set (see
    /// `topicsAfterSend`). It is also what `pushAccessToken` iterates, so a topic
    /// dropped from it stops being re-authorized as well as unsubscribed.
    private var joinedNumberTopics: Set<String> = []

    /// The per-number topics the SERVER has confirmed on the CURRENT socket — a
    /// `phx_reply` with status ok. Always a subset of `joinedNumberTopics`.
    ///
    /// Kept apart from it because "we sent a join" and "we are joined" are
    /// different facts, and only the second one means events are arriving. A
    /// refused join, a channel a realtime node closed while rebalancing, and a
    /// join whose reply never came all leave the first true and the second false,
    /// and each of them is a number whose `message.created`,
    /// `conversation.updated`, `message.status`, `task.changed`,
    /// `read.conversation` and `call.updated` stop — on a socket that reports
    /// perfect health. `repairNumberTopics` diffs against THIS set, and it is the
    /// only thing that asks again: the reconcile in `setNumbers` cannot, because
    /// the wanted set has not changed.
    ///
    /// Reset by `joinFrames`: a new socket has confirmed nothing.
    private var confirmedNumberTopics: Set<String> = []

    private var accessToken: String?
    private var everJoined = false
    private var joined = false

    private var eventObservers: [UUID: AsyncStream<RealtimeEvent>.Continuation] = [:]
    private var reconnectObservers: [UUID: AsyncStream<Void>.Continuation] = [:]

    init(
        supabaseURL: URL = AppConfig.supabaseURL,
        publishableKey: String = AppConfig.supabasePublishableKey
    ) {
        self.supabaseURL = supabaseURL
        self.publishableKey = publishableKey
        self.urlSession = URLSession(configuration: .default)
    }

    // MARK: - Streams (multicast: every call returns an independent stream)

    /// Broadcast events off every joined channel — the company one and each
    /// number's (#480). One stream, because a consumer refetches by id and does
    /// not care which channel carried the hint.
    ///
    /// Buffering is `.unbounded` (#215): realtime payloads are ID-only routing
    /// hints and every one MUST reach its consumer, because a screen refetches
    /// the referenced resource per event. `.bufferingNewest` silently DROPS the
    /// oldest frame under backpressure (a slow/suspended consumer), which is
    /// exactly how an inbound message went missing until a full re-JOIN or
    /// navigation. Unbounded keeps every frame; the payloads are tiny and each
    /// consumer drains promptly, so the buffer never grows in practice.
    func events() -> AsyncStream<RealtimeEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<RealtimeEvent>.makeStream(
            bufferingPolicy: .unbounded
        )
        eventObservers[id] = continuation
        continuation.onTermination = { _ in
            Task { await self.removeEventObserver(id) }
        }
        return stream
    }

    /// Fires on every re-JOIN after the first — refetch first pages.
    func reconnected() -> AsyncStream<Void> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(
            bufferingPolicy: .bufferingNewest(1)
        )
        reconnectObservers[id] = continuation
        continuation.onTermination = { _ in
            Task { await self.removeReconnectObserver(id) }
        }
        return stream
    }

    private func removeEventObserver(_ id: UUID) {
        eventObservers.removeValue(forKey: id)
    }

    private func removeReconnectObserver(_ id: UUID) {
        reconnectObservers.removeValue(forKey: id)
    }

    /// Fan one event out to every live observer — the exact broadcast path the
    /// socket drives through `handle`. Extracted (internal) so the losslessness
    /// contract (#215) is unit-testable without standing up a websocket.
    func deliver(_ event: RealtimeEvent) {
        for continuation in eventObservers.values { continuation.yield(event) }
    }

    // MARK: - Lifecycle

    /// Connect (or switch) to a company channel plus one channel per visible
    /// number (`numberIds`, access-filtered by the server). Safe to call
    /// repeatedly.
    func connect(companyId: String, numberIds: [String], accessToken: String) {
        let sameChannel = self.companyId == companyId
        self.companyId = companyId
        self.accessToken = accessToken
        if sameChannel && connectLoop != nil {
            pushAccessToken()
            // Already up: move the number channels on the live socket rather
            // than tearing it down (see setNumbers).
            setNumbers(numberIds)
            return
        }
        self.numberIds = Set(numberIds)
        everJoined = false
        restart()
    }

    /// Replace the set of numbers whose channels this client holds.
    ///
    /// #480: realtime authorization is a JOIN-TIME handshake — the topic policy
    /// is evaluated on `phx_join` and on a pushed token, never per broadcast — so
    /// nothing drops a revoked member's subscription except leaving the channel.
    /// `access.changed` is what tells the app to re-derive and land here.
    ///
    /// Unchanged set, nothing happens: one access edit rewrites several rules and
    /// fires `access.changed` once per row, so anything heavier than a diff would
    /// turn one edit into a burst. Diffing also leaves the company channel
    /// untouched, which keeps `reconnected()` meaning "you had a gap" rather than
    /// "access changed".
    ///
    /// Which is also why this is the wrong place to notice a channel that was
    /// LOST rather than revoked: access did not change, so the wanted set is
    /// identical and there is nothing here to diff. `repairNumberTopics` is what
    /// covers that (#483).
    func setNumbers(_ numberIds: [String]) {
        let wanted = Set(numberIds)
        guard wanted != self.numberIds else { return }
        self.numberIds = wanted
        reconcileNumberTopics()
    }

    /// Push a refreshed JWT into the live channel (call on every refresh).
    func setAuth(_ accessToken: String) {
        self.accessToken = accessToken
        pushAccessToken()
    }

    func disconnect() {
        companyId = nil
        numberIds = []
        joinedNumberTopics = []
        confirmedNumberTopics = []
        connectLoop?.cancel()
        connectLoop = nil
        heartbeat?.cancel()
        heartbeat = nil
        numberTopicRepair?.cancel()
        numberTopicRepair = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        joined = false
    }

    private func restart() {
        connectLoop?.cancel()
        heartbeat?.cancel()
        heartbeat = nil
        numberTopicRepair?.cancel()
        numberTopicRepair = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connectLoop = Task { await self.runLoop() }
    }

    // MARK: - Connection loop

    private func runLoop() async {
        var attempt = 0
        while !Task.isCancelled, companyId != nil {
            joined = false
            await runSocket() // returns when the socket closes/fails
            if joined { attempt = 0 } // a successful JOIN resets the backoff
            joined = false
            if Task.isCancelled || companyId == nil { return }
            attempt += 1
            let backoffSeconds = min(30.0, Double(1 << min(attempt, 5)))
            try? await Task.sleep(for: .seconds(backoffSeconds))
        }
    }

    private func runSocket() async {
        guard let company = companyId, let url = websocketURL() else { return }
        let task = urlSession.webSocketTask(with: url)
        socket = task
        task.resume()
        do {
            for text in joinFrames(company) {
                try await task.send(.string(text))
            }
        } catch {
            // A failed JOIN send means the transport is gone. Cancel it rather
            // than abandon it: with the number channels there can now be a
            // socket whose company channel joined before a later send failed,
            // and an abandoned one would sit unread until the server idle-closed
            // it. `runLoop` backs off and opens a fresh one either way.
            task.cancel(with: .normalClosure, reason: nil)
            if socket === task { socket = nil }
            return
        }
        startHeartbeat(task)
        startNumberTopicRepair(task)
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                handle(message, on: task)
            } catch {
                break
            }
        }
        heartbeat?.cancel()
        heartbeat = nil
        numberTopicRepair?.cancel()
        numberTopicRepair = nil
        if socket === task { socket = nil }
    }

    private func startHeartbeat(_ task: URLSessionWebSocketTask) {
        heartbeat?.cancel()
        heartbeat = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                if Task.isCancelled { return }
                let text = self.frame(topic: "phoenix", event: "heartbeat", payload: .object([:]))
                try? await task.send(.string(text))
            }
        }
    }

    // MARK: - Frames

    /**
     A CHANNEL-level failure does not close the transport. The socket stays open,
     the 25s heartbeat keeps the server from idle-closing it, so `task.receive()`
     never throws, the receive loop never breaks, and `runSocket` never returns to
     the backoff that would reconnect. Realtime is then silently dead for the life
     of the process — no inbound messages, no call or task ticks.

     The trigger is ordinary: a reconnect rejoins with whatever token was last
     stashed, so an idle or offline stretch past the ~1h JWT lifetime draws a
     rejected join (or a server-side channel close). Cancelling the transport on a
     channel-level failure makes `receive()` throw, which hands control back to the
     EXISTING capped backoff. (Same defect and same fix as the Android client.)
     */
    private func handle(_ message: URLSessionWebSocketTask.Message,
                        on task: URLSessionWebSocketTask) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let raw): data = raw
        @unknown default: return
        }
        guard let msg = try? JSONDecoder().decode(JSONValue.self, from: data),
              let event = msg["event"]?.stringValue
        else { return }
        let payload = msg["payload"]
        let topic = msg["topic"]?.stringValue
        // Only the COMPANY channel's health governs the reconnect: heartbeat
        // replies ride topic "phoenix", and a per-number channel may legitimately
        // be refused or closed on its own.
        //
        // An EXACT match, not the prefix this used to be: a per-number topic
        // starts with the company topic, so the prefix check read a refused
        // per-number join — the intended answer once access is revoked — as a
        // rejected company join and cancelled the transport, turning one closed
        // channel into an endless reconnect.
        let isCompanyTopic = Self.isCompanyTopic(topic, company: companyId)

        switch event {
        case "phx_reply":
            let ok = payload?["status"]?.stringValue == "ok"
            if isCompanyTopic {
                if ok, !joined {
                    joined = true
                    if everJoined {
                        for continuation in reconnectObservers.values { continuation.yield(()) }
                    }
                    everJoined = true
                } else if !ok {
                    // A REJECTED join (expired JWT being the common case) was
                    // previously ignored outright, parking the loop forever.
                    task.cancel(with: .normalClosure, reason: nil)
                }
            } else if let topic {
                // A per-number reply used to be ignored outright. That was right
                // about the transport — a refusal means this member may not see
                // that number, which is the policy doing its job, and the other
                // channels and the socket have to survive it — and wrong about the
                // bookkeeping: the topic stayed claimed either way, so an accepted
                // join was never told apart from a refused one and the refused one
                // was never asked for again (#483).
                noteNumberTopicReply(topic, ok: ok)
            }

        case "broadcast":
            // Handled the same whichever topic it arrived on, and deliberately
            // not de-duplicated. Since #484's contract step each event arrives
            // exactly once — number-scoped ones on their number's topic,
            // company-wide ones on the company topic. Even a repeat would be
            // harmless: every consumer of `events()` is an id-only refetch
            // trigger, so it costs one redundant refetch, while a seen-set would
            // be new state to get wrong AND would have to carve out
            // `call.updated` for a call whose number was deleted — that one has
            // no per-number topic at all and can only arrive on the company one.
            guard let name = payload?["event"]?.stringValue else { return }
            let inner: JSONValue
            if let raw = payload?["payload"], raw.objectValue != nil {
                inner = raw
            } else {
                inner = .object([:])
            }
            // #480: number access changed somewhere in this company. The payload
            // names only the company — naming the number or the member would
            // broadcast the shape of the restriction to everyone on the topic —
            // so a client cannot tell whether it was the subject and simply
            // refetches.
            //
            // Reusing the reconnect signal rather than adding a second one:
            // every screen already treats it as "your cached pages may be wrong,
            // ask again", which is exactly what a change of access means. Sent IN
            // ADDITION to the event itself, so a future consumer that wants the
            // event can still have it.
            if name == "access.changed" {
                for continuation in reconnectObservers.values { continuation.yield(()) }
            }
            deliver(RealtimeEvent(event: name, payload: inner))

        case "phx_close", "phx_error":
            // NOT a transport close (see the docblock): without this the socket
            // lives on, heartbeating, while the channel is dead. Scoped to the
            // company channel — a per-number channel the server closes because
            // access went away must cost that one channel, not realtime.
            if isCompanyTopic {
                task.cancel(with: .normalClosure, reason: nil)
            } else if let topic {
                // And that one channel has to be ASKED FOR AGAIN, because a close
                // is not only a revocation: a realtime node closes channels while
                // it rebalances, and a token it will not take closes them too.
                // Recording the loss is what lets the once-a-minute sweep find it —
                // the wanted set is unchanged, so nothing else ever would (#483).
                noteNumberTopicLost(topic)
            }

        default:
            break
        }
    }

    // MARK: - Topics
    //
    // The names must match `broadcast_number_scoped`
    // (supabase/migrations/20260730040000_number_scoped_topics.sql) exactly: the
    // server sends to `company:{id}` and `company:{id}:number:{n}`, and Phoenix
    // prefixes the channel name with `realtime:`.

    /// `realtime:company:{id}` — every member of the company may join it.
    static func companyTopic(_ company: String) -> String {
        "realtime:company:\(company)"
    }

    /// `realtime:company:{id}:number:{n}` — admitted by `is_company_topic_member`
    /// only when `member_number_level` is not 'none' (D88).
    static func numberTopic(_ company: String, _ number: String) -> String {
        "realtime:company:\(company):number:\(number)"
    }

    /// True only for the company channel itself. See `handle` for why this cannot
    /// be a prefix test.
    static func isCompanyTopic(_ topic: String?, company: String?) -> Bool {
        guard let topic, let company else { return false }
        return topic == companyTopic(company)
    }

    /// The channels to leave and to join to get from `have` to `want`. Sorted, so
    /// a reconcile emits the same frames in the same order every time.
    static func topicDelta(
        have: Set<String>,
        want: Set<String>
    ) -> (join: [String], leave: [String]) {
        (join: want.subtracting(have).sorted(), leave: have.subtracting(want).sorted())
    }

    /// `have` after a reconcile frame for `topic` either reached the socket or did
    /// not. This is a function of the SEND RESULT rather than an assignment of the
    /// desired set, which is what it replaces.
    ///
    /// A `phx_leave` that failed to send has left nothing: the channel is still
    /// joined, and the server authorizes a channel on `phx_join` and on a pushed
    /// token but never per broadcast (D88), so it keeps publishing that number's
    /// events. Keeping the topic held is what keeps `pushAccessToken` re-running
    /// the topic policy against that channel — the only other thing that makes the
    /// server drop it. Recording the leave as done instead loses both the retry
    /// and the token push, and the member goes on receiving events for a number
    /// they may no longer see until the socket happens to drop.
    ///
    /// A `phx_join` that failed to send joined nothing, so it must not be held:
    /// claiming it would put a topic this socket never joined into every token
    /// push, and would keep the next reconcile from asking for it again.
    static func topicsAfterSend(
        _ have: Set<String>,
        topic: String,
        leaving: Bool,
        sent: Bool
    ) -> Set<String> {
        var next = have
        let held = leaving ? !sent : sent
        if held { next.insert(topic) } else { next.remove(topic) }
        return next
    }

    /// What the server said about ONE per-number channel: `ok` confirms the join,
    /// anything else means we hold nothing there.
    ///
    /// Only a topic this socket still HOLDS can be confirmed. The `phx_reply` to a
    /// `phx_leave` is an ok on that same topic and the channel it acknowledges has
    /// just ended, so reading it as a confirmed join would leave a confirmation
    /// behind for a channel nobody is on — and if that number were granted back and
    /// its join frame failed, the sweep would never ask for it. The same rule is
    /// what keeps the company channel and the heartbeat's "phoenix" replies out of
    /// this bookkeeping entirely: neither is ever in the held set.
    ///
    /// Internal, and free of any socket, so the accounting can be asserted without
    /// standing one up — the same reason `joinFrames` and `deliver` are.
    func noteNumberTopicReply(_ topic: String, ok: Bool) {
        guard joinedNumberTopics.contains(topic) else { return }
        if ok {
            confirmedNumberTopics.insert(topic)
        } else {
            noteNumberTopicLost(topic)
        }
    }

    /// This per-number channel is gone — refused, closed, or errored. The
    /// transport is fine and the other channels are untouched.
    ///
    /// Dropped from the HELD set as well as the confirmed one, because there is no
    /// channel there any more: keeping it would push refreshed tokens at a topic
    /// the server does not have us on, and would make the next reconcile read a
    /// re-grant as a no-op. Nothing here is a revocation, so nothing here touches
    /// the WANTED set — which is why `numberTopicsToRejoin` still asks for it.
    func noteNumberTopicLost(_ topic: String) {
        guard joinedNumberTopics.contains(topic) else { return }
        joinedNumberTopics.remove(topic)
        confirmedNumberTopics.remove(topic)
    }

    /// The per-number channels this client should hold for `company`.
    private func numberTopics(_ company: String) -> Set<String> {
        Set(numberIds.map { Self.numberTopic(company, $0) })
    }

    /// The per-number channels to ask for again: wanted, and not confirmed by the
    /// server on this socket.
    ///
    /// Diffed against CONFIRMED rather than against the held set, which is the
    /// whole point — a refused, closed or unanswered join is exactly where the two
    /// disagree. Diffed on the WANT side, which is what keeps a topic held only
    /// because its `phx_leave` could not be sent out of this list: it is not
    /// wanted, so it can never appear here, and re-joining it would undo the very
    /// revocation the leave retry is still trying to land.
    ///
    /// Takes the company rather than reading `companyId`, like `joinFrames`, so it
    /// can be asserted without a connect.
    func numberTopicsToRejoin(_ company: String) -> [String] {
        Self.topicDelta(have: confirmedNumberTopics, want: numberTopics(company)).join
    }

    /// The `phx_join` frames a fresh socket sends: the company channel first —
    /// it is the one every member may join and the one whose reply governs the
    /// reconnect — then one per visible number.
    ///
    /// Also records the per-number topics as sent, by ASSIGNMENT: a new socket
    /// starts from the set it is about to join, never from the previous socket's.
    ///
    /// Internal, and lifted out of `runSocket`, so the subscription set can be
    /// asserted without standing up a websocket — the same reason `deliver` is
    /// internal.
    func joinFrames(_ company: String) -> [String] {
        let perNumber = numberTopics(company).sorted()
        joinedNumberTopics = Set(perNumber)
        // A new socket has confirmed nothing, whatever the last one had. Carrying
        // a confirmation across would hide a join on THIS socket that is refused or
        // never answered from the repair sweep — the case the sweep exists for.
        confirmedNumberTopics = []
        let payload = joinPayload()
        return ([Self.companyTopic(company)] + perNumber).map {
            frame(topic: $0, event: "phx_join", payload: payload)
        }
    }

    /// Move a live socket from the channels it has joined to the channels it
    /// should hold. Without a socket this is a no-op on purpose: `joinFrames`
    /// joins the whole current set on the next connection.
    private func reconcileNumberTopics() {
        guard let company = companyId, let socket else { return }
        let delta = Self.topicDelta(have: joinedNumberTopics, want: numberTopics(company))
        guard !delta.join.isEmpty || !delta.leave.isEmpty else { return }
        // One task, so the frames ride the socket in the order they were computed:
        // leaves before joins — a revocation must not wait behind a grant.
        Task { await self.flushTopicDelta(delta, for: company, on: socket) }
    }

    /// #483: how often a live socket asks again for the per-number channels the
    /// server has not confirmed.
    ///
    /// A MINUTE, and it is a cost decision rather than a tuning knob — the web
    /// provider's `GIVE_UP_RETRY_MS` is the same number for the same reason. Every
    /// `phx_join` runs `is_company_topic_member` → `member_number_level` →
    /// `member_number_levels` against Postgres, and a member whose access really
    /// went away while their number list still lists that number is refused on
    /// every single sweep. Asking on the transport's own ~10s ladder would be six
    /// of those a minute, per number, for the life of the process; a minute makes a
    /// genuine revocation one cheap refusal and brings a channel lost to a
    /// token-refresh race back inside one.
    ///
    /// Internal so the cadence can be pinned by a test.
    static let numberTopicRepairInterval: Duration = .seconds(60)

    /// Ask again, once a minute, for every per-number channel this socket wants and
    /// the server has not confirmed. Started per socket, next to the heartbeat, and
    /// dies with it.
    ///
    /// THE ONLY thing that recovers a per-number channel lost on a socket that
    /// stays up. `setNumbers` reconciles a CHANGE of the wanted set and returns
    /// early when the set is the same — which it is here, because access did not
    /// change — so before this, a join refused inside a token-refresh window, or a
    /// channel a realtime node closed while rebalancing, was lost until the process
    /// restarted, with the socket reporting healthy the whole time.
    private func startNumberTopicRepair(_ task: URLSessionWebSocketTask) {
        numberTopicRepair?.cancel()
        numberTopicRepair = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.numberTopicRepairInterval)
                if Task.isCancelled { return }
                await self.repairNumberTopics(on: task)
            }
        }
    }

    /// One sweep. Nothing to ask for is the normal case and costs a set diff.
    ///
    /// Deliberately does NOT emit `reconnected()`. A frame going out says nothing
    /// about whether the join was accepted, so emitting here would fire a whole-app
    /// backfill every minute for a member whose number really was revoked —
    /// trimming every list to page 1 for a gap that does not exist. The web
    /// provider draws the same line (a per-number re-subscribe does not arm its
    /// backfill), and what a closed-then-rejoined channel missed is what the
    /// `.resyncOnForeground` net on every surface is for (#215).
    private func repairNumberTopics(on socket: URLSessionWebSocketTask) async {
        guard let company = companyId, self.socket === socket else { return }
        for topic in numberTopicsToRejoin(company) {
            // Through `sendTopicFrame`, so the rejoin is recorded by what the send
            // actually did and a number dropped from the wanted set between the
            // diff and the send is not joined after all.
            _ = await sendTopicFrame(topic, leaving: false, for: company, on: socket)
        }
    }

    /// Put a reconcile's frames on the wire and record only the ones that went
    /// out, re-sending a leave that did not.
    ///
    /// `joinedNumberTopics` used to be assigned the DESIRED set here, before these
    /// frames were sent, and every send was a discarded `try?`. A `phx_leave` that
    /// never left the device was therefore filed as a completed revocation — see
    /// `topicsAfterSend` for what that costs.
    private func flushTopicDelta(
        _ delta: (join: [String], leave: [String]),
        for company: String,
        on socket: URLSessionWebSocketTask
    ) async {
        var unsentLeaves: [String] = []
        for topic in delta.leave {
            guard let sent = await sendTopicFrame(topic, leaving: true, for: company, on: socket)
            else { continue }
            if !sent { unsentLeaves.append(topic) }
        }
        for topic in delta.join {
            // A join that failed to send is not retried here: the failure means
            // this socket is going, and the next one joins the whole current set
            // from `joinFrames` — or, if this socket survives after all, the
            // once-a-minute sweep asks for it, since an unsent join is one more
            // wanted topic the server never confirmed. Under-subscribing until
            // then is the safe direction; claiming a channel that was never joined
            // is not.
            _ = await sendTopicFrame(topic, leaving: false, for: company, on: socket)
        }
        await retryUnsentLeaves(unsentLeaves, for: company, on: socket)
    }

    /// Build ONE reconcile frame, send it, and move `joinedNumberTopics` by what
    /// the send actually did. `true`/`false` is that send's result; `nil` means no
    /// frame was put on the wire at all, so there is nothing to retry.
    private func sendTopicFrame(
        _ topic: String,
        leaving: Bool,
        for company: String,
        on socket: URLSessionWebSocketTask
    ) async -> Bool? {
        guard self.socket === socket else { return nil }
        // The intent is re-read HERE, not at diff time. Every send suspends and
        // this actor is reentrant, so an `access.changed` landing mid-flush
        // re-derives against a set this flush has not finished moving, computes an
        // empty delta of its own, and leaves this now-stale frame as the only one
        // anybody will act on: obeying it would leave a channel just granted back,
        // or join one just revoked. Building the frame here too keeps `ref` in the
        // order the pushes actually go out.
        let stillWanted = numberTopics(company).contains(topic)
        guard stillWanted != leaving else { return nil }
        let text = frame(
            topic: topic,
            event: leaving ? "phx_leave" : "phx_join",
            payload: leaving ? .object([:]) : joinPayload()
        )
        var sent = true
        do {
            try await socket.send(.string(text))
        } catch {
            // The failure the old `try?` swallowed.
            sent = false
        }
        joinedNumberTopics = Self.topicsAfterSend(
            joinedNumberTopics,
            topic: topic,
            leaving: leaving,
            sent: sent
        )
        // A confirmation belongs to a join the server answered, and this frame
        // retires it: a leave that went out ended that channel, and a join being
        // (re-)sent is us asking again. A leave that did NOT go out is the one case
        // that changes nothing — that channel is still joined and still confirmed,
        // which is what keeps the repair sweep from reading a topic held for the
        // leave retry as a lost one (#483).
        let stillJoinedServerSide = leaving && !sent
        if !stillJoinedServerSide { confirmedNumberTopics.remove(topic) }
        return sent
    }

    /// A `phx_leave` whose send failed is re-sent this many times, this far apart.
    ///
    /// Bounded, because the retry only SHORTENS the exposure — what closes it is
    /// the topic staying held until a leave actually goes out, which keeps every
    /// JWT push re-running the topic policy against that channel.
    private static let leaveRetryLimit = 3
    private static let leaveRetryDelay: Duration = .seconds(2)

    /// Re-send the leaves that did not make it, on the SAME socket.
    ///
    /// Abandoned once this is no longer the live socket (`sendTopicFrame` returns
    /// nil and the queue drains): a replacement socket joins from `joinFrames`,
    /// which starts from the current number set, so it never joined the revoked
    /// topic and there is nothing left to leave.
    private func retryUnsentLeaves(
        _ topics: [String],
        for company: String,
        on socket: URLSessionWebSocketTask
    ) async {
        var pending = topics
        var attempt = 0
        while !pending.isEmpty, attempt < Self.leaveRetryLimit {
            attempt += 1
            try? await Task.sleep(for: Self.leaveRetryDelay)
            var stillUnsent: [String] = []
            for topic in pending {
                guard let sent = await sendTopicFrame(topic, leaving: true, for: company, on: socket)
                else { continue }
                if !sent { stillUnsent.append(topic) }
            }
            pending = stillUnsent
        }
    }

    private func joinPayload() -> JSONValue {
        .object([
            "config": .object([
                "broadcast": .object(["self": .bool(false), "ack": .bool(false)]),
                "presence": .object(["key": .string("")]),
                "private": .bool(true),
            ]),
            "access_token": .string(accessToken ?? ""),
        ])
    }

    /// Push a refreshed JWT onto EVERY channel this socket holds.
    ///
    /// Per channel, not per socket: the server re-authorizes a channel when it
    /// receives `access_token` ON THAT TOPIC, and closes a channel whose token
    /// expired. Pushing only to the company topic would have the number channels
    /// die about an hour in while the company channel stayed healthy — realtime
    /// half-working, which is the hardest kind of broken to notice.
    private func pushAccessToken() {
        guard let company = companyId, let token = accessToken, let socket else { return }
        let payload: JSONValue = .object(["access_token": .string(token)])
        let frames: [String] = ([Self.companyTopic(company)] + joinedNumberTopics.sorted()).map {
            frame(topic: $0, event: "access_token", payload: payload)
        }
        Task {
            for text in frames { try? await socket.send(.string(text)) }
        }
    }

    private func frame(topic: String, event: String, payload: JSONValue) -> String {
        let message: JSONValue = .object([
            "topic": .string(topic),
            "event": .string(event),
            "payload": payload,
            "ref": .string(String(ref)),
        ])
        ref += 1
        guard let data = try? JSONEncoder().encode(message) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    private func websocketURL() -> URL? {
        var components = URLComponents(url: supabaseURL, resolvingAgainstBaseURL: false)
        components?.scheme = supabaseURL.scheme == "http" ? "ws" : "wss"
        components?.path = "/realtime/v1/websocket"
        components?.queryItems = [
            URLQueryItem(name: "apikey", value: publishableKey),
            URLQueryItem(name: "vsn", value: "1.0.0"),
        ]
        return components?.url
    }
}
