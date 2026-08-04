import Foundation

struct Member: Codable, Sendable {
    let id: String
    let user_id: String
    let role: String
    let deactivated_at: String?
    let created_at: String
    @Default<DefaultEmptyString> var display_name: String
}

struct Invite: Codable, Sendable {
    let id: String
    let company_id: String
    let email: String
    let role: String
    let invited_by: String
    let expires_at: String
    let accepted_at: String?
    let revoked_at: String?
    let created_at: String
    /// POST /v1/invites only: false = send failed, fall back to Copy link.
    let email_sent: Bool?
    /// GET /v1/invites/mine only: inviting company's name for the banner.
    let company_name: String?
    /// #521: why this person was being added, in the inviter's words. Written
    /// once, when the invite is sent, and readable afterwards because there is
    /// no edit path: the only way to check what you said is to see it.
    let note: String?
}

/// GET /v1/me/joining-note (#521): what this member was told about why they
/// were added, in the words of whoever added them.
///
/// `{ note: null, from: null }` is the ORDINARY answer, not a failure. Every
/// membership predating the field, every owner who made their own workspace and
/// every invite sent without a note gets it, so a caller treats "nothing to
/// say" as a thing to say nothing about.
///
/// `from` can be null while `note` is not: the display name is looked up
/// best-effort and an unattributed note is still a person's words.
struct JoiningNote: Codable, Sendable {
    let note: String?
    let from: String?
}

/// POST /v1/invites/accept response (member row + company_id).
struct AcceptedInvite: Codable, Sendable {
    let id: String
    let user_id: String
    let role: String
    let deactivated_at: String?
    let created_at: String
    let company_id: String
}
