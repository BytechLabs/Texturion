import Foundation
@preconcurrency import PushKit

/// PushKit VoIP registration (#161). The token goes into `TxConfig
/// (pushDeviceToken:)` at every SDK login, so the Telnyx iOS push credential
/// (founder-configured in the Telnyx portal — see PRODUCTION.md) can ring
/// this device while the socket is down. The push payload itself comes FROM
/// TELNYX, not from the Loonext backend.
///
/// Delegate runs on the MAIN queue, so the `@preconcurrency` conformance's
/// main-actor assumption always holds.
@MainActor
final class VoipPushAdapter: NSObject {
    /// Fires with the hex token, or nil when iOS invalidates it.
    var onToken: ((String?) -> Void)?

    /// Fires with the raw payload dictionary + PushKit's completion. The
    /// handler MUST report a CallKit call before returning control — iOS
    /// terminates apps that swallow a VoIP push.
    var onPush: (([AnyHashable: Any], @escaping () -> Void) -> Void)?

    private var registry: PKPushRegistry?

    /// Idempotent. Creating the registry is also what makes iOS re-deliver a
    /// pending VoIP push after a cold launch — call this as early in the app
    /// lifetime as possible.
    func start() {
        guard registry == nil else { return }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
        if let token = registry.pushToken(for: .voIP) {
            onToken?(Self.hex(token))
        }
    }

    static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }
}

extension VoipPushAdapter: @preconcurrency PKPushRegistryDelegate {
    func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        onToken?(Self.hex(pushCredentials.token))
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didInvalidatePushTokenFor type: PKPushType
    ) {
        guard type == .voIP else { return }
        onToken?(nil)
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        guard let onPush else {
            // No handler yet — nothing can ring; complete so iOS doesn't
            // penalize the app for a hung push.
            completion()
            return
        }
        onPush(payload.dictionaryPayload, completion)
    }
}
