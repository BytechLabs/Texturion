import Foundation

/// #408 — two techs answering the same customer, thirty seconds apart.
///
/// A customer texts "Can you come Tuesday?". Two techs get the notification,
/// both open the thread, both type, and the customer receives "Yes, 9am works"
/// followed by "Sorry, we're booked Tuesday". From the same business.
///
/// The product creates that race on purpose and that is still right: an
/// unassigned inbound notifies EVERY active member, which is correct for
/// "never miss a lead". The window between "everyone is told" and "somebody
/// claims it" is the window both replies get written in.
///
/// SO THIS WARNS, IT DOES NOT BLOCK. A duplicate reply is genuinely better
/// than no reply, and anything discouraging a tech from answering works
/// against the five-minute window that decides the job.
///
/// Hand-port of packages/shared/src/duplicate-reply.ts — the same assertion
/// table runs in all three languages, because a warning that exists only on
/// web protects nobody in a truck.
struct DuplicateReplyWarning: Equatable, Sendable {
    let warn: Bool
    let byUserId: String?
}

private let noDuplicateWarning = DuplicateReplyWarning(warn: false, byUserId: nil)

/// Parses the ISO-8601 shapes the API emits, with and without fractional
/// seconds. An unreadable timestamp is silence: never stand between a tech and
/// a waiting customer on the strength of a date that failed to parse.
private func parseDuplicateInstant(_ value: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = withFraction.date(from: value) { return parsed }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: value)
}

/// Should we ask before this send? Yes when somebody OTHER than the sender put
/// an outbound into this thread at or after the moment the draft began.
///
/// A nil `draftStartedAt` never warns: a draft restored after the app was
/// killed has no start moment we can honestly claim, and a confirmation we
/// cannot justify is worse than none — the first false one teaches people to
/// dismiss the true ones.
func duplicateReplyWarning(
    draftStartedAt: String?,
    lastOutboundAt: String?,
    lastOutboundByUserId: String?,
    meUserId: String
) -> DuplicateReplyWarning {
    guard let draftStartedAt, let lastOutboundAt else { return noDuplicateWarning }
    // Your own send is not a collision. Sending twice in a row is deliberate
    // and ordinary — a correction, an address, a second thought.
    if lastOutboundByUserId == meUserId { return noDuplicateWarning }

    guard let started = parseDuplicateInstant(draftStartedAt),
          let landed = parseDuplicateInstant(lastOutboundAt)
    else { return noDuplicateWarning }

    if landed < started { return noDuplicateWarning }
    return DuplicateReplyWarning(warn: true, byUserId: lastOutboundByUserId)
}

/// The sentence the confirmation opens with. Names the person when we know
/// them, because "Sam replied" is a fact somebody can act on — they can ask Sam
/// — and "someone replied" is not.
///
/// #228: the sentence and the "how long ago" fragment are both catalogue
/// entries, under Android's own keys — a warning that reads differently on the
/// two phones is a warning two techs cannot compare. `locale` is defaulted and
/// last, so existing callers and the assertion table are untouched.
func duplicateReplyPrompt(
    who: String?,
    secondsAgo: Int,
    locale: String? = nil
) -> String {
    let ago: String
    if secondsAgo < 60 {
        ago = AppStrings.translate(locale, "thread.agoJustNow")
    } else if secondsAgo < 3600 {
        let m = secondsAgo / 60
        ago = m == 1
            ? AppStrings.translate(locale, "thread.agoOneMinute")
            : AppStrings.translate(locale, "thread.agoMinutes", ["count": String(m)])
    } else if secondsAgo < 86_400 {
        let h = secondsAgo / 3600
        ago = h == 1
            ? AppStrings.translate(locale, "thread.agoOneHour")
            : AppStrings.translate(locale, "thread.agoHours", ["count": String(h)])
    } else {
        ago = AppStrings.translate(locale, "thread.agoSinceWriting")
    }
    let name = who?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return name.isEmpty
        ? AppStrings.translate(locale, "thread.duplicateReplyAuto", ["ago": ago])
        : AppStrings.translate(
            locale,
            "thread.duplicateReplyNamed",
            ["name": name, "ago": ago]
        )
}
