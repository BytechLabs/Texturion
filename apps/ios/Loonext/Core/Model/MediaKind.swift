import Foundation

/// Coarse media kind for an attachment — the Swift twin of `mmsMediaKind`
/// (packages/shared/src/mms.ts) and `public.mms_media_kind` (migration
/// 20260724080000). The three must agree: the inbox reads the kind the server
/// computed, and a bubble computes the same kind locally from the content type,
/// so a row must not change its wording depending on which one answered.
enum MediaKind: String, Sendable {
    case image
    case audio
    case video
    case contact
    case calendar
    case document
    case text
    case file

    /// Map a content type onto its kind. Unknown or absent → `.file`.
    static func of(_ contentType: String?) -> MediaKind {
        // Canonicalize the way the shared helper does: drop any ";charset=..."
        // parameter, trim, lowercase.
        let type = (contentType ?? "")
            .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""

        if type.hasPrefix("image/") { return .image }
        if type.hasPrefix("audio/") { return .audio }
        if type.hasPrefix("video/") { return .video }
        if type == "text/vcard" || type == "text/x-vcard" { return .contact }
        if type == "text/calendar" { return .calendar }
        if type == "application/pdf" { return .document }
        if type.hasPrefix("text/") { return .text }
        return .file
    }

    /// SF Symbol for a chip or a row.
    var symbolName: String {
        switch self {
        case .image: return "photo"
        case .audio: return "waveform"
        case .video: return "video"
        case .contact: return "person.crop.rectangle"
        case .calendar: return "calendar"
        case .document: return "doc.text"
        case .text: return "doc.plaintext"
        case .file: return "paperclip"
        }
    }
}

/// What to call an attachment in a one-line preview.
///
/// A customer's voice message used to read as "Photo" in the inbox, because the
/// row only had a `has_attachments` boolean and every client guessed a noun.
/// This is the one place that turns a kind plus a count into words.
/// Mirrors `attachmentLabel` in apps/web/src/lib/attachments/media-label.ts.
func attachmentLabel(kind: MediaKind?, count: Int) -> String {
    let n = max(count, 1)
    let many = n > 1
    switch kind {
    case .image: return many ? "\(n) photos" : "Photo"
    case .audio: return many ? "\(n) audio messages" : "Audio message"
    case .video: return many ? "\(n) videos" : "Video"
    case .contact: return many ? "\(n) contact cards" : "Contact card"
    case .calendar: return many ? "\(n) calendar invites" : "Calendar invite"
    case .document: return many ? "\(n) PDFs" : "PDF"
    case .text: return many ? "\(n) text files" : "Text file"
    // Unknown kind, or a message carrying a MIXED set: the honest noun.
    case .file, .none: return many ? "\(n) attachments" : "Attachment"
    }
}

/// The kind every attachment shares, or nil when they disagree (a mixed set
/// takes the neutral wording). Mirrors the SQL in migration 20260724080000.
func sharedMediaKind(_ kinds: [MediaKind]) -> MediaKind? {
    guard let first = kinds.first else { return nil }
    return kinds.allSatisfy { $0 == first } ? first : nil
}
