import Foundation

/// kotlinx-serialization-style field defaulting for the wire models.
///
/// KEY-MAPPING RULE (applies to every /v1 model in Core/Model): stored
/// property names ARE the wire names — snake_case, no CodingKeys, no
/// key-decoding strategy. This mirrors the Android models 1:1, makes the
/// field-by-field check against apps/web/src/lib/api/types.ts trivial, and
/// keeps pass-through `JSONValue` payload bags verbatim (a
/// `.convertFromSnakeCase` strategy would silently mangle dynamic dictionary
/// keys inside payloads).
///
/// `@Default<...>` gives a wrapped property a value when the key is ABSENT or
/// JSON `null` — the Swift analogue of a Kotlin `@Serializable` default, so a
/// lagging client never fails decoding when the server drops or adds a field.
protocol DefaultCodableProvider {
    associatedtype Value: Codable & Sendable
    static var defaultValue: Value { get }
}

@propertyWrapper
struct Default<Provider: DefaultCodableProvider>: Codable, Sendable {
    var wrappedValue: Provider.Value

    init(wrappedValue: Provider.Value) {
        self.wrappedValue = wrappedValue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            wrappedValue = Provider.defaultValue
        } else {
            wrappedValue = try container.decode(Provider.Value.self)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wrappedValue)
    }
}

extension KeyedDecodingContainer {
    /// The missing-key hook: synthesized `init(from:)` routes through this
    /// overload, so an absent field falls back to the provider's default
    /// instead of throwing `.keyNotFound`.
    func decode<P>(_ type: Default<P>.Type, forKey key: Key) throws -> Default<P> {
        try decodeIfPresent(type, forKey: key) ?? Default<P>(wrappedValue: P.defaultValue)
    }
}

// MARK: - Shared providers

enum DefaultFalse: DefaultCodableProvider {
    static var defaultValue: Bool { false }
}

enum DefaultTrue: DefaultCodableProvider {
    static var defaultValue: Bool { true }
}

enum DefaultZero: DefaultCodableProvider {
    static var defaultValue: Int { 0 }
}

enum DefaultEmptyString: DefaultCodableProvider {
    static var defaultValue: String { "" }
}

enum DefaultEmptyList<Element: Codable & Sendable>: DefaultCodableProvider {
    static var defaultValue: [Element] { [] }
}
