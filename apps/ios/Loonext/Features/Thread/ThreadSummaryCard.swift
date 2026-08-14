import SwiftUI

/// #247 — the catch-up, above the thread it catches you up on.
///
/// # Where it sits, and why there
///
/// In the banner stack between the tags row and the timeline, alongside the
/// spam, snooze and pinned strips. That slot is already what this app means by
/// "something true about this conversation, before you read it", so a person
/// meets it where they already look rather than in a region invented for it.
/// ABOVE the stream, because a shortcut printed after the thing it shortens is
/// not a shortcut — the same layout decision `VoicemailIntakeSummary` makes
/// about the transcript it sits over.
///
/// # Three things it must never do
///
/// **Never draw a line that cannot be tapped through.** Every line here is a
/// `Button` on `line.message_id`; there is no branch that renders one as plain
/// text. That is a property of THIS file, and it is why the tap target is the
/// whole line rather than a small chevron off to one side.
///
/// It is a receipt, not a proof. A line can cite the right message and still
/// misread it — a verifier produced exactly that — so what the citation buys is
/// that the reader is one tap from checking. `ThreadSummaryLine` records what
/// the server does and does not enforce behind it; the honest summary is that
/// four lexical rules stand between the model and this card, none of them
/// understands a sentence, and all of them fail toward saying less. The load is
/// carried by one of them: every line IS one whole message from the thread,
/// copied, so what reaches this card is a selection out of the conversation
/// rather than a sentence about it. Lou can still select badly, and a reader can
/// see that.
///
/// **Never bury an opt-out.** Carrier truth renders ABOVE the lines and above
/// the phase — the answer, the refusal, the pending re-ask and the ask that was
/// rejected outright, alike — and it comes from `opt_outs` rather than from
/// anything a model wrote. A summary is the thing a hurried person reads INSTEAD
/// of the thread.
///
/// **Never be a decision.** No score, no badge, no reordering, nothing hidden.
/// The inbox is still the inbox; this is a reading aid sitting on top of it.
///
/// # It costs money, so it is asked for
///
/// The idle state is a control, never a result. One tap, one AI unit, no
/// re-roll — the rule `ReplySuggestionChips` already states, and it matters more
/// here because a thread is the largest input this product sends. The reason
/// chip beside it names the signal that put it on screen (PORTAL-UX §3.1): a
/// person can see why they are being offered this before they spend anything.
///
/// The workspace toggle is NOT read here, which is the permissive gate the
/// composer's Lou button already uses. Reading it would cost a settings fetch on
/// every thread open to hide one control, and the server refuses `disabled`
/// before it reserves anything — so the tap spends nothing and the sentence it
/// gets back says where the switch is. Cheaper, and it never leaves somebody
/// wondering where a feature went.
@MainActor
struct ThreadSummaryCard: View {
    /// Why this is on screen at all. `.notOffered` renders nothing — the caller
    /// need not check first.
    let offer: ThreadCatchUpOffer
    let state: ThreadCatchUpState
    let onAsk: @MainActor () -> Void
    /// Tap-through to the message a line cites, by id.
    let onOpenMessage: @MainActor (String) -> Void
    let onHide: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if offer.isOffered {
                // Spacing only ever applies between the notice and the phase
                // below it — every arm of the switch is one child — and 8 is the
                // gap the notice used to sit at when it was drawn inside the
                // result. Lifting it out did not change what it looks like.
                VStack(alignment: .leading, spacing: 8) {
                    // ABOVE THE SWITCH, not inside an arm of it. Carrier truth
                    // outranks every phase this card can be in, and the phase it
                    // used to vanish in was the pending one: a re-ask cleared
                    // the last result, so a workspace that had been STOPped
                    // stopped being told so at exactly the moment somebody
                    // pressed the button. `visibleCarrier` is what each phase is
                    // entitled to say (`ThreadCatchUpState`).
                    if let notice = threadCatchUpOptOutNotice(state.visibleCarrier) {
                        optOutNotice(notice)
                    }
                    switch state {
                    case .idle:
                        askRow
                    case .loading:
                        loadingRow
                    case .shown(let result):
                        resultBody(result)
                    case .failed(let reason, _):
                        rejectedBody(reason)
                    }
                }
                // Geometry lifted wholesale from `SpamSuspectedBanner` rather
                // than chosen again by eye: the two are siblings in one stack,
                // and a second set of numbers would read as a second kind of
                // thing.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    BrandColor.inset,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .padding(.horizontal, 18)
                .padding(.vertical, 5)
            }
        }
    }

    // MARK: - Ask

    private var askRow: some View {
        Button(action: onAsk) {
            HStack(spacing: 8) {
                AiOrb(state: .idle, size: 14)
                Text(AppStrings.translate(appLocale, "thread.summaryOffer"))
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                if let reason = threadCatchUpOfferLabel(offer, locale: appLocale) {
                    // The signal that placed this, never a score. It is also the
                    // honest price tag: somebody can see the thread is long
                    // before they spend a unit finding out.
                    Text(reason)
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.scaled(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted400)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            AppStrings.translate(appLocale, "thread.summaryOfferAria")
        )
        .accessibilityHint(
            AppStrings.translate(appLocale, "thread.summaryOfferHint")
        )
    }

    private var loadingRow: some View {
        HStack(spacing: 8) {
            AiOrb(state: .thinking, size: 14)
            Text(AppStrings.translate(appLocale, "thread.summaryReading"))
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Result

    /// The card's own row: the mark, whose reading this is, and the way out.
    ///
    /// The mark's state is a PARAMETER because the two phases that draw this row
    /// are making different claims. `.done` is the ring blooming, which says Lou
    /// answered; an ask that was rejected is precisely what did not happen, so
    /// there the ring rests. Web draws the same distinction on the same event,
    /// and a card that bloomed over "Can't reach Loonext" would be crediting a
    /// model that was never reached.
    ///
    /// Hide is on both, because on this client it is the first half of a re-ask
    /// — a shown card has no ask control — and a rejected request is the phase
    /// somebody most wants to try again from.
    private func header(mark: AiOrbState) -> some View {
        HStack(spacing: 6) {
            AiOrb(state: mark, size: 12)
            Text(AppStrings.translate(appLocale, "thread.summaryReady"))
                .font(.golos(11, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
            Spacer(minLength: 8)
            Button(
                AppStrings.translate(appLocale, "thread.summaryHide"),
                action: onHide
            )
                .buttonStyle(.plain)
                .font(.golos(11.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
        }
    }

    @ViewBuilder
    private func resultBody(_ result: ThreadCatchUp) -> some View {
        let groups = groupThreadSummary(result.lines, locale: appLocale)
        VStack(alignment: .leading, spacing: 8) {
            // The carrier notice is NOT drawn here — `body` draws it above this
            // whole view, which is the only place that puts it above the
            // loading and refusal phases too. Everything in this function is
            // Lou's reading.
            header(mark: .done)

            if groups.isEmpty {
                // Silence with a reason, never an error box. The thread is
                // directly underneath and every sentence points back at it.
                Text(threadCatchUpMessage(result.reason))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(groups) { group in
                    sectionView(group)
                }
                if result.truncated {
                    Text(AppStrings.translate(appLocale, threadCatchUpTruncatedNoteKey))
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(AppStrings.translate(appLocale, threadSummaryAttributionKey))
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The ask came back with nothing — not a refusal, no response at all.
    ///
    /// Nearly the empty answer above, and deliberately NOT the resting row: a
    /// control that answers a press by looking untouched is a button that
    /// appears to do nothing. `threadCatchUpMessage` owns the sentence for both
    /// vocabularies, so what is different here is what the card may claim around
    /// it — the mark does not bloom, and the carrier notice `body` draws above
    /// this comes from the last standing the SERVER stated rather than from a
    /// response that does not exist (`ThreadCatchUpState.answered`).
    private func rejectedBody(_ reason: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header(mark: .idle)
            Text(threadCatchUpMessage(reason))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The one thing on this card that is not Lou's opinion.
    ///
    /// Weighted heavier than the lines below it — semibold, ink, its own fill —
    /// because visual weight is the only thing telling a hurried reader which of
    /// two adjacent paragraphs is the binding one.
    private func optOutNotice(_ notice: String) -> some View {
        // Baseline rather than top: an 11pt glyph top-aligned against 12pt text
        // sits visibly high, and the optical correction is what makes the two
        // read as one sentence rather than an icon with a paragraph beside it.
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "hand.raised.fill")
                .font(.scaled(11, weight: .medium))
                .foregroundStyle(BrandColor.destructive)
            Text(notice)
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            BrandColor.destructiveContainer,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private func sectionView(_ group: ThreadSummaryGroup) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            // The design system's own small header rather than a hand-rolled
            // uppercase Text: `textCase` appears nowhere else in this app, and a
            // second spelling of the same heading is how three of them end up on
            // one screen.
            SectionHeader(label: group.label)
            // Enumerated rather than keyed on the message id: two lines may
            // legitimately cite the SAME message, and a duplicate ForEach id
            // silently drops one of them.
            ForEach(Array(group.lines.enumerated()), id: \.offset) { _, line in
                lineRow(line)
            }
        }
    }

    private func lineRow(_ line: ThreadSummaryLine) -> some View {
        Button {
            onOpenMessage(line.message_id)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(line.text)
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // WHEN the cited message was, and it is not decoration.
                // Citation defends against invention and does nothing against
                // staleness: "we'll get someone out Tuesday" can be quoted
                // perfectly and superseded two messages later. The server orders
                // by this so the later word reads last; printing it is what lets
                // a reader see that for themselves.
                Text(relativeTime(line.at))
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted400)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(line.text)
        .accessibilityHint(
            AppStrings.translate(appLocale, "thread.summaryLineHint")
        )
    }
}

#Preview("Catch-up offered") {
    ThreadSummaryCard(
        offer: .long(messages: 34),
        state: .idle(.unknown),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up shown") {
    ThreadSummaryCard(
        offer: .long(messages: 34),
        state: .shown(
            ThreadCatchUp(
                lines: [
                    ThreadSummaryLine(
                        section: ThreadSummarySectionId.asked,
                        text: "No hot water since Sunday, two kids at home.",
                        message_id: "m1",
                        at: "2026-08-01T14:02:00Z"
                    ),
                    ThreadSummaryLine(
                        section: ThreadSummarySectionId.weSaid,
                        text: "Quoted $2,400 for the tank, parts arriving Thursday.",
                        message_id: "m2",
                        at: "2026-08-02T09:10:00Z"
                    ),
                    ThreadSummaryLine(
                        section: ThreadSummarySectionId.open,
                        text: "They asked twice for a firm time and nobody has given one.",
                        message_id: "m3",
                        at: "2026-08-03T17:40:00Z"
                    ),
                ],
                truncated: true
            )
        ),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up over a STOP") {
    ThreadSummaryCard(
        offer: .idle(days: 23),
        state: .shown(
            ThreadCatchUp(
                lines: [
                    ThreadSummaryLine(
                        section: ThreadSummarySectionId.open,
                        text: "They never got the invoice they asked for.",
                        message_id: "m9",
                        at: "2026-07-11T12:00:00Z"
                    ),
                ],
                opt_out: ThreadSummaryOptOut(source: "stop", at: "2026-07-12T08:00:00Z")
            )
        ),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up refused") {
    ThreadSummaryCard(
        offer: .long(messages: 18),
        state: .shown(ThreadCatchUp(reason: "over_cap")),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up re-asked over a STOP") {
    // The bug this card shipped with: the second ask cleared the first answer,
    // and the STOP went with it for the length of the request. Here the notice
    // sits over "Reading the thread…" with nothing else on the card, which is
    // exactly right — Lou's reading is out of date, and the carrier's fact is
    // not Lou's to withdraw.
    ThreadSummaryCard(
        offer: .idle(days: 23),
        state: .loading(
            ThreadCatchUpCarrier(
                optOut: ThreadSummaryOptOut(source: "stop", at: "2026-07-12T08:00:00Z"),
                hintAt: nil
            )
        ),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up rejected over a STOP") {
    // The half this card shipped wrong. The pending re-ask above kept the
    // STOP; the moment that request came back REJECTED, the card drew a
    // refusal this client had written itself and the standing went with it —
    // permanently, because nothing else was going to answer.
    //
    // Driven through the shipped transitions rather than assembled here, so this
    // is the actual round trip: answered, put away, asked again, turned away at
    // the capability gate. The ring rests, because nothing answered.
    ThreadSummaryCard(
        offer: .idle(days: 23),
        state: ThreadCatchUpState.shown(
            ThreadCatchUp(
                lines: [
                    ThreadSummaryLine(
                        section: ThreadSummarySectionId.open,
                        text: "They never got the invoice they asked for.",
                        message_id: "m9",
                        at: "2026-07-11T12:00:00Z"
                    ),
                ],
                opt_out: ThreadSummaryOptOut(source: "stop", at: "2026-07-12T08:00:00Z")
            )
        )
        .putAway()
        .asking()
        .answered(.rejected(reason: ApiErrorCode.forbidden)),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}

#Preview("Catch-up refused over a STOP") {
    // The state Android shipped wrong (H3) and web shipped blank (H4): nothing
    // to show AND a live carrier block. The notice is the whole card, which is
    // the point — it is drawn before the card branches on its phase at all, so
    // neither a refusal nor a wait can be the thing that hides a STOP.
    ThreadSummaryCard(
        offer: .idle(days: 23),
        state: .shown(
            ThreadCatchUp(
                // A read-only member: refused at the capability gate, told so,
                // and never told that Lou was unreachable.
                reason: ApiErrorCode.forbidden,
                opt_out: ThreadSummaryOptOut(source: "stop", at: "2026-07-12T08:00:00Z")
            )
        ),
        onAsk: {},
        onOpenMessage: { _ in },
        onHide: {}
    )
    .background(BrandColor.canvas)
}
