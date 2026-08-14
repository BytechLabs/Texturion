import Foundation

/// #247 — the catch-up, iOS half.
///
/// A tech comes off a roof at 4pm to a thread nobody has read since Tuesday.
/// The expensive part is not typing, it is READING: reconstructing what was
/// asked, what the crew committed to, and what is still owed.
///
/// This file is the non-visual half — the rule that decides whether the control
/// is even on screen, the three fixed headings, the wire shape, and the sentence
/// for every way it can come back empty. `ThreadSummaryCard.swift` renders it.
///
/// # Hand-ported from packages/shared/src/thread-summary.ts
///
/// Swift cannot import TypeScript, so this is the third copy of one rule and the
/// server's is the one that counts — it refuses `too_short` authoritatively
/// before anything is reserved. This copy exists so a person is never OFFERED
/// something that answers "there was nothing to summarise". `ThreadSummaryTests`
/// reads the TypeScript source and fails if the two disagree.
///
/// Deliberately dull, for the reason the shared file gives: no regex, no date
/// parsing, only integer comparisons. `\b` means backspace in Kotlin and does
/// not compile in Swift, and that class of silent divergence is what this shape
/// avoids.

// MARK: - Is this thread worth a catch-up?

/// Long enough that reading it is genuinely expensive.
///
/// Twelve customer-visible messages is roughly where a thread stops fitting on
/// one screen and somebody starts scrolling to answer "what did we say about the
/// price". Below it, reading beats summarising — in tokens AND in the reader's
/// time.
let threadSummaryMinMessages = 12

/// A shorter thread still earns a catch-up once enough time has passed, because
/// the cost this attacks is not only length, it is having FORGOTTEN.
let threadSummaryIdleDays = 7

/// The same figure in milliseconds, so no caller does the arithmetic itself.
let threadSummaryIdleMs = threadSummaryIdleDays * 24 * 60 * 60 * 1000

/// Even a forgotten thread needs something in it. Two messages from a month ago
/// are read in four seconds, and a summary of them can only be longer.
let threadSummaryIdleMinMessages = 4

/// Whether the catch-up is offered, and WHICH FACT earned it.
///
/// One value rather than a `shouldOffer` boolean beside a separate "why" —
/// PORTAL-UX §3.1 requires the card to name the signal that placed it, and two
/// functions computing the decision and the reason independently is two things
/// that can disagree. Here the reason is the decision.
enum ThreadCatchUpOffer: Equatable {
    /// Reading it beats summarising it. Costs nothing, and is the honest answer.
    case notOffered
    /// Long: this many customer-visible messages.
    case long(messages: Int)
    /// Old enough to have been forgotten: quiet this many whole days.
    case idle(days: Int)

    var isOffered: Bool { self != .notOffered }
}

/// Two ways a thread becomes expensive to re-read, and either is enough.
///
/// `messageCount` counts customer-visible messages only. NOTES ARE NOT COUNTED,
/// for the same reason they never enter the prompt: a summary is about the
/// conversation, and a crew's private note is not part of it.
///
/// On a phone this count is whatever is LOADED, which makes it a lower bound on
/// a paged thread — the safe direction. Under-offering costs somebody a scroll
/// they were going to do anyway; over-offering spends an AI unit to be told
/// there was nothing there.
func threadCatchUpOffer(messageCount: Int, idleMs: Int) -> ThreadCatchUpOffer {
    if messageCount >= threadSummaryMinMessages {
        return .long(messages: messageCount)
    }
    if messageCount >= threadSummaryIdleMinMessages, idleMs >= threadSummaryIdleMs {
        return .idle(days: idleMs / (24 * 60 * 60 * 1000))
    }
    return .notOffered
}

/// The same question asked of a loaded timeline.
///
/// NOTES ARE FILTERED OUT rather than mapped, which is the rule the server draws
/// twice over: a note is where a crew writes "this guy never pays", it never
/// enters the prompt, and counting one toward "long enough to be worth
/// summarising" would offer a catch-up for a conversation that has barely
/// happened.
///
/// `now` is injected so the seven-day arm is testable without waiting a week.
func threadCatchUpOffer(for messages: [Message], now: Date = Date()) -> ThreadCatchUpOffer {
    let visible = messages.filter { $0.direction != MessageDirection.note }
    // The timeline is newest-first, so the freshest customer-visible message is
    // the first one that survives the filter.
    guard let newest = visible.first,
          let at = parseWireTimestamp(newest.created_at)
    else { return .notOffered }
    // Clamped: a device clock running behind the server would otherwise produce
    // a negative idle, and `.idle` reads a negative as "not idle" only by luck.
    let idleMs = max(0, Int(now.timeIntervalSince(at) * 1000))
    return threadCatchUpOffer(messageCount: visible.count, idleMs: idleMs)
}

/// The offer's reason, in the words that go on the control. Nil when there is
/// nothing to offer, so the caller renders no control rather than a blank chip.
func threadCatchUpOfferLabel(
    _ offer: ThreadCatchUpOffer,
    locale: String? = nil
) -> String? {
    switch offer {
    case .notOffered:
        return nil
    case .long(let messages):
        return AppStrings.translate(
            locale,
            "thread.summaryOfferMessages",
            ["count": String(messages)]
        )
    case .idle(let days):
        return days == 1
            ? AppStrings.translate(locale, "thread.summaryOfferQuietDay")
            : AppStrings.translate(
                locale,
                "thread.summaryOfferQuietDays",
                ["count": String(days)]
            )
    }
}

// MARK: - The three sections

/// The section ids, as a string namespace rather than an enum.
///
/// The value arrives from the server, and the house rule (see
/// `AddressProvenance`) is that a value added server-side must never crash a
/// lagging build. Grouping drops anything that is not one of these three, which
/// is also what stops this client inventing a fourth heading.
enum ThreadSummarySectionId {
    static let asked = "asked"
    static let weSaid = "we_said"
    static let open = "open"
}

/// One section id and the heading that goes with it.
///
/// #228: TWO spellings of the heading, and both are load-bearing. `label` is the
/// ENGLISH, which `ThreadSummaryTests` holds against the shared TypeScript
/// source character for character — three clients each inventing a heading for
/// "what we committed to" is the failure that check exists for, and a key would
/// not be findable in that file. `labelKey` is where the French lives, and it is
/// Android's own key so the same heading reaches the same name on both phones.
struct ThreadSummarySection: Sendable {
    let id: String
    let label: String
    let labelKey: String
}

/// The three sections in the order a person reads them, with the headings
/// written once for all three clients (packages/shared/src/thread-summary.ts).
///
/// What THEY wanted, what WE said back, what is still owed. That is the order
/// the question is asked in when somebody opens a thread cold, and "open" is
/// last because it is the part a person acts on.
///
/// Not "action items". A loop is open because nobody closed it, which is a
/// statement about the conversation; an action item is an instruction, and this
/// surface does not get to give the crew instructions.
let threadSummarySections: [ThreadSummarySection] = [
    ThreadSummarySection(
        id: ThreadSummarySectionId.asked,
        label: AppStrings.translate(nil, "domain.catchUpSectionAsked"),
        labelKey: "domain.catchUpSectionAsked"
    ),
    ThreadSummarySection(
        id: ThreadSummarySectionId.weSaid,
        label: AppStrings.translate(nil, "domain.catchUpSectionWeSaid"),
        labelKey: "domain.catchUpSectionWeSaid"
    ),
    ThreadSummarySection(
        id: ThreadSummarySectionId.open,
        label: AppStrings.translate(nil, "domain.catchUpSectionOpen"),
        labelKey: "domain.catchUpSectionOpen"
    ),
]

/// The line shown beside the catch-up, in one place for all three clients.
///
/// A summary is Lou's reading of the thread, not a record of it. #247 is
/// explicit that a wrong summary is worse than none, because a crew ACTS on it
/// — so the surface has to say whose reading it is and that the thread is still
/// the arbiter. Every line taps through to the message it came from, which is
/// what makes that sentence true rather than a disclaimer.
///
/// #228: the ENGLISH, because `ThreadSummaryTests` holds this against the shared
/// TypeScript source verbatim. The card draws `threadSummaryAttributionKey`.
let threadSummaryAttribution = AppStrings.translate(nil, "domain.catchUpAttribution")

/// The same sentence, as the key the card reads it through.
let threadSummaryAttributionKey = "domain.catchUpAttribution"

// MARK: - The wire

/// One line of the catch-up, after it has survived every server-side rule.
///
/// `message_id` and `at` come from the server's copy of the cited message rather
/// than from anything the model said, so a tap always lands somewhere real.
///
/// THAT IS A RECEIPT, NOT A GUARANTEE OF TRUTH. This comment used to end "the
/// model cannot assert what it cannot point at", and a verifier disproved it on
/// a twelve-message thread where the customer wrote "Tomorrow is bad. Maybe
/// Tuesday? I have to check with my wife" and the catch-up came back saying they
/// had agreed. An overclaiming comment is worse than none, because it tells the
/// next reader the checking was already done.
///
/// What the server does enforce — four rules, all lexical, none of them
/// comprehension (apps/api/src/messaging/thread-summary.ts):
///
///   1. CITATION. The line names a message from the window we fed the model, or
///      it is dropped. This narrows a claim to ONE message; by itself it does
///      not check the claim against that message.
///   2. ATTRIBUTION. A line under "What we said" may only cite a message the
///      BUSINESS sent, and one under "What they asked" a message the CUSTOMER
///      sent. Direction is a column on our own row, so this one is a fact rather
///      than a judgement.
///   3. GROUNDING. Links, phone numbers and amounts in a line must appear in the
///      message it cites. Those are tokens, so they compare exactly. Since (4)
///      it protects nothing (4) does not; what it still does is NAME that
///      failure separately in the tally the endpoint ships, which is a
///      diagnostic rather than a guarantee.
///   4. QUOTATION, the one the other three could not stand in for and the one
///      this feature rests on. A line survives only if it IS the message it
///      cites, WHOLE — compared after normalising case, whitespace, quote glyphs
///      and trailing punctuation on both sides, so the rule is forgiving about
///      how a message is written down and absolute about how much of it is
///      there. The model's job is SELECTION — which messages matter, under which
///      heading — so it has nothing left to ASSERT with, and there is no clause
///      to leave out.
///      Three earlier designs are recorded on the server's own function. The one
///      before this allowed any FRAGMENT of the cited message: it killed
///      invention outright and lost to the HALF-QUOTE, because "Yeah Tuesday
///      works for me" is a genuine substring of "Yeah Tuesday works for me, but
///      let me check with the missus". Eight of twelve phrasings still misled.
///      WHAT IT DOES NOT BUY IS A GOOD SUMMARY. Lou can still pick the wrong
///      message, or pick nothing worth reading. Those are BAD summaries, and a
///      reader can see one with the thread a tap below; what this forecloses is
///      the FALSE summary, which they cannot see at all. What it costs is the
///      tidy sentence: a faithful paraphrase scores exactly what an invention
///      does, nothing, and a message past the server's per-line ceiling cannot
///      appear at all — trimming it would be the half-quote again.
///
/// None of the four touches STALENESS — a perfectly quoted, genuinely committed
/// "Tuesday" can be superseded two messages later. That is why `at` is printed
/// beside every line, why the server orders by it, and why the attribution
/// sentence says whose reading this is.
struct ThreadSummaryLine: Codable, Sendable, Equatable {
    let section: String
    let text: String
    /// The message this line is grounded in — where the tap lands.
    let message_id: String
    /// That message's timestamp, so a reader can see how old the claim is.
    let at: String
}

/// The contact's standing with the carrier, as a FACT — never model output.
struct ThreadSummaryOptOut: Codable, Sendable, Equatable {
    /// Who ended it: the customer texting STOP, or somebody recording it here.
    let source: String
    let at: String
}

/// The carrier half of a response, lifted away from everything Lou wrote.
///
/// It exists so a PENDING ask can hold the standing without holding the summary
/// it came from. Clearing the card while a second request is in flight is right
/// for Lou's reading — that reading is about to be replaced — and wrong for the
/// STOP, which is not Lou's, and which does not stop being true because somebody
/// pressed a button. A type carrying only these two fields is what makes "keep
/// the fact, drop the reading" something the compiler can express instead of
/// something every view has to remember.
struct ThreadCatchUpCarrier: Sendable, Equatable {
    let optOut: ThreadSummaryOptOut?
    /// #396: something in the thread reads like a STOP without being one.
    let hintAt: String?

    /// Nobody has told us anything yet.
    ///
    /// NOT "they have not opted out" — the difference is the whole of
    /// `threadCatchUpOptOutNotice` returning nil rather than a reassurance.
    static let unknown = ThreadCatchUpCarrier(optOut: nil, hintAt: nil)
}

/// POST /v1/conversations/:id/summary.
///
/// Every field optional, and the empty value is a legitimate answer rather than
/// an error: toggle off, spam, too short to bother, no binding, rate-limited,
/// over the monthly cap, model timeout, or output that failed the citation
/// rules. A busy inbox gets silence with a reason, never an error box.
/// `Equatable` is deliberately absent: `Default` is `Codable, Sendable` and not
/// `Equatable`, so the synthesis would not compile — the same reason `Message`
/// and every other wrapped wire model here stops at `Codable, Sendable`.
struct ThreadCatchUp: Codable, Sendable {
    @Default<DefaultEmptyList<ThreadSummaryLine>> var lines: [ThreadSummaryLine]
    /// Why the list is empty; absent on success. See `threadCatchUpMessage`.
    var reason: String?
    /// The window did not reach the start of the thread, so the card must not
    /// read as covering the whole history.
    @Default<DefaultFalse> var truncated: Bool
    /// Served from the cache against the last message id — an unchanged thread
    /// re-opens for free. Not shown to anybody; it exists so a test can prove
    /// the second ask spent nothing.
    @Default<DefaultFalse> var cached: Bool
    /// Carrier truth, on EVERY response shape including the refusals. Nil means
    /// there is no standing to report — or, on an `unavailable` refusal, that
    /// the server could not establish one and refused rather than guess.
    var opt_out: ThreadSummaryOptOut?
    /// #396: somebody wrote something that reads like a STOP without being one.
    var opt_out_hint_at: String?

    // Spelled out so a caller building a failure result does not have to supply
    // fields that only a real answer carries.
    init(
        lines: [ThreadSummaryLine] = [],
        reason: String? = nil,
        truncated: Bool = false,
        cached: Bool = false,
        opt_out: ThreadSummaryOptOut? = nil,
        opt_out_hint_at: String? = nil
    ) {
        self.lines = lines
        self.reason = reason
        self.truncated = truncated
        self.cached = cached
        self.opt_out = opt_out
        self.opt_out_hint_at = opt_out_hint_at
    }

    /// This response's carrier standing, on its own.
    ///
    /// Read on every response shape including the refusals, which is why the two
    /// fields are declared outside `lines` rather than beside them.
    var carrier: ThreadCatchUpCarrier {
        ThreadCatchUpCarrier(optOut: opt_out, hintAt: opt_out_hint_at)
    }
}

/// What came back from an ask: an answer, or nothing at all.
///
/// Two different events, and only one of them carries carrier truth. A REFUSAL
/// is the server answering "no lines, and here is why" — it states the contact's
/// standing alongside the refusal, exactly as a successful answer does, because
/// the opt-out fields ride back on every response shape. A REJECTED REQUEST
/// never reached that answer: the capability gate turned it away, the phone was
/// offline, the thread was gone. There is nothing in it to read a standing from,
/// and reading one anyway means reading a null as a fact.
///
/// `MessagingRepository.summarizeThread` used to flatten both into a
/// `ThreadCatchUp` it built here on the device, which is how a STOPped workspace
/// stopped being told so the moment a re-ask failed: a locally-built refusal is
/// indistinguishable downstream from a server answer reporting no standing, and
/// the card believed it. Web draws the same line, from the same defect
/// (`thread-summary-card.tsx`, `result === null && summary.isError`).
enum ThreadCatchUpAnswer: Sendable {
    /// The server answered. Lines or a refusal, and its carrier fields either
    /// way — authoritative, INCLUDING when they are empty.
    case answered(ThreadCatchUp)
    /// The request itself was rejected, so nothing came back to read. The reason
    /// is the failure's own structural code, never one this client made up
    /// (`threadCatchUpFailureReason`).
    case rejected(reason: String?)
}

/// What the catch-up strip is doing right now, and what it may say while it
/// does it.
///
/// `shown` carries the whole result rather than only the lines, because a
/// REFUSAL still carries carrier truth — the opt-out fields ride back on every
/// response shape, and a card that dropped them on the failure path would hide
/// a STOP at precisely the moment it had nothing else to show.
///
/// THE OTHER THREE CASES CARRY THE SAME FACT one step earlier in time, and that
/// is the whole reason they have a payload. There is no re-ask control on a
/// shown card: asking again means Hide, then the ask row, so the standing has to
/// survive BOTH hops or it is gone by the time the second request is in flight
/// — and a workspace that has been STOPped would stop being told so at exactly
/// the moment somebody pressed the button. Cases with nothing in them could not
/// have carried it.
///
/// `failed` is the third hop, and the one that shipped wrong. A rejected request
/// produces no response to read a standing from, so a phase built out of one
/// says nothing about the carrier — the same gap as the pending phase, except
/// that this one does not end when the request does.
enum ThreadCatchUpState {
    /// Nothing asked for yet. The control is on screen; no unit has been spent.
    case idle(ThreadCatchUpCarrier)
    case loading(ThreadCatchUpCarrier)
    case shown(ThreadCatchUp)
    /// The ask was rejected before any body came back, so there is nothing of
    /// Lou's to show and the last standing the SERVER stated is held across it.
    case failed(reason: String?, held: ThreadCatchUpCarrier)

    /// Somebody asked. The request is in flight, keeping whatever the last
    /// answer said about the carrier.
    ///
    /// A method rather than `.loading(...)` written at the call site, because
    /// the defect it prevents is invisible there: `.loading(.unknown)` compiles,
    /// reads perfectly well, and silently drops a STOP for the length of a
    /// request.
    func asking() -> ThreadCatchUpState {
        .loading(carrier)
    }

    /// Somebody put the card away. Lou's reading goes; the carrier fact stays,
    /// because on this client the next thing they can do is ask again.
    func putAway() -> ThreadCatchUpState {
        .idle(carrier)
    }

    /// The ask came back. An answer is shown; a rejection keeps the standing.
    ///
    /// A method rather than a phase written at the call site, for the reason
    /// `asking()` gives — and here the defect it prevents is worse than a gap.
    /// A phase built from a refusal this CLIENT wrote carries empty carrier
    /// fields, which read as an authoritative "nobody has opted out"; unlike the
    /// pending phase, it does not end when the request does.
    ///
    /// The ANSWER is authoritative in both directions, including when it reports
    /// no standing at all. An opt-out somebody recorded here can be lifted
    /// (`ThreadController.revokeOptOut`), and a notice that outlived the answer
    /// dropping it would keep claiming a block that no longer exists — false in
    /// the one direction that costs a customer the reply they were waiting for.
    func answered(_ answer: ThreadCatchUpAnswer) -> ThreadCatchUpState {
        switch answer {
        case .answered(let result):
            return .shown(result)
        case .rejected(let reason):
            return .failed(reason: reason, held: carrier)
        }
    }

    /// A request is already in flight. One tap, one AI unit — see
    /// `ThreadController.askForCatchUp`.
    var isLoading: Bool {
        switch self {
        case .loading:
            return true
        case .idle, .shown, .failed:
            return false
        }
    }

    /// Everything this card has been told about the carrier, in any phase.
    ///
    /// An ANSWER is authoritative over a remembered fact, which is why `.shown`
    /// reads its own response rather than falling back: an opt-out somebody
    /// recorded here can be lifted (`ThreadController.revokeOptOut`), and a
    /// notice that outlived the answer that dropped it would eventually be a
    /// false claim in the one direction that matters.
    var carrier: ThreadCatchUpCarrier {
        switch self {
        case .idle(let held):
            return held
        case .loading(let held):
            return held
        case .shown(let result):
            return result.carrier
        case .failed(_, let held):
            return held
        }
    }

    /// The same fact, but only where the card is entitled to PRINT it.
    ///
    /// Empty while `.idle`: nothing has been asked for, nothing has been spent,
    /// and the card is a control. The standing is not lost by not being printed
    /// here — it is remembered for the next ask, and it is stated where it
    /// changes what a person can DO, on the banner `selectComposerBanner` puts
    /// over the field they would type the reply into.
    var visibleCarrier: ThreadCatchUpCarrier {
        switch self {
        case .idle:
            return .unknown
        case .loading(let held):
            return held
        case .shown(let result):
            return result.carrier
        case .failed(_, let held):
            // PRINTED, and this is the phase the hold exists for. Somebody
            // pressed a control and the product produced nothing: the card is on
            // screen either way, and the only question is whether the last thing
            // the server said about the carrier is on it. A STOP is not the
            // request's to withdraw by failing.
            return held
        }
    }
}

// MARK: - Grouping

/// One heading and the lines under it.
struct ThreadSummaryGroup: Identifiable {
    let id: String
    let label: String
    let lines: [ThreadSummaryLine]
}

/// Lines into the three fixed sections, in the shipped order, skipping empty
/// ones.
///
/// NOTHING IS DROPPED FOR LENGTH. The server already enforces the per-section
/// and overall ceilings; a second ceiling here would be a client silently
/// hiding part of a catch-up somebody paid for, and the two would drift.
///
/// Order WITHIN a section is the server's, which sorts by the cited message's
/// timestamp so the later word reads last. That is the only defence this
/// feature has against a correctly-cited line that a later message superseded,
/// and re-sorting here would throw it away.
func groupThreadSummary(
    _ lines: [ThreadSummaryLine],
    locale: String? = nil
) -> [ThreadSummaryGroup] {
    threadSummarySections.compactMap { section in
        let matching = lines.filter { $0.section == section.id }
        guard !matching.isEmpty else { return nil }
        return ThreadSummaryGroup(
            id: section.id,
            label: AppStrings.translate(locale, section.labelKey),
            lines: matching
        )
    }
}

// MARK: - Failure copy

/// The reason to show when the request itself failed, before any body came back.
///
/// THIS CLIENT NEVER SAYS `model_error`, and that is the whole fix. A model
/// error is something only the server can observe, and when it happens the
/// server says so in the body. What this side knows is that ITS OWN REQUEST
/// failed and which structural code it failed with — so the code IS the reason,
/// and `threadCatchUpMessage` owns the sentence for it.
///
/// Every throw used to become `model_error`. A `read_only` member, who is
/// refused at the capability gate because a catch-up spends the whole
/// workspace's monthly AI budget, was therefore told "Couldn't reach Lou just
/// now" — a sentence that is false, blames the wrong thing, and invites a second
/// press that can never succeed.
///
/// BRANCHED ON THE CODE, NEVER THE STATUS, which is the house rule (see
/// `ApiErrorCode`) and is load-bearing here: `mfa_required` is also a 403, and
/// reporting it as "your role can't ask for catch-ups" would send somebody to an
/// owner to fix something an owner cannot fix.
///
/// Nil for anything that is not an `ApiError` — a decode failure, a cancelled
/// task — which lands on the "no catch-up this time" sentence. A vague true
/// sentence is the right degradation; a precise false one is not.
func threadCatchUpFailureReason(_ error: Error) -> String? {
    (error as? ApiError)?.code
}

/// Plain-language copy for an empty catch-up.
///
/// One blanket "nothing to show" hid real breakage behind what looked like a
/// shrug — the lesson `replyDraftMessage` already carries. Each reason says what
/// happened and whether asking again will help, and every one of them ends
/// somewhere the person can still act: the thread is right there underneath.
///
/// TWO VOCABULARIES, ONE SWITCH. The first group is the server's `reason` field,
/// which arrives in a body. The second is the code of a request that never got a
/// body at all (`threadCatchUpFailureReason`). They share exactly one spelling —
/// `rate_limited`, where the limiter's 429 and the AI gate's refusal mean the
/// same thing to a reader and deserve the same sentence.
///
/// #228: `locale` is defaulted and LAST. It has to be — `ThreadSummaryTests`
/// SCANS THE CARD'S SOURCE for the exact spelling `threadCatchUpMessage(result.
/// reason)`, so the two call sites in `ThreadSummaryCard` cannot pass one until
/// that scan is re-pointed. Every sentence is in the catalogue either way; the
/// only thing still missing is the argument at those two sites.
func threadCatchUpMessage(_ reason: String?, locale: String? = nil) -> String {
    // Switched on a non-optional so a case can be the shipped `ApiErrorCode`
    // constant itself rather than a second copy of the same string typed here.
    switch reason ?? "" {
    case "disabled":
        return AppStrings.translate(locale, "domain.catchUpDisabled")
    // #250: a thread somebody marked as spam never spends AI budget.
    case "spam":
        return AppStrings.translate(locale, "thread.summarySpam")
    case "too_short":
        return AppStrings.translate(locale, "thread.summaryTooShort")
    case "over_cap":
        return AppStrings.translate(locale, "thread.summaryOverCap")
    case "rate_limited":
        return AppStrings.translate(locale, "domain.catchUpRateLimited")
    case "model_error", "unavailable":
        return AppStrings.translate(locale, "thread.summaryUnreachable")
    // The four rules firing, and worth its own sentence: Lou answered and
    // nothing it wrote survived the checking, which is exactly the output that
    // must never reach a crew. Saying less is the honest failure.
    //
    // The sentence names no single rule ON PURPOSE. It used to say Lou "couldn't
    // point anything it wrote at a real message", which was true when citation
    // was the only rule and became false the day attribution, grounding and
    // quotation joined it — the commonest drop now is a line that cites
    // perfectly and does not REPRODUCE the message it cites, which is no longer
    // that message but a sentence about it.
    case "unusable_output":
        return AppStrings.translate(locale, "thread.summaryUnusable")

    // #581: billing, not breakage. Deliberately does NOT say "try again" —
    // trying again is not what fixes it — and names the one place that does,
    // in the same words the send paths already use for a lapsed subscription.
    case "subscription_inactive":
        return AppStrings.translate(locale, "thread.louPausedForBilling")

    // ---- the request never came back with a body (see
    //      `threadCatchUpFailureReason`) --------------------------------------

    case ApiErrorCode.forbidden:
        // On THIS route `forbidden` has exactly one source: the capability gate
        // on `conversations.note`. The per-number check asks for level 'read',
        // which refuses with `not_found` and never with this. So the sentence
        // can name the cause instead of hedging — and it names the reason the
        // gate is there, because "you can read this thread but not summarise it"
        // is otherwise arbitrary: a catch-up spends from one monthly budget the
        // whole workspace shares.
        return AppStrings.translate(locale, "thread.summaryForbidden")
    case ApiErrorCode.notFound:
        // The conversation is gone, or this person's access to its number was
        // taken away while they had it open. Same shape on purpose (#106): a
        // hidden number's conversations must not even be enumerable.
        return AppStrings.translate(locale, "thread.summaryNotFound")
    case ApiErrorCode.network:
        // Not "couldn't reach Lou": Lou was never asked. The phrasing is
        // `ApiClient`'s own, so the app says one thing about connectivity.
        return AppStrings.translate(locale, "thread.summaryNetwork")
    case ApiErrorCode.serviceUnavailable:
        // #283: switched off at the runtime kill switch. Temporary and nobody's
        // fault, so "paused, try shortly" — never "you cannot do this".
        return AppStrings.translate(locale, "thread.summaryPaused")

    default:
        // Everything unnamed, which now includes a reason a newer server adds
        // and a failure that was not an `ApiError` at all. Vague and true beats
        // specific and false.
        return AppStrings.translate(locale, "thread.summaryNone")
    }
}

// MARK: - Carrier truth

/// What the card says about a contact's standing, above everything else.
///
/// BINDING (opt-out is carrier truth): a STOP can only be lifted by the
/// customer. A summary is the thing a hurried person reads INSTEAD of the
/// thread, so a tidy paragraph must never be the only thing between them and
/// texting somebody who asked them to stop.
///
/// Nil when there is nothing to say. Never inferred from the lines — this comes
/// from `opt_outs` and `conversations.opt_out_hint_at`, deterministically, and
/// the server refuses the whole summary rather than guess at it.
///
/// Takes the CARRIER rather than the whole result so the sentence can be written
/// in a phase that has no result: a pending re-ask holds the standing and
/// nothing else (`ThreadCatchUpState.asking`).
///
/// #228: `locale` defaulted and LAST, and for the moment it is never passed —
/// `ThreadSummaryTests` scans the card's source for the exact spelling
/// `threadCatchUpOptOutNotice(state.visibleCarrier)`. See the note on
/// `threadCatchUpMessage`.
func threadCatchUpOptOutNotice(
    _ carrier: ThreadCatchUpCarrier,
    locale: String? = nil
) -> String? {
    if let optOut = carrier.optOut {
        // The customer's own STOP is a different fact from a crew member
        // recording one, and only one of them can be undone here. Naming which
        // is what stops somebody "fixing" a carrier block they cannot fix.
        return isCarrierEnforcedOptOut(optOut.source)
            ? AppStrings.translate(locale, "thread.summaryStopNotice")
            : AppStrings.translate(locale, "thread.summaryOptedOutNotice")
    }
    if carrier.hintAt != nil {
        // #396: not a carrier STOP, so it does not block anything — but the
        // person replying is often not the person who read the request.
        return AppStrings.translate(locale, "thread.summaryLeftAloneNotice")
    }
    return nil
}

/// The catch-up did not cover the whole history.
///
/// No figure: the window size is the server's and it does not travel on the
/// wire, so a number typed here would be a second copy that drifts. The shape of
/// the truth is what a reader needs.
/// #228: the key, read where it is drawn. iOS says this in its own words —
/// Android's `thread.summaryTruncated` is a different sentence — so the key is
/// this app's rather than that one's.
let threadCatchUpTruncatedNoteKey = "thread.summaryRecentStretch"
