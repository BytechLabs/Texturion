import Foundation

/// #310 — making the wait legible.
///
/// Hand-ported from `packages/shared/src/registration-progress.ts`;
/// `RegistrationProgressTests.swift` asserts the same table.
///
/// A drift means "under review" on the phone and "submitted" on the laptop,
/// which is worse than either alone — it teaches the customer to distrust both
/// at exactly the moment they are already wondering whether the wait is broken.
enum RegistrationStage: Sendable {
    case needsDetails
    case submitting
    case underReview
    case approved
    case rejected
}

struct RegistrationProgress: Sendable {
    let stage: RegistrationStage
    /// 0-100. Never 0 once anything has been submitted — see below.
    let percent: Int
    let title: String
    let next: String
    /// How long from here, or nil when there is nothing to wait for.
    let expected: String?
    /// Whether anything is required FROM THEM. Everything else is waiting.
    let actionNeeded: Bool
}

/// The campaign outranks the brand: the campaign is what actually unlocks
/// texting, so an approved brand with a campaign still under review is NOT
/// further along than the campaign says.
func registrationStage(brand: String?, campaign: String?) -> RegistrationStage {
    // A rejection anywhere is the headline — it is the only state that needs
    // them, and burying it under a cheerful campaign status would be a lie of
    // emphasis.
    if brand == "rejected" || campaign == "rejected" { return .rejected }
    if campaign == "approved" { return .approved }
    if campaign == "pending" || brand == "pending" { return .underReview }
    if campaign == "submitted" || brand == "submitted" { return .submitting }
    if brand == "approved" { return .submitting }
    return .needsDetails
}

/// THE PERCENTAGES ARE DELIBERATELY NOT LINEAR-IN-TIME, and never 0 once
/// anything has been sent. A bar sitting at 0% for four days is the spinner
/// this exists to replace. The value marks how many steps are BEHIND you — a
/// true statement, rather than a fabricated estimate of time remaining.
func registrationProgress(brand: String?, campaign: String?) -> RegistrationProgress {
    switch registrationStage(brand: brand, campaign: campaign) {
    case .needsDetails:
        return RegistrationProgress(
            stage: .needsDetails,
            percent: 10,
            title: "We need a few business details",
            next: "Finish the texting registration form and we'll send it on.",
            expected: nil,
            actionNeeded: true
        )
    case .submitting:
        return RegistrationProgress(
            stage: .submitting,
            percent: 40,
            title: "Sent to the carriers",
            next: "The carriers review it next. Nothing needed from you.",
            expected: "Usually 3–7 business days, sometimes longer",
            actionNeeded: false
        )
    case .underReview:
        return RegistrationProgress(
            stage: .underReview,
            percent: 70,
            title: "Under review by the carriers",
            next: "We'll text and email you the moment it clears.",
            expected: "Usually 3–7 business days, sometimes longer",
            actionNeeded: false
        )
    case .approved:
        return RegistrationProgress(
            stage: .approved,
            percent: 100,
            title: "Your texting is live",
            next: "You can text customers now.",
            expected: nil,
            actionNeeded: false
        )
    case .rejected:
        return RegistrationProgress(
            stage: .rejected,
            percent: 40,
            title: "The carriers need something changed",
            next: "Check the details on your registration and resubmit.",
            expected: nil,
            actionNeeded: true
        )
    }
}

/// Is this workspace in the waiting room?
///
/// Approved is out; so is `needsDetails`, because that workspace is not
/// waiting on anybody — it is being waited ON, and offering it optional setup
/// work would point away from the thing blocking it.
func isWaitingOnRegistration(brand: String?, campaign: String?) -> Bool {
    switch registrationStage(brand: brand, campaign: campaign) {
    case .submitting, .underReview: return true
    default: return false
    }
}
