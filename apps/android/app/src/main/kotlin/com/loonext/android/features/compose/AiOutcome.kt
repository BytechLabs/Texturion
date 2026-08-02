package com.loonext.android.features.compose

/**
 * #431 — deciding which of the three outcomes a piece of AI output got.
 *
 * We metered every AI unit we spent and recorded nothing about whether anyone
 * used the output, which made "is Lou worth what it costs?" unanswerable rather
 * than merely unanswered. The ledger now stores three counters; turning a
 * person's actual behaviour into one of them is a JUDGMENT, and it is the same
 * judgment on web, Android and iOS.
 *
 * Hand-ported from `apps/web/src/lib/ai/outcome.ts`. Three clients disagreeing
 * about what "edited" means would make the number exactly as useless as not
 * collecting it, so the rules and their reasoning are kept identical rather than
 * re-derived per platform.
 */
object AiOutcome {
    const val USED = "used"
    const val EDITED = "edited"
    const val DISCARDED = "discarded"

    /** The ledger's feature keys. Not display names — see AiOutcomeReporter. */
    const val FEATURE_SUGGEST_REPLY = "suggest_reply"
    const val FEATURE_ENRICH = "enrich"
    const val FEATURE_VOICEMAIL_TRANSCRIPT = "voicemail_transcript"
    const val FEATURE_CALL_WRAPUP = "call_wrapup"

    /**
     * What happened to a dictated wrap-up.
     *
     * The server's own spec says this is the whole reason the route hands back
     * text instead of writing the note itself — a suggestion somebody reads can
     * be measured, and a note written straight to the thread cannot. Not
     * reporting it would leave the ledger recording what the feature COST with
     * nothing about whether it was worth anything.
     *
     * `posted` is false when the member threw the words away without saving,
     * which is the discard case. Otherwise it is whether the text that was
     * saved still matches what came back.
     */
    fun forWrapUp(dictated: String, posted: Boolean, saved: String): String {
        if (!posted) return DISCARDED
        // Same whitespace-insensitivity as forDraft: the composer trims on
        // save, and counting a trailing newline as an edit would inflate
        // "corrected first" with a difference nobody made.
        return if (saved.trim() == dictated.trim()) USED else EDITED
    }

    /**
     * What happened to a reply Lou drafted.
     *
     * `shown` guards the whole thing: a composer that never displayed a
     * suggestion has nothing to report, and reporting "discarded" for it would
     * count every ordinary typed message as a rejection — burying the real
     * signal under the far larger number of messages Lou was never part of.
     */
    fun forDraft(shown: Boolean, picked: String?, sent: String): String? {
        if (!shown) return null
        if (picked == null) return DISCARDED
        // Whitespace-insensitive: the composer trims on send, and counting a
        // trailing newline as an edit would inflate "changed first" with a
        // difference nobody made.
        return if (picked.trim() == sent.trim()) USED else EDITED
    }

    /**
     * What a person did with the address and due date Lou filled in.
     *
     * One enrichment request fills in up to two things and costs one ledger
     * unit, so it gets one outcome — which means the two halves have to be
     * combined. EVERY suggested part thrown away is "cleared", because the
     * person looked at all of it and kept none. ANY part corrected or thrown
     * away while another survives is "corrected first", because a suggestion
     * that needed fixing is not one that was right, and calling a half-correct
     * address "kept as filled in" would flatter the model.
     *
     * Only called after a task is actually created. Somebody who abandoned the
     * form has told us nothing about whether the address was any good.
     */
    fun forEnrichment(
        suggestedAddress: Boolean,
        suggestedDue: Boolean,
        addressEdited: Boolean,
        addressCleared: Boolean,
        dueEdited: Boolean,
        dueCleared: Boolean,
    ): String? {
        data class Part(val suggested: Boolean, val edited: Boolean, val cleared: Boolean)
        val suggested =
            listOf(
                Part(suggestedAddress, addressEdited, addressCleared),
                Part(suggestedDue, dueEdited, dueCleared),
            )
                .filter { it.suggested }
        if (suggested.isEmpty()) return null
        if (suggested.all { it.cleared }) return DISCARDED
        if (suggested.any { it.cleared || it.edited }) return EDITED
        return USED
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
    // disposal timing — and VoicemailPlayerRow lives in a LazyColumn item, so it
    // disposes when you scroll past it. That inference would count "scrolled by"
    // as "read and satisfied". One honest absence beats three platforms guessing.
}
