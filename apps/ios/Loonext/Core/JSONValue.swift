import Foundation

/// A decoded-as-is JSON tree for pass-through payload bags (realtime event
/// payloads, conversation-event payloads). Mirrors the Android client's use
/// of kotlinx `JsonObject`: the payloads are ID-bags by design, so the client
/// keeps them verbatim and never models their fields.
indirect enum JSONValue: Codable, Sendable, Equatable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Not a JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    // MARK: - Accessors

    var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    var doubleValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// An integer from a JSON number OR a numeric string.
    ///
    /// #270: `stringValue` returns nil for `.number`, so reading a numeric
    /// payload field through it silently yields nothing — and the caller's
    /// `?? 0` then makes the bug look like a legitimate zero. A voicemail's
    /// length was read that way and every voicemail on iOS displayed no
    /// duration, for months, with no error anywhere.
    ///
    /// It is TOLERANT of both shapes on purpose. Android's `payloadString`
    /// returns `JsonPrimitive.content`, which stringifies a number, so
    /// identical-looking code on the two platforms behaved differently — this
    /// closes that asymmetry rather than just the one call site. A field the
    /// server later emits as a string keeps working here.
    var intValue: Int? {
        switch self {
        case let .number(value):
            // A JSON number is a Double. `Int(exactly:)` rather than `Int(_:)`
            // and a bounds check: Double(Int.max) rounds UP to 2^63, so a
            // comparison against it lets 2^63 through and `Int(_:)` then traps.
            // Truncate toward zero first so a fractional value still reads.
            guard value.isFinite else { return nil }
            return Int(exactly: value.rounded(.towardZero))
        case let .string(value):
            return Int(value.trimmingCharacters(in: .whitespaces))
        default:
            return nil
        }
    }

    var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }
}

// MARK: - Literals (frame building + tests)

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral,
    ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
    ExpressibleByStringLiteral, ExpressibleByArrayLiteral,
    ExpressibleByDictionaryLiteral {
    init(nilLiteral: ()) { self = .null }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(floatLiteral value: Double) { self = .number(value) }
    init(stringLiteral value: String) { self = .string(value) }
    init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(uniqueKeysWithValues: elements))
    }
}
