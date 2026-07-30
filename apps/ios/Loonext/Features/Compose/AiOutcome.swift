import Foundation

/// #431 — deciding which of the three outcomes a piece of AI output got.
///
/// We metered every AI unit we spent and recorded nothing about whether anyone
/// used the output, which made "is Lou worth what it costs?" unanswerable rather
/// than merely unanswered. The ledger now stores three counters; turning a
/// person's actual behaviour into one of them is a JUDGMENT, and it is the same
/// judgment on web, Android and iOS.
///
/// Hand-ported from `apps/web/src/lib/ai/outcome.ts` and kept identical to
/// `AiOutcome.kt`. Three clients disagreeing about what "edited" means would make
/// the number exactly as useless as not collecting it, so the rules and their
/// reasoning are kept in step rather than re-derived per platform.
enum AiOutcome {
    static let used = "used"
    static let edited = "edited"
    static let discarded = "discarded"

    /// The ledger's feature keys — NOT display names. An outcome lands on the
    /// same row the spend does, so a friendlier spelling ("enrich_task" for the
    /// ledger's "enrich") would open a second row and separate cost from value
    /// permanently.
    static let featureSuggestReply = "suggest_reply"
    static let featureEnrich = "enrich"
    static let featureVoicemailTranscript = "voicemail_transcript"

    /// What happened to a reply Lou drafted.
    ///
    /// `shown` guards the whole thing: a composer that never displayed a
    /// suggestion has nothing to report, and reporting "discarded" for it would
    /// count every ordinary typed message as a rejection — burying the real
    /// signal under the far larger number of messages Lou was never part of.
    static func forDraft(shown: Bool, picked: String?, sent: String) -> String? {
        guard shown else { return nil }
        guard let picked else { return discarded }
        // Whitespace-insensitive: the composer trims on send, and counting a
        // trailing newline as an edit would inflate "changed first" with a
        // difference nobody made.
        let a = picked.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = sent.trimmingCharacters(in: .whitespacesAndNewlines)
        return a == b ? used : edited
    }

    /// What a person did with the address and due date Lou filled in.
    ///
    /// One enrichment request fills in up to two things and costs one ledger unit,
    /// so it gets one outcome — which means the two halves have to be combined.
    /// EVERY suggested part thrown away is "cleared", because the person looked at
    /// all of it and kept none. ANY part corrected or thrown away while another
    /// survives is "corrected first", because a suggestion that needed fixing is
    /// not one that was right, and calling a half-correct address "kept as filled
    /// in" would flatter the model.
    ///
    /// Only called after a task is actually created. Somebody who abandoned the
    /// sheet has told us nothing about whether the address was any good.
    static func forEnrichment(
        suggestedAddress: Bool,
        suggestedDue: Bool,
        addressEdited: Bool,
        addressCleared: Bool,
        dueEdited: Bool,
        dueCleared: Bool
    ) -> String? {
        struct Part {
            let suggested: Bool
            let edited: Bool
            let cleared: Bool
        }
        let suggested = [
            Part(suggested: suggestedAddress, edited: addressEdited, cleared: addressCleared),
            Part(suggested: suggestedDue, edited: dueEdited, cleared: dueCleared),
        ].filter(\.suggested)
        if suggested.isEmpty { return nil }
        if suggested.allSatisfy(\.cleared) { return discarded }
        if suggested.contains(where: { $0.cleared || $0.edited }) { return edited }
        return used
    }

    // Voicemail transcripts are NOT decided here, and the absence is deliberate.
    //
    // #431 names the negative signal: "played the audio anyway". A transcript
    // exists so nobody has to listen, so fetching the audio is it failing at its
    // one job — and that is entirely visible to the server, because
    // GET /v1/calls/:id/voicemail is the only way to obtain playable audio. It is
    // recorded there, once, for all three clients at no client cost.
    //
    // The positive case has no honest client-side form. "Read the words and moved
    // on" is a person NOT doing something, observable only by inferring it from
    // view disposal — and the transcript sits in a List row, which disappears when
    // you scroll past it. That inference would count "scrolled by" as "read and
    // satisfied". One honest absence beats three platforms guessing.
}
