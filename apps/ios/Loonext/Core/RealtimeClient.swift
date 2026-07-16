import Foundation

/// One realtime event off the company broadcast channel (SPEC §8). Payloads
/// are ID-only by design — consumers refetch the referenced resource via the
/// API.
struct RealtimeEvent: Sendable {
    let event: String
    let payload: JSONValue
}

/// Supabase Realtime private-broadcast client (Phoenix protocol over
/// URLSessionWebSocketTask) for the per-company channel `company:{id}`.
///
/// - Private channel: join carries `access_token`; RLS on realtime.messages
///   authorizes membership. Token refreshes are pushed via the `access_token`
///   event so the socket survives JWT rotation.
/// - Reconnects with capped exponential backoff; each successful re-JOIN emits
///   on `reconnected()` so callers refetch first pages (payloads may have been
///   lost while offline — the web client does exactly this).
actor RealtimeClient {
    private let supabaseURL: URL
    private let publishableKey: String
    private let urlSession: URLSession

    private var socket: URLSessionWebSocketTask?
    private var connectLoop: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var ref: UInt64 = 1
    private var companyId: String?
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

    /// Broadcast events off the joined company channel.
    func events() -> AsyncStream<RealtimeEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<RealtimeEvent>.makeStream(
            bufferingPolicy: .bufferingNewest(64)
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

    // MARK: - Lifecycle

    /// Connect (or switch) to a company channel. Safe to call repeatedly.
    func connect(companyId: String, accessToken: String) {
        let sameChannel = self.companyId == companyId
        self.companyId = companyId
        self.accessToken = accessToken
        if sameChannel && connectLoop != nil {
            pushAccessToken()
            return
        }
        everJoined = false
        restart()
    }

    /// Push a refreshed JWT into the live channel (call on every refresh).
    func setAuth(_ accessToken: String) {
        self.accessToken = accessToken
        pushAccessToken()
    }

    func disconnect() {
        companyId = nil
        connectLoop?.cancel()
        connectLoop = nil
        heartbeat?.cancel()
        heartbeat = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        joined = false
    }

    private func restart() {
        connectLoop?.cancel()
        heartbeat?.cancel()
        heartbeat = nil
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
            try await task.send(.string(frame(
                topic: topicName(company),
                event: "phx_join",
                payload: joinPayload()
            )))
        } catch {
            if socket === task { socket = nil }
            return
        }
        startHeartbeat(task)
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                handle(message)
            } catch {
                break
            }
        }
        heartbeat?.cancel()
        heartbeat = nil
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

    private func handle(_ message: URLSessionWebSocketTask.Message) {
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

        switch event {
        case "phx_reply":
            let ok = payload?["status"]?.stringValue == "ok"
            let topic = msg["topic"]?.stringValue
            if ok, topic?.hasPrefix("realtime:company:") == true, !joined {
                joined = true
                if everJoined {
                    for continuation in reconnectObservers.values { continuation.yield(()) }
                }
                everJoined = true
            }

        case "broadcast":
            guard let name = payload?["event"]?.stringValue else { return }
            let inner: JSONValue
            if let raw = payload?["payload"], raw.objectValue != nil {
                inner = raw
            } else {
                inner = .object([:])
            }
            let realtimeEvent = RealtimeEvent(event: name, payload: inner)
            for continuation in eventObservers.values { continuation.yield(realtimeEvent) }

        default:
            // phx_close / phx_error: the receive loop notices the close.
            break
        }
    }

    private func topicName(_ company: String) -> String {
        "realtime:company:\(company)"
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

    private func pushAccessToken() {
        guard let company = companyId, let token = accessToken, let socket else { return }
        let text = frame(
            topic: topicName(company),
            event: "access_token",
            payload: .object(["access_token": .string(token)])
        )
        Task { try? await socket.send(.string(text)) }
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
