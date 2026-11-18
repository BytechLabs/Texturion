import Foundation

struct MessagePhone: Decodable, Equatable {
    let start: Int
    let end: Int
    let e164: String
}

enum MessagePhones {
    private static let phoneRun = try! NSRegularExpression(pattern: #"(?:\+?[0-9]|\([0-9]{3}\))[0-9+(). \t-]*[0-9]"#)
    private static let webAddress = try! NSRegularExpression(pattern: #"(?:https?://|www\.)\S+"#, options: .caseInsensitive)
    private static let attachedCharacter = try! NSRegularExpression(pattern: #"[\p{L}\p{N}_@/\\]"#)

    static func find(in body: String) -> [MessagePhone] {
        let text = body as NSString
        let range = NSRange(location: 0, length: text.length)
        let addresses = webAddress.matches(in: body, range: range)
        return phoneRun.matches(in: body, range: range).compactMap { match in
            let start = match.range.location
            let end = NSMaxRange(match.range)
            guard !isAttached(start - 1, in: text), !isAttached(end, in: text),
                  !addresses.contains(where: { NSIntersectionRange($0.range, match.range).length > 0 }),
                  let e164 = Nanp.normalize(text.substring(with: match.range))
            else { return nil }
            return MessagePhone(start: start, end: end, e164: e164)
        }
    }

    private static func isAttached(_ index: Int, in text: NSString) -> Bool {
        guard index >= 0, index < text.length else { return false }
        let range = NSRange(location: index, length: 1)
        return attachedCharacter.firstMatch(in: text as String, range: range) != nil
    }
}
