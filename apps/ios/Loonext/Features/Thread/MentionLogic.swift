import Foundation

/// A teammate the author picked from the mention list, with the text inserted.
struct PickedMention: Codable, Sendable, Equatable {
    let userId: String
    /// The display name as written into the draft, without the "@".
    let name: String
}

/// Where the caret lands after a mention is written into the draft.
struct MentionInsertion: Equatable {
    let text: String
    let caret: Int
}

/// A teammate who may be named on a note in ONE conversation. The server
/// answers this, not the client: number access decides who can see a thread,
/// and a note quotes the customer.
struct MentionableMember: Codable, Sendable, Identifiable {
    let user_id: String
    let role: String
    let display_name: String

    var id: String { user_id }
}

/// Mention rules for the note composer, ported from the web client's
/// `components/thread/mentions.ts` and Android's `MentionLogic.kt`. All three
/// clients POST the same `mention_user_ids`, so a difference here is a
/// difference in who gets told.
enum MentionLogic {

    /// Which picks survive to the send.
    ///
    /// Each pick must claim its OWN "@Name" in the draft, and a claimed span
    /// is consumed so nothing else can match inside it. A plain "contains"
    /// test looks equivalent and is not: display names are neither unique nor
    /// prefix-free, so with "Sam" and "Sam Rivera" both picked, deleting
    /// "@Sam" left "@Sam Rivera" behind, which still contains "@Sam" and
    /// notified the withdrawn person. Two teammates who share a name had the
    /// same problem.
    ///
    /// Longest name first, because "@Sam Rivera" must take that span before
    /// "@Sam" can look at it.
    static func resolveMentions(text: String, picked: [PickedMention]) -> [String] {
        var claimed: [Range<String.Index>] = []
        var ids: [String] = []

        for mention in picked.sorted(by: { $0.name.count > $1.name.count }) {
            let token = "@\(mention.name)"
            var searchFrom = text.startIndex
            while let found = text.range(of: token, range: searchFrom..<text.endIndex) {
                let overlaps = claimed.contains { found.lowerBound < $0.upperBound && found.upperBound > $0.lowerBound }
                if !overlaps {
                    claimed.append(found)
                    if !ids.contains(mention.userId) { ids.append(mention.userId) }
                    break
                }
                guard found.lowerBound < text.endIndex else { break }
                searchFrom = text.index(after: found.lowerBound)
            }
        }
        return ids
    }

    /// Whether an "@" typed at this position is asking for the picker.
    ///
    /// Only at the start of the draft or after whitespace. Mid-word it is part
    /// of something being written: an email address, a rate like "2 hrs @ $95",
    /// a handle. Opening a teammate picker there makes an ordinary internal
    /// note impossible to type.
    static func isMentionTrigger(text: String, caret: Int) -> Bool {
        let characters = Array(text)
        guard caret > 0, caret <= characters.count else { return false }
        guard characters[caret - 1] == "@" else { return false }
        if caret == 1 { return true }
        return characters[caret - 2].isWhitespace
    }

    /// Insert a mention at the caret, swallowing the "@" that opened the
    /// picker so the draft never reads "@@Sam".
    static func insertMention(text: String, caret: Int, name: String) -> MentionInsertion {
        let characters = Array(text)
        let safeCaret = min(max(caret, 0), characters.count)
        let trigger = (safeCaret > 0 && characters[safeCaret - 1] == "@") ? safeCaret - 1 : safeCaret
        let before = String(characters[0..<trigger])
        let after = String(characters[safeCaret...])
        // A trailing space keeps typing natural, but not a second one.
        let spacer = after.hasPrefix(" ") ? "" : " "
        let inserted = "@\(name)\(spacer)"
        return MentionInsertion(text: before + inserted + after, caret: before.count + inserted.count)
    }
}
